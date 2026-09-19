import assert from "node:assert/strict";
import { test } from "node:test";
import { generateHotspotFiles, normalizePortalSettings } from "./hotspot-portal.ts";
import { listHotspotCatalog, pollHotspotPurchase, startHotspotPurchase, syncHotspotPurchaseFromIntent } from "./hotspot-purchase.ts";
import { authorizeRadius } from "./radius-rest.ts";
import { processMpesaCallback } from "./webhooks.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, validity_hours, duration_value, duration_unit, grace_days, active)
    values ('pkg_hour', 'ten_a', '1 Hour', 'hotspot', 10, 5, 50, 1, 1, 'hours', 0, true),
           ('pkg_month', 'ten_a', '1 Month', 'hotspot', 15, 5, 100, 720, 1, 'months', 0, true),
           ('pkg_min', 'ten_a', '30 Minutes', 'hotspot', 8, 4, 20, 1, 30, 'minutes', 0, true),
           ('pkg_pppoe', 'ten_a', 'Home 10', 'pppoe', 10, 5, 2500, 720, 30, 'days', 5, true),
           ('pkg_b', 'ten_b', 'Other Hour', 'hotspot', 10, 10, 40, 1, 1, 'hours', 0, true)`;
  await sql`insert into customers (id, tenant_id, name, phone, status)
    values ('cus_existing', 'ten_a', 'Amina Otieno', '0712001001', 'active')`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end)
    values ('svc_pppoe', 'ten_a', 'cus_existing', 'pkg_pppoe', 'pppoe', 'amina.pppoe', 'active', now() + interval '20 days')`;
}

function stkBody(checkout: string, code: number, amount?: number, receipt?: string) {
  return {
    Body: {
      stkCallback: {
        CheckoutRequestID: checkout,
        ResultCode: code,
        ResultDesc: code === 0 ? "Success" : code === 1032 ? "cancelled" : "failed",
        CallbackMetadata: code === 0
          ? { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: receipt || "QK7XYZ" }] }
          : undefined,
      },
    },
  };
}

test("captive portal lists BUY buttons and duration labels", () => {
  const files = generateHotspotFiles(
    normalizePortalSettings({ title: "Cafe", show_packages: true, show_voucher: true }),
    [
      {
        id: "p1",
        name: "1 Hour",
        price_kes: 50,
        validity_hours: 1,
        download_mbps: 10,
        upload_mbps: 5,
        bundle_mb: 0,
        description: "",
        duration_value: 1,
        duration_unit: "hours",
        duration_label: "1 Hour",
      },
    ],
    { slug: "alpha", origin: "https://isp.example" },
  );
  assert.match(files["login.html"], /BUY/);
  assert.match(files["login.html"], /1 Hour/);
  assert.match(files["login.html"], /KSh 50/);
  assert.match(files["login.html"], /hs-phone/);
  assert.match(files["login.html"], /\/api\/v1\/hotspot\/purchase/);
  assert.match(files["login.html"], /Activated:/);
  assert.match(files["login.html"], /Pay now/);
  assert.doesNotMatch(files["login.html"], /Business/);
});

