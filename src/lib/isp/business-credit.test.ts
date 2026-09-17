import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyAccessPolicy, restorePaidAccess } from "./access-policy.ts";
import { generateRecurringInvoices, issueInvoice, needsRecurringInvoice } from "./billing.ts";
import {
  availableCredit,
  creditCoversService,
  creditState,
  creditUtilization,
  describeServiceCredit,
  evaluateBusinessCredit,
  resolveEffectiveCredit,
  saveServiceCredit,
} from "./business-credit.ts";
import { loadInvoiceDocument } from "./documents.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { openTestDb } from "./test-db.ts";

test("credit math is integer, never unlimited, and service overrides customer", () => {
  assert.equal(availableCredit(30000, 12000), 18000);
  assert.equal(creditUtilization(30000, 12000), 40);
  const pkg = resolveEffectiveCredit({
    tier: "business",
    packageEnabled: true,
    packageMaxKes: 30000,
    packageWarningKes: 25000,
  });
  assert.equal(pkg.configured, true);
  assert.equal(pkg.max_kes, 30000);
  const unconfigured = resolveEffectiveCredit({
    tier: "business",
    packageEnabled: true,
    packageMaxKes: 0,
  });
  assert.equal(unconfigured.enabled, true);
  assert.equal(unconfigured.configured, false);
  const residential = resolveEffectiveCredit({
    tier: "residential",
    packageEnabled: true,
    packageMaxKes: 50000,
    customerEnabled: true,
    serviceEnabled: true,
  });
  assert.equal(residential.enabled, false);
  assert.equal(residential.configured, false);
  const serviceOff = resolveEffectiveCredit({
    tier: "business",
    packageEnabled: true,
    packageMaxKes: 30000,
    customerEnabled: true,
    serviceEnabled: false,
  });
  assert.equal(serviceOff.enabled, false);
  assert.equal(serviceOff.source, "service");
  const snap = creditState({
    effective: pkg,
    outstandingKes: 12000,
    status: "active",
    expired: true,
    overdue: true,
  });
  assert.equal(snap.covers, true);
  assert.equal(snap.label, "Overdue but Within Credit Limit");
  const limit = creditState({
    effective: pkg,
    outstandingKes: 30000,
    status: "suspended",
    suspendReason: "credit_limit",
  });
  assert.equal(limit.covers, false);
  assert.equal(limit.state, "suspended_limit");
});

test("residential invoices still do not stack while unpaid", () => {
  assert.equal(needsRecurringInvoice({ hasUnpaid: true, lastIssuedAt: "2026-01-01", interval: "monthly" }), false);
});

async function seedBiz(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug, support_phone) values ('ten_bc', 'IMANI NETWORKS', 'imani-bc', '0700000000')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, active, tier, business_credit_enabled, max_credit_kes, credit_warning_kes)
    values
      ('pkg_biz', 'ten_bc', 'Business 50', 'pppoe', 50, 50, 10000, 'monthly', 0, true, 'business', true, 30000, 15000),
      ('pkg_home', 'ten_bc', 'Home 20', 'pppoe', 20, 20, 2500, 'monthly', 0, true, 'residential', false, 0, 0)`;
  await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, till_number, stk_type)
    values ('prv_bc', 'ten_bc', 'mpesa', 'M-Pesa', true, true, '400200', 'paybill')`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
    values ('cus_bc', 'ten_bc', 'Acme Ltd', '0712000222', 'acme@example.com', 'IMN-C-9')`;
  const past = new Date(Date.now() - 40 * 86400_000).toISOString();
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end, account_number, name)
    values
      ('svc_biz', 'ten_bc', 'cus_bc', 'pkg_biz', 'pppoe', 'acme-biz', 'active', ${past}, 'IMN-S-000123', 'Business Fibre'),
      ('svc_home', 'ten_bc', 'cus_bc', 'pkg_home', 'pppoe', 'acme-home', 'active', ${past}, 'IMN-S-000124', 'Home Wireless')`;
}

test("residential still expires; business stays active below the credit limit", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedBiz(sql);
    await asRole("ten_bc");
    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-01-01",
      items: [{ description: "Business 50", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_home",
      dueDate: "2020-01-01",
      items: [{ description: "Home 20", unit_kes: 2500, service_id: "svc_home", package_id: "pkg_home" }],
    });
    const cycle = await applyAccessPolicy(sql, "ten_bc", "IMANI NETWORKS");
    const [biz] = await sql<{ status: string; suspend_reason: string }>`
      select status, coalesce(suspend_reason,'') as suspend_reason from services where id = ${"svc_biz"}`;
    const [home] = await sql<{ status: string; suspend_reason: string }>`
      select status, coalesce(suspend_reason,'') as suspend_reason from services where id = ${"svc_home"}`;
    assert.equal(biz?.status, "active");
    assert.equal(biz?.suspend_reason, "business_credit");
    assert.equal(home?.status, "suspended");
    assert.ok(home?.suspend_reason === "invoice" || home?.suspend_reason === "time");
    assert.equal(await creditCoversService(sql, "ten_bc", "svc_biz"), true);
    assert.equal(await creditCoversService(sql, "ten_bc", "svc_home"), false);
    void cycle;
  } finally {
    await close();
  }
});

