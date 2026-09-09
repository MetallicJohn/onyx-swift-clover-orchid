import assert from "node:assert/strict";
import { test } from "node:test";
import { loadChurnScores, scoreChurn, type ChurnFeatures } from "./churn.ts";
import { openTestDb } from "./test-db.ts";

const now = new Date("2026-09-09T10:00:00Z");

function base(over: Partial<ChurnFeatures> = {}): ChurnFeatures {
  return {
    customerStatus: "active",
    services: [{ status: "active", periodEnd: "2026-10-07T10:00:00Z", bundleUsed: 0, bundleMb: 0 }],
    invoices: [{ status: "paid", dueDate: "2026-09-01", amount: 2500, paid: 2500 }],
    lastPaymentAt: "2026-09-01T09:00:00Z",
    openTickets: 0,
    billingTickets: 0,
    now,
    ...over,
  };
}

test("healthy paid customer stays low risk", () => {
  const s = scoreChurn(base());
  assert.equal(s.band, "low");
  assert.ok(s.score < 25, `score ${s.score}`);
});

test("grace alone is medium risk", () => {
  const s = scoreChurn(base({ services: [{ status: "grace", periodEnd: "2026-09-10T10:00:00Z", bundleUsed: 0, bundleMb: 0 }] }));
  assert.equal(s.band, "medium");
  assert.ok(s.reasons.some((r) => /grace/i.test(r)));
});

test("suspended plus overdue scores high and explains why", () => {
  const s = scoreChurn(
    base({
      services: [{ status: "suspended", periodEnd: "2026-09-01T10:00:00Z", bundleUsed: 0, bundleMb: 0 }],
      invoices: [{ status: "overdue", dueDate: "2026-08-01", amount: 2500, paid: 0 }],
      lastPaymentAt: "2026-07-01T09:00:00Z",
    }),
  );
  assert.equal(s.band, "high");
  assert.ok(s.score >= 65);
  assert.ok(s.reasons.some((r) => /suspended/i.test(r)));
  assert.ok(s.reasons.some((r) => /overdue/i.test(r)));
});

test("terminated services are churned", () => {
  const s = scoreChurn(
    base({
      services: [{ status: "terminated", periodEnd: "2026-08-01T10:00:00Z", bundleUsed: 0, bundleMb: 0 }],
    }),
  );
  assert.equal(s.band, "churned");
  assert.ok(s.score >= 85);
});

test("inactive customer is churned", () => {
  const s = scoreChurn(base({ customerStatus: "inactive" }));
  assert.equal(s.band, "churned");
});

test("high-risk customer ranks above a paid neighbour", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_ch', 'Churn', 'churn')`;
    await sql`insert into customers (id, tenant_id, name, phone) values
      ('cus_ok', 'ten_ch', 'Paid Pat', '0700000001'),
      ('cus_risk', 'ten_ch', 'Late Lee', '0700000002')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_ch', 'ten_ch', 'Home', 'pppoe', 10, 10, 2500)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end)
      values
      ('svc_ok', 'ten_ch', 'cus_ok', 'pkg_ch', 'pppoe', 'pat', 'active', ${new Date(Date.now() + 20 * 86400_000).toISOString()}),
      ('svc_risk', 'ten_ch', 'cus_risk', 'pkg_ch', 'pppoe', 'lee', 'suspended', ${new Date(Date.now() - 5 * 86400_000).toISOString()})`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date, paid_kes)
      values
      ('inv_ok', 'ten_ch', 'cus_ok', 'INV-1', 2500, 'paid', '2026-09-01', 2500),
      ('inv_risk', 'ten_ch', 'cus_risk', 'INV-2', 2500, 'overdue', '2026-07-01', 0)`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at)
      values ('pay_ok', 'ten_ch', 'cus_ok', 'inv_ok', 'mpesa', 2500, 'POK', 'confirmed', now())`;
    await asRole("ten_ch");
    const rows = await loadChurnScores(sql, "ten_ch");
    const ok = rows.find((r) => r.customerId === "cus_ok");
    const risk = rows.find((r) => r.customerId === "cus_risk");
    assert.ok(ok && risk);
    assert.equal(ok.band, "low");
    assert.ok(risk.score > ok.score);
    assert.ok(risk.band === "high" || risk.band === "medium");
    assert.equal(rows[0]?.customerId, "cus_risk");
  } finally {
    await close();
  }
});
