import assert from "node:assert/strict";
import { test } from "node:test";
import { deltaPct, fillRevenueDays, loadDashboard } from "./dashboard.ts";
import { openTestDb } from "./test-db.ts";
import type { Workspace } from "./types.ts";

test("fillRevenueDays pads missing days with zero", () => {
  const days = fillRevenueDays([{ day: "2026-09-09", amount: 500, count: 2 }], 3, new Date("2026-09-09T12:00:00Z"));
  assert.equal(days.length, 3);
  assert.equal(days[0]?.day, "2026-09-07");
  assert.equal(days[0]?.amount, 0);
  assert.equal(days[2]?.amount, 500);
});

test("month-over-month delta is signed percent", () => {
  assert.equal(deltaPct(150, 100), 50);
  assert.equal(deltaPct(50, 100), -50);
  assert.equal(deltaPct(80, 0), 100);
  assert.equal(deltaPct(0, 0), 0);
});

test("dashboard month revenue excludes last month and lists today's renewals", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_d', 'Dash', 'dash')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_d', 'ten_d', 'Dina', '0700111222')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_d', 'ten_d', 'Home', 'pppoe', 10, 10, 2500)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end, created_at)
      values ('svc_d', 'ten_d', 'cus_d', 'pkg_d', 'pppoe', 'dina', 'active', ${new Date().toISOString()}, now())`;
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 12));
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_d1', 'ten_d', 'cus_d', 'INV-1', 2500, 'paid', ${now.toISOString().slice(0, 10)})`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_d2', 'ten_d', 'cus_d', 'INV-2', 1800, 'due', ${now.toISOString().slice(0, 10)})`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at)
      values ('pay_now', 'ten_d', 'cus_d', 'inv_d1', 'mpesa', 2500, 'RNOW', 'confirmed', now())`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at)
      values ('pay_old', 'ten_d', 'cus_d', 'inv_d1', 'mpesa', 900, 'ROLD', 'confirmed', ${lastMonth.toISOString()})`;
    await asRole("ten_d");
    const ws: Workspace = {
      tenantId: "ten_d",
      tenantName: "Dash",
      slug: "dash",
      status: "trial",
      currency: "KES",
      role: "isp_owner",
      supportEmail: "",
      supportPhone: "",
    };
    const dash = await loadDashboard(sql, ws);
    assert.equal(dash.totals.revenueMonth, 2500);
    assert.equal(dash.totals.revenueLastMonth, 900);
    assert.equal(dash.totals.paymentsToday, 2500);
    assert.ok(dash.totals.renewalsToday >= 1);
    assert.ok(dash.renewals.some((r) => r.customer_name === "Dina"));
    assert.ok(dash.totals.connectionsToday >= 1);
    assert.equal(dash.totals.outstanding, 1800);
  } finally {
    await close();
  }
});
