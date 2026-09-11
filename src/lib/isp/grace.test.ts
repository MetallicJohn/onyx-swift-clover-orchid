import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAccessPolicy, restorePaidAccess } from "./access-policy.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { authorizeRadius } from "./radius-rest.ts";
import { loadReports } from "./reports.ts";
import { assertPermission, hasPermission } from "./rbac.ts";
import { loadDashboard } from "./dashboard.ts";
import {
  computeGraceExpiry,
  consumeActiveGrantsForCustomer,
  customerSelfGrant,
  extendGrace,
  getGracePolicy,
  grantGrace,
  revokeGrace,
  saveGracePolicy,
} from "./grace.ts";
import { generateRecurringInvoices } from "./billing.ts";
import { openTestDb } from "./test-db.ts";
import type { Workspace } from "./types.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], opts?: { graceDays?: number; periodEnd?: string; status?: string }) {
  const tid = "ten_gr";
  await sql`insert into tenants (id, name, slug) values (${tid}, 'GraceNet', 'gracenet')`;
  await sql`insert into customers (id, tenant_id, name, phone, created_at)
    values ('cus_gr', ${tid}, 'Amina', '0711000099', now() - interval '60 days')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, grace_days)
    values ('pkg_gr', ${tid}, '10 Mbps', 'pppoe', 10, 10, 2500, ${opts?.graceDays ?? 0})`;
  const period = opts?.periodEnd ?? new Date(Date.now() - 86400_000).toISOString();
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end)
    values ('svc_gr', ${tid}, 'cus_gr', 'pkg_gr', 'pppoe', 'amina', ${opts?.status ?? "suspended"}, ${period})`;
  await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
    values ('inv_gr', ${tid}, 'cus_gr', 'INV-GR', 2500, 'overdue', ${(opts?.periodEnd ?? period).slice(0, 10)})`;
  return { tid, period };
}

test("grace expiry is calculated from the paid-through date, not from today", () => {
  const now = new Date("2026-09-12T10:00:00Z");
  const until = computeGraceExpiry("2026-09-10T00:00:00.000Z", 5, now);
  assert.equal(until.toISOString().slice(0, 10), "2026-09-15");
});

test("grant keeps access, does not move renewal, and is idempotent across lifecycle runs", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const renewal = new Date(Date.now() - 86400_000).toISOString();
    const { tid } = await seed(sql, { graceDays: 0, periodEnd: renewal, status: "suspended" });
    await asRole(tid);
    const granted = await grantGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 5,
      reason: "Customer travelling",
      actorType: "staff",
      actorId: "user_staff",
      actorLabel: "Wanjiku",
      ispName: "GraceNet",
    });
    const [svc] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_gr'`;
    assert.equal(svc?.status, "grace");
    assert.equal(svc?.period_end.slice(0, 10), renewal.slice(0, 10));
    assert.equal(granted.period_end?.slice(0, 10), renewal.slice(0, 10));
    assert.ok(Date.parse(granted.expires_at) > Date.now());

    const first = await applyAccessPolicy(sql, tid, "GraceNet");
    const second = await applyAccessPolicy(sql, tid, "GraceNet");
    const [still] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_gr'`;
    assert.equal(still?.status, "grace");
    assert.equal(still?.period_end.slice(0, 10), renewal.slice(0, 10));
    const grants = await sql<{ id: string; expires_at: string }>`
      select id, expires_at::text as expires_at from service_grace_periods where service_id = 'svc_gr'`;
    assert.equal(grants.length, 1);
    assert.equal(Date.parse(grants[0]?.expires_at ?? ""), Date.parse(granted.expires_at));
    assert.equal(second.grace, 0);
    assert.ok(first.suspended === 0 || still?.status === "grace");

    await assert.rejects(
      () =>
        grantGrace(sql, {
          tenantId: tid,
          serviceId: "svc_gr",
          days: 3,
          actorType: "staff",
          actorId: "user_staff",
          ispName: "GraceNet",
        }),
      /already has an active grace period/,
    );
  } finally {
    await close();
  }
});

test("grace expiry causes suspension; payment restores without adding grace days", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const renewal = new Date(Date.now() - 2 * 86400_000).toISOString();
    const { tid } = await seed(sql, { graceDays: 0, periodEnd: renewal, status: "suspended" });
    await asRole(tid);
    const granted = await grantGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 5,
      actorType: "staff",
      actorId: "user_staff",
      actorLabel: "Wanjiku",
      ispName: "GraceNet",
    });
    await sql`update service_grace_periods set expires_at = now() - interval '1 minute' where id = ${granted.id}`;
    const cycle = await applyAccessPolicy(sql, tid, "GraceNet");
    assert.ok(cycle.suspended >= 1);
    const [down] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_gr'`;
    assert.equal(down?.status, "suspended");
    assert.equal(down?.period_end.slice(0, 10), renewal.slice(0, 10));
    const [g] = await sql<{ status: string }>`select status from service_grace_periods where id = ${granted.id}`;
    assert.equal(g?.status, "expired");

    await applyConfirmedPayment(sql, {
      tenantId: tid,
      ispName: "GraceNet",
      invoiceId: "inv_gr",
      provider: "mpesa",
      reference: "PAY-GR-1",
    });
    await restorePaidAccess(sql, tid, "cus_gr");
    const [live] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_gr'`;
    assert.equal(live?.status, "active");
    const next = Date.parse(live?.period_end ?? "");
    assert.ok(next > Date.now() + 20 * 86400_000);
    const graceWindow = Date.parse(granted.expires_at) + 30 * 86400_000;
    assert.ok(Math.abs(next - graceWindow) > 86400_000, "paid period must not include grace days");
    const [consumed] = await sql<{ status: string }>`select status from service_grace_periods where id = ${granted.id}`;
    assert.equal(consumed?.status, "expired");
  } finally {
    await close();
  }
});

