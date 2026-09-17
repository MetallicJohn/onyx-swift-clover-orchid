import assert from "node:assert/strict";
import { test } from "node:test";
import { createOnboard } from "./onboard-create.ts";
import { applyConfirmedPayment } from "./payments.ts";
import {
  decidePartialAccess,
  DEFAULT_PARTIAL_POLICY,
  floorValidityMs,
  kesPercent,
  paymentPct,
  partialValidityMs,
  previewPartial,
  resolveEffectivePartial,
} from "./partial-payment-format.ts";
import {
  applyPaymentAccess,
  getPartialPolicy,
  saveCustomerPartial,
  savePartialPolicy,
  saveServicePartial,
} from "./partial-payment.ts";
import { openTestDb } from "./test-db.ts";

const MONTH = 30 * 86_400_000;

test("integer money math never uses floats and floors validity", () => {
  assert.equal(kesPercent(2000, 50), 1000);
  assert.equal(kesPercent(2000, 75), 1500);
  assert.equal(paymentPct(1000, 2000), 50);
  assert.equal(paymentPct(1500, 2000), 75);
  assert.equal(msToDays(partialValidityMs(MONTH, 1000, 2000)), 15);
  assert.equal(msToDays(floorValidityMs(partialValidityMs(MONTH, 1500, 2000))), 22);
  assert.equal(previewPartial({ fullKes: 2000, thisKes: 500, minPct: 50, periodMs: MONTH }).qualifies, false);
  assert.equal(previewPartial({ fullKes: 2000, thisKes: 1000, minPct: 50, periodMs: MONTH }).qualifies, true);
  assert.equal(previewPartial({ fullKes: 2000, thisKes: 1000, minPct: 50, periodMs: MONTH }).grant_days, 15);
});

function msToDays(ms: number) {
  return Math.trunc(ms / 86_400_000);
}

test("partial payment is disabled by default and service overrides customer", () => {
  const tenant = resolveEffectivePartial({ policy: DEFAULT_PARTIAL_POLICY });
  assert.equal(tenant.enabled, false);
  assert.equal(tenant.min_pct, 50);
  const customerOn = resolveEffectivePartial({
    policy: { ...DEFAULT_PARTIAL_POLICY, allow_customer_override: true },
    customerEnabled: true,
    customerMinPct: 40,
  });
  assert.equal(customerOn.enabled, true);
  assert.equal(customerOn.min_pct, 40);
  const serviceOff = resolveEffectivePartial({
    policy: { ...DEFAULT_PARTIAL_POLICY, allow_service_override: true },
    customerEnabled: true,
    customerMinPct: 40,
    serviceEnabled: false,
  });
  assert.equal(serviceOff.enabled, false);
  assert.equal(serviceOff.source, "service");
});