test("business invoices stack while unpaid and extra services stay isolated", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedBiz(sql);
    await asRole("ten_bc");
    const first = await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-01-15",
      items: [{ description: "Jan", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_home",
      dueDate: "2026-09-30",
      items: [{ description: "Home now", unit_kes: 2500, service_id: "svc_home", package_id: "pkg_home" }],
    });
    await sql`update invoices set issued_at = now() - interval '32 days' where id = ${first.id}`;
    const created = await generateRecurringInvoices(sql, "ten_bc");
    assert.ok(created.some((c) => c.serviceId === "svc_biz"));
    assert.ok(!created.some((c) => c.serviceId === "svc_home"));
    const unpaid = await sql<{ n: number }>`
      select count(*)::int as n from invoices
      where tenant_id = 'ten_bc' and service_id = 'svc_biz' and status in ('issued','due','overdue','partial')`;
    assert.ok((unpaid[0]?.n ?? 0) >= 2);
    const desc = await describeServiceCredit(sql, "ten_bc", "svc_biz");
    assert.ok((desc?.snapshot.outstanding_kes ?? 0) >= 20000);
    const homeDesc = await describeServiceCredit(sql, "ten_bc", "svc_home");
    assert.equal(homeDesc?.snapshot.outstanding_kes ?? 0, 2500);
    assert.ok((desc?.snapshot.outstanding_kes ?? 0) >= 20000);
    const doc = await loadInvoiceDocument(sql, "ten_bc", first.id);
    assert.ok((doc.totals.previousBalance ?? 0) >= 0);
    assert.equal(doc.totals.creditLimit, 30000);
    assert.ok((doc.totals.outstandingCredit ?? 0) >= 20000);
  } finally {
    await close();
  }
});