test("payment during an active grace period consumes it and leaves renewal to existing rules", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const renewal = new Date(Date.now() - 86400_000).toISOString();
    const { tid } = await seed(sql, { graceDays: 0, periodEnd: renewal, status: "suspended" });
    await asRole(tid);
    const granted = await grantGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 5,
      actorType: "staff",
      actorId: "user_staff",
      ispName: "GraceNet",
    });
    const before = Date.parse(renewal);
    await applyConfirmedPayment(sql, {
      tenantId: tid,
      ispName: "GraceNet",
      invoiceId: "inv_gr",
      provider: "mpesa",
      reference: "PAY-GR-LIVE",
    });
    await restorePaidAccess(sql, tid, "cus_gr");
    const [live] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_gr'`;
    assert.equal(live?.status, "active");
    assert.ok(Date.parse(live?.period_end ?? "") > before);
    const [row] = await sql<{ status: string }>`select status from service_grace_periods where id = ${granted.id}`;
    assert.equal(row?.status, "consumed");
  } finally {
    await close();
  }
});

test("extend and revoke grace, with audit events", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { tid } = await seed(sql, { graceDays: 0, status: "suspended" });
    await asRole(tid);
    const granted = await grantGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 3,
      reason: "first",
      actorType: "staff",
      actorId: "user_staff",
      actorLabel: "Wanjiku",
      ispName: "GraceNet",
    });
    const extended = await extendGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 2,
      reason: "plus two",
      actorType: "staff",
      actorId: "user_staff",
      actorLabel: "Wanjiku",
      ispName: "GraceNet",
    });
    assert.equal(extended.days_granted, 5);
    assert.ok(Date.parse(extended.expires_at) > Date.parse(granted.expires_at));
    const events = await sql<{ action: string; days: number }>`
      select action, days from service_grace_events where grace_id = ${granted.id} order by created_at`;
    assert.deepEqual(events.map((e) => e.action), ["granted", "extended"]);
    await revokeGrace(sql, { tenantId: tid, serviceId: "svc_gr", reason: "paid at the office", actorId: "user_staff" });
    const [svc] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = 'svc_gr'`;
    assert.equal(svc?.status, "suspended");
    const [g] = await sql<{ status: string; revoked_reason: string }>`
      select status, revoked_reason from service_grace_periods where id = ${granted.id}`;
    assert.equal(g?.status, "revoked");
    assert.equal(g?.revoked_reason, "paid at the office");
    const audit = await sql<{ action: string }>`
      select action from audit_logs where tenant_id = ${tid} and entity_type = 'service_grace'`;
    assert.ok(audit.some((a) => a.action === "service.grace.granted"));
    assert.ok(audit.some((a) => a.action === "service.grace.extended"));
    assert.ok(audit.some((a) => a.action === "service.grace.revoked"));
  } finally {
    await close();
  }
});

test("staff without permission cannot grant; tenant isolation holds", async () => {
  assert.equal(hasPermission("technician", "services.grace.grant"), false);
  assert.throws(() => assertPermission("technician", "services.grace.grant"), /Forbidden/);
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { tid } = await seed(sql, { status: "suspended" });
    await sql`insert into tenants (id, name, slug) values ('ten_other', 'Other', 'other')`;
    await asRole("ten_other");
    await assert.rejects(
      () =>
        grantGrace(sql, {
          tenantId: "ten_other",
          serviceId: "svc_gr",
          days: 2,
          actorType: "staff",
          ispName: "Other",
        }),
      /not found/i,
    );
    await bypass();
    await asRole(tid);
    const rows = await sql<{ n: number }>`select count(*)::int as n from service_grace_periods`;
    assert.equal(rows[0]?.n, 0);
  } finally {
    await close();
  }
});

test("eligible customer can add grace from the portal; terms can block others", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { tid } = await seed(sql, { graceDays: 0, status: "suspended" });
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
      values ('pay_old', ${tid}, 'cus_gr', 'inv_gr', 'mpesa', 2500, 'OLD', 'confirmed')`;
    await asRole(tid);
    await saveGracePolicy(sql, tid, {
      customer_self_service: true,
      customer_min_account_days: 30,
      customer_require_prior_payment: true,
      customer_max_days: 3,
      customer_preset_days: [1, 2, 3],
      customer_block_if_already_grace: true,
    });
    const granted = await customerSelfGrant(sql, {
      tenantId: tid,
      customerId: "cus_gr",
      serviceId: "svc_gr",
      days: 2,
      ispName: "GraceNet",
    });
    assert.equal(granted.days_granted, 2);
    await assert.rejects(
      () =>
        customerSelfGrant(sql, {
          tenantId: tid,
          customerId: "cus_gr",
          serviceId: "svc_gr",
          days: 1,
          ispName: "GraceNet",
        }),
      /already on a grace period|already has an active/i,
    );
    await consumeActiveGrantsForCustomer(sql, tid, "cus_gr");
    await saveGracePolicy(sql, tid, { customer_self_service: false });
    await assert.rejects(
      () =>
        customerSelfGrant(sql, {
          tenantId: tid,
          customerId: "cus_gr",
          serviceId: "svc_gr",
          days: 1,
          ispName: "GraceNet",
        }),
      /has not enabled self-service/,
    );
  } finally {
    await close();
  }
});