test("below-minimum does not activate; after_payment stays full-only", () => {
  const effective = resolveEffectivePartial({
    policy: { ...DEFAULT_PARTIAL_POLICY, enabled_default: true },
  });
  const below = decidePartialAccess({
    effective,
    fullKes: 2000,
    paidKes: 500,
    thisKes: 500,
    invoicePaid: false,
    periodMs: MONTH,
    serviceStatus: "pending",
    suspendReason: "awaiting_payment",
    activationMode: "after_partial",
  });
  assert.equal(below.outcome, "below_minimum");
  assert.equal(below.action, "none");
  const fullOnly = decidePartialAccess({
    effective,
    fullKes: 2000,
    paidKes: 1000,
    thisKes: 1000,
    invoicePaid: false,
    periodMs: MONTH,
    serviceStatus: "pending",
    suspendReason: "awaiting_payment",
    activationMode: "after_payment",
  });
  assert.equal(fullOnly.qualifies, true);
  assert.equal(fullOnly.action, "none");
  assert.equal(fullOnly.blocked_reason, "full_payment_required");
  const activate = decidePartialAccess({
    effective,
    fullKes: 2000,
    paidKes: 1000,
    thisKes: 1000,
    invoicePaid: false,
    periodMs: MONTH,
    serviceStatus: "pending",
    suspendReason: "awaiting_payment",
    activationMode: "after_partial",
  });
  assert.equal(activate.action, "activate");
  assert.equal(activate.grant_days, 15);
  const restore = decidePartialAccess({
    effective,
    fullKes: 2000,
    paidKes: 1000,
    thisKes: 1000,
    invoicePaid: false,
    periodMs: MONTH,
    serviceStatus: "suspended",
    suspendReason: "time",
    activationMode: "after_payment",
  });
  assert.equal(restore.action, "restore");
  const blocked = decidePartialAccess({
    effective,
    fullKes: 2000,
    paidKes: 1000,
    thisKes: 1000,
    invoicePaid: false,
    periodMs: MONTH,
    serviceStatus: "suspended",
    suspendReason: "fraud",
    activationMode: "after_partial",
  });
  assert.equal(blocked.outcome, "blocked");
  const activeNoExtend = decidePartialAccess({
    effective,
    fullKes: 2000,
    paidKes: 1000,
    thisKes: 1000,
    invoicePaid: false,
    periodMs: MONTH,
    serviceStatus: "active",
    suspendReason: "",
    activationMode: "after_payment",
  });
  assert.equal(activeNoExtend.action, "none");
  assert.equal(activeNoExtend.blocked_reason, "extend_disabled");
});

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug, support_phone) values ('ten_p', 'IMANI NETWORKS', 'imani-p', '0700000000')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, validity_hours, active)
    values
      ('pkg_home', 'ten_p', 'Fibre 20 Mbps', 'pppoe', 20, 20, 2000, 'monthly', 0, true),
      ('pkg_b', 'ten_p', 'Office 40', 'pppoe', 40, 40, 4000, 'monthly', 0, true)`;
  await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, till_number, stk_type)
    values ('prv_p', 'ten_p', 'mpesa', 'M-Pesa', true, true, '123456', 'paybill')`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
    values ('cus_p', 'ten_p', 'John', '0712000111', 'john@example.com', 'IMN-C-1')`;
}

function draft(pkg = "pkg_home", activation: "after_payment" | "after_partial" | "active" = "after_partial") {
  return {
    customer_mode: "existing" as const,
    customer_id: "cus_p",
    include_service: true,
    service: {
      name: pkg === "pkg_home" ? "Home" : "Office",
      access_method: "pppoe" as const,
      package_id: pkg,
      username: "",
      auto_username: true,
      static_ip: "",
      pool_id: "",
      router_id: "",
      mac_address: "",
      cpe_id: "",
      expiry_ymd: "",
      activation,
      notes: "",
      hotspot_mode: "account" as const,
    },
  };
}

test("qualifying partial activates after_partial and posts remaining on the same invoice", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    await savePartialPolicy(sql, "ten_p", { enabled_default: true, default_min_pct: 50, can_activate_new: true });
    const created = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_partial"),
    });
    const pay = await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-HALF",
      amountKes: 1000,
    });
    const [live] = await sql<{ status: string; suspend_reason: string; last_partial_pct: number }>`
      select status, coalesce(suspend_reason,'') as suspend_reason, last_partial_pct from services where id = ${created.service_id}`;
    assert.equal(live?.status, "active");
    assert.equal(live?.suspend_reason, "");
    assert.equal(live?.last_partial_pct, 50);
    const [inv] = await sql<{ status: string; paid_kes: number; amount_kes: number }>`
      select status, paid_kes, amount_kes from invoices where id = ${created.invoice_id}`;
    assert.equal(inv?.status, "partial");
    assert.equal(inv?.paid_kes, 1000);
    assert.equal(inv?.amount_kes, 2000);
    const extra = await sql<{ id: string }>`select id from invoices where tenant_id = 'ten_p' and id <> ${created.invoice_id}`;
    assert.equal(extra.length, 0);
    const logs = await sql<{ event_code: string; body: string }>`
      select event_code, body from notification_logs where tenant_id = 'ten_p'`;
    assert.ok(logs.some((l) => l.event_code === "payment.partial.activated"));
    assert.ok(logs.some((l) => /Paybill 123456/.test(l.body)));
    assert.ok(!logs.some((l) => l.event_code === "service.activated"));
    void pay;
  } finally {
    await close();
  }
});

test("after_payment plus a qualifying partial does not activate", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    await savePartialPolicy(sql, "ten_p", { enabled_default: true });
    const created = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_payment"),
    });
    await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-STILL-FULL",
      amountKes: 1000,
    });
    const [live] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = ${created.service_id}`;
    assert.equal(live?.status, "pending");
    assert.equal(live?.suspend_reason, "awaiting_payment");
  } finally {
    await close();
  }
});

test("payment below the minimum does not activate and SMS shows remaining", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    await savePartialPolicy(sql, "ten_p", { enabled_default: true });
    const created = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_partial"),
    });
    await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-LOW",
      amountKes: 500,
    });
    const [live] = await sql<{ status: string }>`select status from services where id = ${created.service_id}`;
    assert.equal(live?.status, "pending");
    const logs = await sql<{ event_code: string; body: string }>`
      select event_code, body from notification_logs where tenant_id = 'ten_p' and event_code = 'payment.partial.below_minimum'`;
    assert.equal(logs.length > 0, true);
    assert.match(logs[0]!.body, /1,000|1000/);
    assert.ok(!logs.some((l) => l.event_code === "payment.partial.activated"));
  } finally {
    await close();
  }
});

