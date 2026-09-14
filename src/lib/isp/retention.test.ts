import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RETENTION_KPIS,
  formatPct,
  loadRetentionKpis,
  presentRetention,
  ratio,
} from "./retention.ts";
import { loadReports } from "./reports.ts";
import { openTestDb } from "./test-db.ts";

test("suggested retention catalog matches the Insights table", () => {
  assert.deepEqual(
    RETENTION_KPIS.map((k) => [k.kpi, k.measure]),
    [
      ["Monthly churn", "% of active customers who leave"],
      ["Renewal rate", "% of customers who renew"],
      ["Reactivation rate", "% of disconnected customers who return"],
      ["Customer satisfaction", "Survey score / CSAT"],
      ["Complaint resolution", "Time to resolve and repeat complaints"],
      ["Referral customers", "New customers from existing customers"],
    ],
  );
});

test("ratio and percent formatting stay honest on empty denominators", () => {
  assert.equal(ratio(1, 0), null);
  assert.equal(ratio(0, 0), null);
  assert.equal(ratio(1, 4), 0.25);
  assert.equal(formatPct(null), "—");
  assert.equal(formatPct(0), "0%");
  assert.equal(formatPct(0.05), "5%");
  assert.equal(formatPct(0.125), "12.5%");
});

test("CSAT is never invented", () => {
  const rows = presentRetention({
    month: "2026-09",
    churn: { start: 0, left: 0, rate: null },
    renewal: { due: 0, renewed: 0, rate: null },
    reactivation: { disconnected: 0, returned: 0, rate: null },
    csat: { collected: false },
    complaints: { open: 0, closed: 0, repeats: 0 },
    referrals: { converted: 0, newCustomers: 0, rate: null },
  });
  const csat = rows.find((r) => r.id === "csat");
  assert.equal(csat?.value, "Not collected");
  assert.equal(csat?.tone, "muted");
});

test("this-month retention rates come from the tenant book", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const tid = "ten_ret";
    const other = "ten_other";
    await sql`insert into tenants (id, name, slug) values (${tid}, 'Retention', 'retention'), (${other}, 'Other', 'other')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_ret', ${tid}, 'Home', 'pppoe', 10, 10, 2500), ('pkg_o', ${other}, 'Home', 'pppoe', 10, 10, 2500)`;
    await sql`insert into customers (id, tenant_id, name, phone, status, created_at) values
      ('cus_stay', ${tid}, 'Stay', '0700000001', 'active', now() - interval '60 days'),
      ('cus_left', ${tid}, 'Left', '0700000002', 'active', now() - interval '60 days'),
      ('cus_new', ${tid}, 'New', '0700000003', 'active', now() - interval '2 days'),
      ('cus_back', ${tid}, 'Back', '0700000004', 'active', now() - interval '90 days'),
      ('cus_cut', ${tid}, 'Cut', '0700000005', 'active', now() - interval '40 days'),
      ('cus_o', ${other}, 'Other left', '0700000099', 'inactive', now() - interval '60 days')`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status) values
      ('svc_stay', ${tid}, 'cus_stay', 'pkg_ret', 'pppoe', 'stay', 'active'),
      ('svc_left', ${tid}, 'cus_left', 'pkg_ret', 'pppoe', 'left', 'terminated'),
      ('svc_new', ${tid}, 'cus_new', 'pkg_ret', 'pppoe', 'new', 'active'),
      ('svc_back', ${tid}, 'cus_back', 'pkg_ret', 'pppoe', 'back', 'active'),
      ('svc_cut', ${tid}, 'cus_cut', 'pkg_ret', 'pppoe', 'cut', 'suspended')`;
    const due = new Date().toISOString().slice(0, 10);
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date, paid_kes) values
      ('inv_stay', ${tid}, 'cus_stay', 'INV-1', 2500, 'paid', ${due}, 2500),
      ('inv_cut', ${tid}, 'cus_cut', 'INV-2', 2500, 'overdue', ${due}, 0)`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
      values ('pay_stay', ${tid}, 'cus_stay', 'inv_stay', 'mpesa', 2500, 'RET1', 'confirmed')`;
    await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
      values ('nl_back', ${tid}, 'cus_back', 'service.restored', 'sms', 'svc_back', 'Restored', 'Welcome back', '0700000004', 'sent')`;
    await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status) values
      ('tkt_a', ${tid}, 'cus_stay', 'Slow', 'support', 'normal', 'closed'),
      ('tkt_b', ${tid}, 'cus_stay', 'Still slow', 'support', 'normal', 'open'),
      ('tkt_c', ${tid}, 'cus_cut', 'Offline', 'support', 'high', 'open')`;
    await sql`insert into referrals (id, tenant_id, referrer_id, referee_name, referee_phone, status)
      values ('ref_1', ${tid}, 'cus_stay', 'New', '0700000003', 'converted')`;

    await asRole(tid);
    const snap = await loadRetentionKpis(sql, tid);
    assert.equal(snap.churn.start, 4);
    assert.equal(snap.churn.left, 1);
    assert.equal(snap.churn.rate, 0.25);
    assert.equal(snap.renewal.due, 2);
    assert.equal(snap.renewal.renewed, 1);
    assert.equal(snap.renewal.rate, 0.5);
    assert.equal(snap.reactivation.returned, 1);
    assert.ok((snap.reactivation.disconnected ?? 0) >= 1);
    assert.equal(snap.csat.collected, false);
    assert.equal(snap.complaints.open, 2);
    assert.equal(snap.complaints.closed, 1);
    assert.equal(snap.complaints.repeats, 1);
    assert.equal(snap.referrals.converted, 1);
    assert.equal(snap.referrals.newCustomers, 1);
    assert.equal(snap.referrals.rate, 1);

    const rows = presentRetention(snap);
    assert.equal(rows.length, 6);
    assert.equal(rows[0]?.value, "25%");
    assert.equal(rows[1]?.value, "50%");
    assert.equal(rows[3]?.value, "Not collected");

    const reports = await loadReports(sql, tid);
    assert.equal(reports.retention.churn.left, 1);
    assert.equal(reports.retention.csat.collected, false);
  } finally {
    await close();
  }
});