test("RADIUS still allows a granted grace line and rejects after it expires", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const renewal = new Date(Date.now() - 86400_000).toISOString();
    const { tid } = await seed(sql, { graceDays: 0, periodEnd: renewal, status: "suspended" });
    await sql`insert into radius_accounts (id, tenant_id, service_id, username, password, framed_ip, group_name, enabled, rate_limit)
      values ('rad_gr', ${tid}, 'svc_gr', 'amina', 'secret', '', 'pppoe', true, '10M/10M')`;
    await asRole(tid);
    await grantGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 5,
      actorType: "staff",
      actorId: "user_staff",
      ispName: "GraceNet",
    });
    const ok = await authorizeRadius(sql, tid, { username: "amina" });
    assert.equal(ok.result, "accept");
    await sql`update service_grace_periods set expires_at = now() - interval '2 minutes' where service_id = 'svc_gr'`;
    await applyAccessPolicy(sql, tid, "GraceNet");
    const no = await authorizeRadius(sql, tid, { username: "amina" });
    assert.equal(no.result, "reject");
  } finally {
    await close();
  }
});

test("grace customers are not counted as paid active in reports; grant does not issue invoices", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { tid } = await seed(sql, { status: "suspended" });
    await asRole(tid);
    await grantGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 3,
      actorType: "staff",
      actorId: "user_staff",
      ispName: "GraceNet",
    });
    const before = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = ${tid}`;
    await generateRecurringInvoices(sql, tid);
    const after = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = ${tid}`;
    assert.equal(after[0]?.n, before[0]?.n);
    const reports = await loadReports(sql, tid);
    const method = reports.methods.find((m) => m.access_method === "pppoe");
    assert.equal(method?.active, 0);
    assert.equal(reports.grace.counts.active, 1);
    const ws: Workspace = {
      tenantId: tid,
      tenantName: "GraceNet",
      slug: "gracenet",
      status: "trial",
      currency: "KES",
      role: "isp_owner",
      supportEmail: "",
      supportPhone: "",
    };
    const dash = await loadDashboard(sql, ws);
    assert.equal(dash.totals.online, 0);
    assert.equal(dash.totals.grace, 1);
  } finally {
    await close();
  }
});

test("notifications for grant expiry are not duplicated on a second lifecycle run", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { tid } = await seed(sql, { status: "suspended" });
    await asRole(tid);
    const granted = await grantGrace(sql, {
      tenantId: tid,
      serviceId: "svc_gr",
      days: 2,
      actorType: "staff",
      actorId: "user_staff",
      ispName: "GraceNet",
    });
    await sql`update service_grace_periods set expires_at = now() - interval '1 minute' where id = ${granted.id}`;
    await applyAccessPolicy(sql, tid, "GraceNet");
    await applyAccessPolicy(sql, tid, "GraceNet");
    const logs = await sql<{ event_code: string; n: number }>`
      select event_code, count(*)::int as n from notification_logs
      where tenant_id = ${tid} and event_code = 'grace.expired' and entity_id = ${granted.id}
      group by event_code`;
    assert.ok((logs[0]?.n ?? 0) <= 2);
    const events = await sql<{ n: number }>`
      select count(*)::int as n from service_grace_events where grace_id = ${granted.id} and action = 'expired'`;
    assert.equal(events[0]?.n, 1);
  } finally {
    await close();
  }
});

test("default policy exists without a saved row", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_p', 'P', 'p')`;
    await asRole("ten_p");
    const policy = await getGracePolicy(sql, "ten_p");
    assert.equal(policy.staff_max_days, 14);
    assert.ok(policy.staff_preset_days.includes(5));
    const saved = await saveGracePolicy(sql, "ten_p", { staff_max_days: 7, customer_self_service: false });
    assert.equal(saved.staff_max_days, 7);
    assert.equal(saved.customer_self_service, false);
  } finally {
    await close();
  }
});