test("qualifying partial restores an expired service and does not touch a sibling line", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    await savePartialPolicy(sql, "ten_p", { enabled_default: true, can_restore_expired: true, can_activate_new: true });
    const a = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_partial"),
    });
    const b = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_b", "after_partial"),
    });
    await sql`update services set status = 'suspended', suspend_reason = 'time',
      period_end = ${new Date(Date.now() - 86400_000).toISOString()}
      where id = ${a.service_id}`;
    await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: a.invoice_id!,
      provider: "mpesa",
      reference: "PAY-RESTORE-A",
      amountKes: 1000,
    });
    const [liveA] = await sql<{ status: string }>`select status from services where id = ${a.service_id}`;
    const [liveB] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = ${b.service_id}`;
    assert.equal(liveA?.status, "active");
    assert.equal(liveB?.status, "pending");
    assert.equal(liveB?.suspend_reason, "awaiting_payment");
    const logs = await sql<{ event_code: string }>`
      select event_code from notification_logs where tenant_id = 'ten_p' and event_code = 'payment.partial.restored'`;
    assert.ok(logs.length > 0);
  } finally {
    await close();
  }
});

test("duplicate payment reference does not grant extra validity or SMS", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    await savePartialPolicy(sql, "ten_p", { enabled_default: true });
    const created = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_partial"),
    });
    await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-DUP",
      amountKes: 1000,
    });
    await assert.rejects(
      () =>
        applyConfirmedPayment(sql, {
          tenantId: "ten_p",
          ispName: "IMANI NETWORKS",
          invoiceId: created.invoice_id!,
          provider: "mpesa",
          reference: "PAY-DUP",
          amountKes: 1000,
        }),
      /Duplicate/,
    );
    const events = await sql<{ n: number }>`
      select count(*)::int as n from partial_payment_events where tenant_id = 'ten_p'`;
    assert.equal(events[0]?.n, 1);
    const sms = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_p' and event_code = 'payment.partial.activated'`;
    assert.equal(sms[0]?.n, 1);
  } finally {
    await close();
  }
});

test("full remainder after a partial tops up to one package period", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    await savePartialPolicy(sql, "ten_p", { enabled_default: true });
    const created = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_partial"),
    });
    await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-1",
      amountKes: 1000,
    });
    const [mid] = await sql<{ period_end: string | null; access_granted_ms: number }>`
      select s.period_end::text as period_end, i.access_granted_ms
      from services s join invoices i on i.id = ${created.invoice_id}
      where s.id = ${created.service_id}`;
    await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-2",
      amountKes: 1000,
    });
    const [end] = await sql<{ period_end: string | null; status: string; paid_kes: number }>`
      select s.period_end::text as period_end, s.status, i.paid_kes
      from services s join invoices i on i.id = ${created.invoice_id}
      where s.id = ${created.service_id}`;
    assert.equal(end?.status, "active");
    assert.equal(end?.paid_kes, 2000);
    const midMs = Date.parse(mid?.period_end || "");
    const endMs = Date.parse(end?.period_end || "");
    assert.ok(Number.isFinite(midMs) && Number.isFinite(endMs));
    const addedDays = Math.round((endMs - midMs) / 86_400_000);
    assert.ok(addedDays >= 14 && addedDays <= 16, `expected ~15 day top-up, got ${addedDays}`);
    const totalDays = Math.round((endMs - Date.now()) / 86_400_000);
    assert.ok(totalDays <= 31, `must not stack a second full period, got ${totalDays}`);
  } finally {
    await close();
  }
});

test("customer override and extra service isolation stay on the selected line", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    const policy = await getPartialPolicy(sql, "ten_p");
    assert.equal(policy.enabled_default, false);
    await saveCustomerPartial(sql, {
      tenantId: "ten_p",
      customerId: "cus_p",
      actorId: "usr_staff",
      enabled: true,
      minPct: 50,
    });
    const a = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_partial"),
    });
    await saveServicePartial(sql, {
      tenantId: "ten_p",
      serviceId: a.service_id!,
      actorId: "usr_staff",
      enabled: false,
    });
    await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: a.invoice_id!,
      provider: "mpesa",
      reference: "PAY-OFF",
      amountKes: 1000,
    });
    const [live] = await sql<{ status: string }>`select status from services where id = ${a.service_id}`;
    assert.equal(live?.status, "pending");
  } finally {
    await close();
  }
});

test("applyPaymentAccess is idempotent for the same payment id", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_p");
    await savePartialPolicy(sql, "ten_p", { enabled_default: true });
    const created = await createOnboard(sql, {
      tenantId: "ten_p",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: draft("pkg_home", "after_partial"),
    });
    const pay = await applyConfirmedPayment(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-IDEM",
      amountKes: 1000,
    });
    const again = await applyPaymentAccess(sql, {
      tenantId: "ten_p",
      ispName: "IMANI NETWORKS",
      customerId: "cus_p",
      serviceId: created.service_id!,
      invoiceId: created.invoice_id!,
      paymentId: pay.id,
      amountKes: 1000,
      paidKes: 1000,
      invoicePaid: false,
    });
    assert.equal(again.event_id !== null, true);
    const events = await sql<{ n: number }>`select count(*)::int as n from partial_payment_events where tenant_id = 'ten_p'`;
    assert.equal(events[0]?.n, 1);
  } finally {
    await close();
  }
});