test("warning SMS fires once below the limit; suspend and RADIUS disable at the maximum", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedBiz(sql);
    await asRole("ten_bc");
    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-01-01",
      items: [{ description: "P1", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-02-01",
      items: [{ description: "P2", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    const mid = await evaluateBusinessCredit(sql, { tenantId: "ten_bc", serviceId: "svc_biz", ispName: "IMANI NETWORKS" });
    assert.equal(mid?.status, "active");
    assert.equal(mid?.warned, true);
    const warnLogs = await sql<{ event_code: string; body: string }>`
      select event_code, body from notification_logs where tenant_id = 'ten_bc' and event_code = 'credit.warning'`;
    assert.equal(warnLogs.length, 1);
    assert.match(warnLogs[0]!.body, /20,000|20000/);
    assert.match(warnLogs[0]!.body, /30,000|30000/);
    assert.match(warnLogs[0]!.body, /Paybill:? ?400200/);
    assert.match(warnLogs[0]!.body, /IMN-S-000123/);

    const again = await evaluateBusinessCredit(sql, { tenantId: "ten_bc", serviceId: "svc_biz", ispName: "IMANI NETWORKS" });
    assert.equal(again?.warned, false);
    const warnAgain = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs where tenant_id = 'ten_bc' and event_code = 'credit.warning'`;
    assert.equal(warnAgain[0]?.n, 1);

    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-03-01",
      items: [{ description: "P3", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    const hit = await evaluateBusinessCredit(sql, { tenantId: "ten_bc", serviceId: "svc_biz", ispName: "IMANI NETWORKS" });
    assert.equal(hit?.suspended, true);
    assert.equal(hit?.status, "suspended");
    assert.equal(hit?.suspend_reason, "credit_limit");
    const [rad] = await sql<{ enabled: boolean }>`
      select enabled from radius_accounts where tenant_id = 'ten_bc' and service_id = 'svc_biz'`;
    assert.equal(rad?.enabled, false);
    const limitLogs = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs where tenant_id = 'ten_bc' and event_code = 'credit.limit_reached'`;
    assert.ok((limitLogs[0]?.n ?? 0) >= 1);

    const stacked = await generateRecurringInvoices(sql, "ten_bc");
    assert.ok(!stacked.some((c) => c.serviceId === "svc_biz"));

    const dup = await evaluateBusinessCredit(sql, { tenantId: "ten_bc", serviceId: "svc_biz", ispName: "IMANI NETWORKS" });
    assert.equal(dup?.suspended, false);
  } finally {
    await close();
  }
});

test("payment restores only the selected business service when outstanding falls below the limit", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedBiz(sql);
    await asRole("ten_bc");
    const a = await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-01-01",
      items: [{ description: "A", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    const b = await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-02-01",
      items: [{ description: "B", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    const c = await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-03-01",
      items: [{ description: "C", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_home",
      dueDate: "2020-01-01",
      items: [{ description: "Home", unit_kes: 2500, service_id: "svc_home", package_id: "pkg_home" }],
    });
    await evaluateBusinessCredit(sql, { tenantId: "ten_bc", serviceId: "svc_biz", ispName: "IMANI NETWORKS" });
    await applyAccessPolicy(sql, "ten_bc", "IMANI NETWORKS");
    const [down] = await sql<{ status: string }>`select status from services where id = ${"svc_biz"}`;
    assert.equal(down?.status, "suspended");

    await applyConfirmedPayment(sql, {
      tenantId: "ten_bc",
      ispName: "IMANI NETWORKS",
      invoiceId: a.id,
      provider: "mpesa",
      reference: "PAY-BC-1",
      amountKes: 10000,
    });
    const [live] = await sql<{ status: string; suspend_reason: string }>`
      select status, coalesce(suspend_reason,'') as suspend_reason from services where id = ${"svc_biz"}`;
    assert.equal(live?.status, "active");
    assert.equal(live?.suspend_reason, "business_credit");
    const [home] = await sql<{ status: string }>`select status from services where id = ${"svc_home"}`;
    assert.equal(home?.status, "suspended");
    const [rad] = await sql<{ enabled: boolean }>`
      select enabled from radius_accounts where tenant_id = 'ten_bc' and service_id = 'svc_biz'`;
    assert.equal(rad?.enabled, true);

    await applyConfirmedPayment(sql, {
      tenantId: "ten_bc",
      ispName: "IMANI NETWORKS",
      invoiceId: a.id,
      provider: "mpesa",
      reference: "PAY-BC-1",
      amountKes: 10000,
    }).then(
      () => {
        throw new Error("duplicate callback should be rejected");
      },
      (err: unknown) => {
        assert.match(String(err instanceof Error ? err.message : err), /Duplicate/i);
      },
    );
    const pays = await sql<{ n: number }>`select count(*)::int as n from payments where tenant_id = 'ten_bc' and reference = 'PAY-BC-1'`;
    assert.equal(pays[0]?.n, 1);
    void b;
    void c;
  } finally {
    await close();
  }
});

test("fraud suspend is never auto-restored by credit; unconfigured max is residential", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedBiz(sql);
    await sql`update packages set max_credit_kes = 0 where id = 'pkg_biz'`;
    await sql`update services set status = 'suspended', suspend_reason = 'fraud' where id = 'svc_biz'`;
    await asRole("ten_bc");
    await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-01-01",
      items: [{ description: "X", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    assert.equal(await creditCoversService(sql, "ten_bc", "svc_biz"), false);
    const unconfigured = await evaluateBusinessCredit(sql, { tenantId: "ten_bc", serviceId: "svc_biz", ispName: "IMANI NETWORKS" });
    assert.equal(unconfigured?.restored, false);
    await sql`update packages set max_credit_kes = 30000 where id = 'pkg_biz'`;
    assert.equal(await creditCoversService(sql, "ten_bc", "svc_biz"), false);
    const ev = await evaluateBusinessCredit(sql, { tenantId: "ten_bc", serviceId: "svc_biz", ispName: "IMANI NETWORKS" });
    assert.equal(ev?.restored, false);
    const [still] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = ${"svc_biz"}`;
    assert.equal(still?.status, "suspended");
    assert.equal(still?.suspend_reason, "fraud");
  } finally {
    await close();
  }
});

test("overdue fraud is not restored by business credit", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedBiz(sql);
    await sql`update services set status = 'suspended', suspend_reason = 'fraud' where id = 'svc_biz'`;
    await asRole("ten_bc");
    const inv = await issueInvoice(sql, {
      tenantId: "ten_bc",
      customerId: "cus_bc",
      serviceId: "svc_biz",
      dueDate: "2020-01-01",
      items: [{ description: "F", unit_kes: 10000, service_id: "svc_biz", package_id: "pkg_biz" }],
    });
    const held = await restorePaidAccess(sql, "ten_bc", "cus_bc", "svc_biz");
    assert.equal(held.held, true);
    const [row] = await sql<{ status: string }>`select status from services where id = ${"svc_biz"}`;
    assert.equal(row?.status, "suspended");
    void inv;
  } finally {
    await close();
  }
});

test("enabling credit on a residential package is rejected", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedBiz(sql);
    await asRole("ten_bc");
    await assert.rejects(
      () => saveServiceCredit(sql, { tenantId: "ten_bc", serviceId: "svc_home", actorId: "usr_fin", enabled: true, maxKes: 5000 }),
      /Business or Enterprise/,
    );
  } finally {
    await close();
  }
});

test("failed SMS and portal restore stay server-side", () => {
  const credit = readFileSync(new URL("./business-credit.ts", import.meta.url), "utf8");
  assert.match(credit, /notifyQuietly/);
  const portalPay = readFileSync(new URL("../../routes/portal/pay.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(portalPay, /restoreCreditFn|saveServiceCreditFn/);
  const dto = readFileSync(new URL("./customer-portal-dto.ts", import.meta.url), "utf8");
  assert.match(dto, /credit_max_kes/);
  assert.match(dto, /credit_available_kes/);
});
