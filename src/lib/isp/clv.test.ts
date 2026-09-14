import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLV_METRICS,
  emptyClv,
  expectedTenureMonths,
  formatKesOrDash,
  formatMonths,
  loadClv,
  median,
  monthlyPriceKes,
  predictedClvKes,
  presentClv,
} from "./clv.ts";
import { loadReports } from "./reports.ts";
import { openTestDb } from "./test-db.ts";

test("CLV catalog names the Insights lifetime rows", () => {
  assert.deepEqual(
    CLV_METRICS.map((k) => [k.metric, k.measure]),
    [
      ["Predicted CLV", "This-month ARPU ÷ monthly churn"],
      ["This-month ARPU", "Confirmed collections / active customers"],
      ["List ARPU", "Average live package price per month"],
      ["Expected tenure", "1 / monthly churn"],
      ["Average realized LTV", "Mean confirmed collections per paying customer"],
      ["Median realized LTV", "Median confirmed collections per paying customer"],
      ["Gross margin & CAC", "Contribution margin and acquisition cost"],
    ],
  );
});

test("predicted CLV is ARPU over monthly churn and stays honest on empty inputs", () => {
  assert.equal(predictedClvKes(2500, 0.25), 10000);
  assert.equal(predictedClvKes(3250, 0.25), 13000);
  assert.equal(predictedClvKes(2500, 0), null);
  assert.equal(predictedClvKes(2500, null), null);
  assert.equal(predictedClvKes(null, 0.1), null);
  assert.equal(expectedTenureMonths(0.25), 4);
  assert.equal(expectedTenureMonths(0), null);
  assert.equal(expectedTenureMonths(null), null);
  assert.equal(formatMonths(4), "4.0 mo");
  assert.equal(formatMonths(null), "—");
  assert.equal(formatKesOrDash(null), "—");
  assert.equal(monthlyPriceKes(2500, "monthly"), 2500);
  assert.equal(monthlyPriceKes(700, "weekly"), 3000);
});

test("median ignores empty lists and averages the middle pair", () => {
  assert.equal(median([]), null);
  assert.equal(median([4]), 4);
  assert.equal(median([2500, 2500, 5000, 8000]), 3750);
});

test("gross margin and CAC are never invented", () => {
  const rows = presentClv(emptyClv(new Date("2026-09-14T12:00:00Z")));
  const margin = rows.find((r) => r.id === "margin");
  assert.equal(margin?.value, "Not collected");
  assert.equal(margin?.tone, "muted");
  assert.equal(rows.find((r) => r.id === "predicted")?.value, "—");
});

test("lifetime value comes from the tenant book, not another tenant", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const tid = "ten_clv";
    const other = "ten_clv_o";
    await sql`insert into tenants (id, name, slug) values (${tid}, 'CLV', 'clv'), (${other}, 'Other', 'clvo')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_home', ${tid}, 'Home', 'pppoe', 10, 10, 2500),
             ('pkg_biz', ${tid}, 'Business', 'pppoe', 50, 20, 8000),
             ('pkg_o', ${other}, 'Home', 'pppoe', 10, 10, 2500)`;
    await sql`insert into customers (id, tenant_id, name, phone, status, created_at) values
      ('cus_stay', ${tid}, 'Stay', '0700000001', 'active', now() - interval '60 days'),
      ('cus_left', ${tid}, 'Left', '0700000002', 'inactive', now() - interval '60 days'),
      ('cus_new', ${tid}, 'New', '0700000003', 'active', now() - interval '2 days'),
      ('cus_biz', ${tid}, 'Biz', '0700000004', 'active', now() - interval '90 days'),
      ('cus_never', ${tid}, 'Never', '0700000005', 'active', now() - interval '40 days'),
      ('cus_o', ${other}, 'Other', '0700000099', 'active', now() - interval '60 days')`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status) values
      ('svc_stay', ${tid}, 'cus_stay', 'pkg_home', 'pppoe', 'stay', 'active'),
      ('svc_left', ${tid}, 'cus_left', 'pkg_home', 'pppoe', 'left', 'terminated'),
      ('svc_new', ${tid}, 'cus_new', 'pkg_home', 'pppoe', 'new', 'active'),
      ('svc_biz', ${tid}, 'cus_biz', 'pkg_biz', 'pppoe', 'biz', 'active'),
      ('svc_never', ${tid}, 'cus_never', 'pkg_home', 'pppoe', 'never', 'active'),
      ('svc_o', ${other}, 'cus_o', 'pkg_o', 'pppoe', 'other', 'active')`;
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    await sql`insert into payments (id, tenant_id, customer_id, provider, amount_kes, reference, status, paid_at) values
      ('pay_stay_old', ${tid}, 'cus_stay', 'mpesa', 2500, 'CLVOLD', 'confirmed', ${lastMonth.toISOString()}),
      ('pay_stay', ${tid}, 'cus_stay', 'mpesa', 2500, 'CLVNOW', 'confirmed', now()),
      ('pay_left', ${tid}, 'cus_left', 'mpesa', 2500, 'CLVLEFT', 'confirmed', ${lastMonth.toISOString()}),
      ('pay_new', ${tid}, 'cus_new', 'mpesa', 2500, 'CLVNEW', 'confirmed', now()),
      ('pay_biz', ${tid}, 'cus_biz', 'mpesa', 8000, 'CLVBIZ', 'confirmed', now()),
      ('pay_o', ${other}, 'cus_o', 'mpesa', 9999, 'CLVOTHER', 'confirmed', now()),
      ('pay_pending', ${tid}, 'cus_stay', 'mpesa', 4000, 'CLVPEND', 'pending', now())`;

    await asRole(tid);
    const snap = await loadClv(sql, tid);
    assert.equal(snap.activeCustomers, 4);
    assert.equal(snap.collectedMonthKes, 13000);
    assert.equal(snap.arpu, 3250);
    assert.equal(snap.churnRate, 0.25);
    assert.equal(snap.predictedClvKes, 13000);
    assert.equal(snap.expectedTenureMonths, 4);
    assert.equal(snap.listArpu, 3875);
    assert.equal(snap.payingCustomers, 4);
    assert.equal(snap.collectedKes, 18000);
    assert.equal(snap.realizedAvgKes, 4500);
    assert.equal(snap.realizedMedianKes, 3750);
    assert.ok(!snap.topCustomers.some((c) => c.name === "Other"));
    assert.equal(snap.topCustomers[0]?.name, "Biz");
    assert.equal(snap.topCustomers[0]?.collectedKes, 8000);

    const home = snap.byPackage.find((p) => p.name === "Home");
    const biz = snap.byPackage.find((p) => p.name === "Business");
    assert.equal(home?.live, 3);
    assert.equal(home?.monthlyKes, 2500);
    assert.equal(home?.predictedClvKes, 10000);
    assert.equal(biz?.live, 1);
    assert.equal(biz?.predictedClvKes, 32000);

    const rows = presentClv(snap);
    const predicted = rows.find((r) => r.id === "predicted")?.value ?? "";
    assert.match(predicted, /13.?000/);
    assert.equal(rows.find((r) => r.id === "margin")?.value, "Not collected");

    const reports = await loadReports(sql, tid);
    assert.equal(reports.clv.predictedClvKes, 13000);
    assert.equal(reports.clv.churnRate, reports.retention.churn.rate);
  } finally {
    await close();
  }
});