test("hotspot purchase confirms only after M-Pesa callback and keeps PPPoE untouched", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");

    const catalog = await listHotspotCatalog(sql, "alpha");
    assert.equal(catalog.packages.some((p) => p.name === "1 Hour"), true);
    assert.equal(catalog.packages.some((p) => p.name === "Home 10"), false);

    await assert.rejects(() => startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_hour", phone: "123" }), /Kenyan/);
    await assert.rejects(
      () => startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_hour", phone: "0712001001", amountKes: 1 }),
      /price mismatch/,
    );
    await assert.rejects(() => startHotspotPurchase(sql, { slug: "beta", packageId: "pkg_hour", phone: "0712001001" }), /not available/);

    const started = await startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_hour", phone: "0712001001" });
    assert.equal(started.payment_status, "pending");
    assert.equal(started.username, undefined);
    const [pendingSvc] = await sql<{ status: string; suspend_reason: string; username: string }>`
      select status, suspend_reason, username from services where id = (
        select service_id from hotspot_purchases where id = ${started.id}
      )`;
    assert.equal(pendingSvc?.status, "pending");
    assert.equal(pendingSvc?.suspend_reason, "awaiting_payment");
    const [radiusOff] = await sql<{ enabled: boolean }>`
      select enabled from radius_accounts where service_id = (
        select service_id from hotspot_purchases where id = ${started.id}
      )`;
    assert.equal(radiusOff?.enabled, false);

    await processMpesaCallback(sql, "alpha", stkBody(started.checkout_id, 0, 50, "HSRECEIPT1"));
    const done = await pollHotspotPurchase(sql, { slug: "alpha", purchaseId: started.id });
    assert.equal(done.payment_status, "confirmed");
    assert.equal(done.service_status, "active");
    assert.ok(done.username);
    assert.ok(done.password);
    const [live] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where username = ${done.username}`;
    assert.equal(live?.status, "active");
    const remaining = new Date(live?.period_end || 0).getTime() - Date.now();
    assert.ok(remaining > 50 * 60_000 && remaining < 70 * 60_000);
    const [pppoe] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_pppoe'`;
    assert.equal(pppoe?.status, "active");
    const pppoeLeft = new Date(pppoe?.period_end || 0).getTime() - Date.now();
    assert.ok(pppoeLeft > 10 * 86400_000);
    const [notes] = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs where tenant_id = 'ten_a' and customer_id = 'cus_existing'`;
    assert.equal(notes?.n ?? 0, 0);

    const second = await startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_month", phone: "0712001001" });
    await processMpesaCallback(sql, "alpha", stkBody(second.checkout_id, 0, 100, "HSRECEIPT2"));
    const month = await pollHotspotPurchase(sql, { slug: "alpha", purchaseId: second.id });
    assert.equal(month.payment_status, "confirmed");
    assert.notEqual(month.username, done.username);
    const [count] = await sql<{ n: number }>`
      select count(*)::int as n from services where tenant_id = 'ten_a' and customer_id = 'cus_existing' and access_method = 'hotspot'`;
    assert.equal(count?.n, 2);

    const other = await listHotspotCatalog(sql, "beta");
    assert.equal(other.packages.every((p) => p.id === "pkg_b"), true);
  } finally {
    await close();
  }
});

test("failed STK never grants hotspot access and new customers are created once", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const started = await startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_hour", phone: "0712999888" });
    await processMpesaCallback(sql, "alpha", stkBody(started.checkout_id, 1032));
    const failed = await pollHotspotPurchase(sql, { slug: "alpha", purchaseId: started.id });
    assert.equal(failed.payment_status, "cancelled");
    assert.equal(failed.username, undefined);
    const [svc] = await sql<{ status: string; suspend_reason: string }>`
      select s.status, s.suspend_reason from services s
      join hotspot_purchases h on h.service_id = s.id where h.id = ${started.id}`;
    assert.equal(svc?.status, "pending");
    assert.equal(svc?.suspend_reason, "awaiting_payment");
    const [radius] = await sql<{ enabled: boolean }>`
      select enabled from radius_accounts where service_id = (
        select service_id from hotspot_purchases where id = ${started.id}
      )`;
    assert.equal(radius?.enabled, false);
    const [customers] = await sql<{ n: number }>`
      select count(*)::int as n from customers where tenant_id = 'ten_a' and right(regexp_replace(phone,'[^0-9]','','g'),9) = '712999888'`;
    assert.equal(customers?.n, 1);

    const again = await startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_hour", phone: "0712999888" });
    await processMpesaCallback(sql, "alpha", stkBody(again.checkout_id, 1));
    const [still] = await sql<{ n: number }>`
      select count(*)::int as n from customers where tenant_id = 'ten_a' and right(regexp_replace(phone,'[^0-9]','','g'),9) = '712999888'`;
    assert.equal(still?.n, 1);
    const paid = await startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_hour", phone: "0712888777" });
    await processMpesaCallback(sql, "alpha", stkBody(paid.checkout_id, 0, 50, "HSRECEIPT3"));
    const dup = await processMpesaCallback(sql, "alpha", stkBody(paid.checkout_id, 0, 50, "HSRECEIPT3"));
    assert.equal(dup.ResultDesc === "idempotent" || dup.ResultDesc === "confirmed", true);
  } finally {
    await close();
  }
});

test("30-minute hotspot purchase expires in 30 minutes and RADIUS times out with remaining time", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const started = await startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_min", phone: "0712333444" });
    const [pendingUser] = await sql<{ username: string }>`
      select username from hotspot_purchases where id = ${started.id}`;
    const before = await authorizeRadius(sql, "ten_a", { username: pendingUser?.username || "", log: false });
    assert.equal(before.result, "reject");

    await processMpesaCallback(sql, "alpha", stkBody(started.checkout_id, 0, 20, "HSRECEIPT30"));
    const done = await pollHotspotPurchase(sql, { slug: "alpha", purchaseId: started.id });
    assert.equal(done.payment_status, "confirmed");
    assert.ok(done.username);
    const remaining = new Date(done.expires_at || 0).getTime() - Date.now();
    assert.ok(remaining > 25 * 60_000 && remaining < 35 * 60_000, `expiry remaining ${remaining}`);

    const auth = await authorizeRadius(sql, "ten_a", { username: done.username, log: false });
    assert.equal(auth.result, "accept");
    const timeout = Number((auth.body["Session-Timeout"] as { value: string[] })?.value?.[0] || 0);
    assert.ok(timeout > 25 * 60 && timeout < 35 * 60, `session timeout ${timeout}`);
  } finally {
    await close();
  }
});

test("hotspot purchases are tenant-isolated and reversal cancels access", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const started = await startHotspotPurchase(sql, { slug: "alpha", packageId: "pkg_hour", phone: "0712555666" });
    await processMpesaCallback(sql, "alpha", stkBody(started.checkout_id, 0, 50, "HSRECEIPT4"));
    const done = await pollHotspotPurchase(sql, { slug: "alpha", purchaseId: started.id });
    assert.equal(done.payment_status, "confirmed");
    const [intent] = await sql<{ id: string }>`select intent_id as id from hotspot_purchases where id = ${started.id}`;
    await syncHotspotPurchaseFromIntent(sql, "ten_a", intent?.id || "", { payment_status: "reversed", fail_reason: "reversed" });
    const reversed = await pollHotspotPurchase(sql, { slug: "alpha", purchaseId: started.id });
    assert.equal(reversed.payment_status, "reversed");
    assert.equal(reversed.username, undefined);
    const [svc] = await sql<{ status: string; suspend_reason: string }>`
      select s.status, s.suspend_reason from services s
      join hotspot_purchases h on h.service_id = s.id where h.id = ${started.id}`;
    assert.equal(svc?.status, "suspended");
    const auth = await authorizeRadius(sql, "ten_a", { username: done.username || "", log: false });
    assert.equal(auth.result, "reject");

    await asRole("ten_b");
    const [stolen] = await sql<{ n: number }>`select count(*)::int as n from hotspot_purchases`;
    assert.equal(stolen?.n, 0);
    await assert.rejects(() => pollHotspotPurchase(sql, { slug: "beta", purchaseId: started.id }), /not found/);
  } finally {
    await close();
  }
});
