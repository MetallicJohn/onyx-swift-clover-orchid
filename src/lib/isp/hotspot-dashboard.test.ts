import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  fillHotspotRevenueDays,
  formatHotspotBytes,
  formatSessionDuration,
  hotspotDeltaPct,
  hotspotPeriodBounds,
  hotspotRouterStatus,
  moneyKes,
  ymdInZone,
} from "./hotspot-dashboard-format.ts";
import { loadHotspotDashboard } from "./hotspot-dashboard.ts";
import { hasPermission } from "./rbac.ts";
import { openTestDb } from "./test-db.ts";

test("hotspot format helpers", () => {
  assert.equal(hotspotDeltaPct(150, 100), 50);
  assert.equal(hotspotDeltaPct(50, 100), -50);
  assert.equal(hotspotDeltaPct(80, 0), 100);
  assert.equal(formatHotspotBytes(512), "512 B");
  assert.equal(formatHotspotBytes(2048), "2.0 KB");
  assert.equal(formatSessionDuration("2026-09-18T10:00:00Z", "2026-09-18T11:30:00Z"), "1h 30m");
  assert.match(moneyKes(2500, "KES"), /2,500/);
  const days = fillHotspotRevenueDays([{ day: "2026-09-18", amount: 100, count: 1 }], 3, "2026-09-18");
  assert.equal(days.length, 3);
  assert.equal(days[0]?.amount, 0);
  assert.equal(days[2]?.amount, 100);
});

test("hotspot format is safe for the browser bundle", () => {
  const src = readFileSync(new URL("./hotspot-dashboard-format.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from ["']node:crypto["']/);
  assert.doesNotMatch(src, /from ["'][^"']*router-provisioning/);
});

test("router status uses heartbeat, not mere existence", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  assert.equal(hotspotRouterStatus("2026-09-18T11:59:00Z", "connected", true, now), "online");
  assert.equal(hotspotRouterStatus("2026-09-18T11:55:00Z", "connected", true, now), "warning");
  assert.equal(hotspotRouterStatus("2026-09-18T11:40:00Z", "connected", true, now), "offline");
  assert.equal(hotspotRouterStatus(null, "pending", true, now), "unknown");
  assert.equal(hotspotRouterStatus("2026-09-18T11:59:00Z", "connected", false, now), "offline");
});

test("Nairobi day bounds keep late-evening UTC in yesterday", () => {
  const now = new Date("2026-09-18T21:30:00+03:00");
  assert.equal(ymdInZone(now, "Africa/Nairobi"), "2026-09-18");
  const b = hotspotPeriodBounds(now, "Africa/Nairobi");
  assert.equal(b.todayYmd, "2026-09-18");
  const justAfterMidnight = new Date("2026-09-17T21:10:00Z"); // 00:10 EAT on 18th
  const justBefore = new Date("2026-09-17T20:50:00Z"); // 23:50 EAT on 17th
  assert.ok(justAfterMidnight >= b.todayStart && justAfterMidnight < b.todayEnd);
  assert.ok(justBefore >= b.yesterdayStart && justBefore < b.yesterdayEnd);
});

test("hotspot dashboard revenue, routers, sessions, isolation, and exclusions", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, timezone, currency)
      values ('ten_hs', 'Imani', 'imani-hs', 'Africa/Nairobi', 'KES'),
             ('ten_other', 'Other', 'other-hs', 'Africa/Nairobi', 'KES')`;
    await sql`insert into customers (id, tenant_id, name, phone)
      values ('cus_hs', 'ten_hs', 'Amina', '0700111222'),
             ('cus_ot', 'ten_other', 'Other', '0700999888')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, active)
      values ('pkg_hs', 'ten_hs', 'Day pass', 'hotspot', 10, 5, 100, true),
             ('pkg_pp', 'ten_hs', 'Home', 'pppoe', 10, 10, 2500, true),
             ('pkg_ot', 'ten_other', 'Day', 'hotspot', 10, 5, 50, true)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, account_number)
      values ('svc_hs', 'ten_hs', 'cus_hs', 'pkg_hs', 'hotspot', 'guest1', 'active', 'AF3RB'),
             ('svc_pp', 'ten_hs', 'cus_hs', 'pkg_pp', 'pppoe', 'amina', 'active', 'PP1'),
             ('svc_ot', 'ten_other', 'cus_ot', 'pkg_ot', 'hotspot', 'otherguest', 'active', 'OT1')`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_hs', 'ten_hs', 'cus_hs', 'INV-HS', 100, 'paid', '2026-09-18'),
             ('inv_pp', 'ten_hs', 'cus_hs', 'INV-PP', 2500, 'paid', '2026-09-18'),
             ('inv_line', 'ten_hs', 'cus_hs', 'INV-LN', 80, 'paid', '2026-09-18'),
             ('inv_ot', 'ten_other', 'cus_ot', 'INV-OT', 50, 'paid', '2026-09-18')`;
    await sql`insert into invoice_items (id, tenant_id, invoice_id, description, quantity, unit_kes, amount_kes, service_id)
      values ('ii_hs', 'ten_hs', 'inv_line', 'Hotspot day', 1, 80, 80, 'svc_hs')`;

    const now = new Date("2026-09-18T15:00:00+03:00");
    const todayIso = "2026-09-18T08:00:00.000Z";
    const ydayIso = "2026-09-17T08:00:00.000Z";
    const lastMonthIso = "2026-08-12T08:00:00.000Z";
    const tzEdgeToday = "2026-09-17T21:10:00.000Z";
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, service_id, provider, amount_kes, reference, status, paid_at)
      values
        ('pay_today', 'ten_hs', 'cus_hs', 'inv_hs', 'svc_hs', 'mpesa', 100, 'HS-TODAY', 'confirmed', ${todayIso}),
        ('pay_yday', 'ten_hs', 'cus_hs', 'inv_hs', 'svc_hs', 'mpesa', 40, 'HS-YDAY', 'confirmed', ${ydayIso}),
        ('pay_month', 'ten_hs', 'cus_hs', 'inv_hs', 'svc_hs', 'mpesa', 20, 'HS-OLD', 'confirmed', ${lastMonthIso}),
        ('pay_edge', 'ten_hs', 'cus_hs', 'inv_hs', 'svc_hs', 'mpesa', 15, 'HS-EDGE', 'confirmed', ${tzEdgeToday}),
        ('pay_pend', 'ten_hs', 'cus_hs', 'inv_hs', 'svc_hs', 'mpesa', 999, 'HS-PEND', 'pending', ${todayIso}),
        ('pay_fail', 'ten_hs', 'cus_hs', 'inv_hs', 'svc_hs', 'mpesa', 888, 'HS-FAIL', 'failed', ${todayIso}),
        ('pay_pp', 'ten_hs', 'cus_hs', 'inv_pp', 'svc_pp', 'mpesa', 2500, 'PP-TODAY', 'confirmed', ${todayIso}),
        ('pay_line', 'ten_hs', 'cus_hs', 'inv_line', null, 'mpesa', 80, 'HS-LINE', 'confirmed', ${todayIso}),
        ('pay_ot', 'ten_other', 'cus_ot', 'inv_ot', 'svc_ot', 'mpesa', 50, 'OT-TODAY', 'confirmed', ${todayIso})`;
    await sql`insert into payment_intents (id, tenant_id, invoice_id, customer_id, provider, amount_kes, phone, checkout_id, status, created_at)
      values ('pi_fail', 'ten_hs', 'inv_hs', 'cus_hs', 'mpesa', 100, '0700111222', 'chk_fail', 'failed', ${todayIso})`;
    await sql`insert into invoice_items (id, tenant_id, invoice_id, description, quantity, unit_kes, amount_kes, service_id)
      values ('ii_int', 'ten_hs', 'inv_hs', 'Hotspot', 1, 100, 100, 'svc_hs')`;

    await sql`insert into routers (id, tenant_id, name, identity, role, management_ip, location, wg_status, last_seen, enabled)
      values
        ('rtr_on', 'ten_hs', 'HS-1', 'hs-1', 'hotspot', '10.1.1.1', 'Nanyuki', 'connected', ${"2026-09-18T11:59:00Z"}, true),
        ('rtr_stale', 'ten_hs', 'HS-2', 'hs-2', 'hotspot', '10.1.1.2', 'Nanyuki', 'connected', ${"2026-09-18T11:55:00Z"}, true),
        ('rtr_off', 'ten_hs', 'HS-3', 'hs-3', 'hotspot', '10.1.1.3', 'Town', 'connected', ${"2026-09-18T11:40:00Z"}, true),
        ('rtr_pp', 'ten_hs', 'PPPoE-1', 'pp-1', 'access', '10.1.1.9', 'Core', 'connected', ${"2026-09-18T11:59:00Z"}, true),
        ('rtr_ot', 'ten_other', 'Other-HS', 'ot-1', 'hotspot', '10.9.9.9', 'Elsewhere', 'connected', ${"2026-09-18T11:59:00Z"}, true)`;

    await sql`insert into hotspot_vouchers (id, tenant_id, package_id, code, hours, status)
      values ('vch_1', 'ten_hs', 'pkg_hs', 'HS-LIVE01', 24, 'active')`;
    await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out, started_at, stopped_at)
      values
        ('rs_live', 'ten_hs', 'HS-LIVE01', '10.10.10.8', '10.1.1.1', 1000, 2000, ${todayIso}, null),
        ('rs_user', 'ten_hs', 'guest1', '10.10.10.9', '10.1.1.1', 400, 100, ${todayIso}, null),
        ('rs_stop', 'ten_hs', 'HS-LIVE01', '10.10.10.7', '10.1.1.1', 10, 10, ${ydayIso}, ${todayIso}),
        ('rs_pp', 'ten_hs', 'amina', '10.10.10.2', '10.1.1.9', 9, 9, ${todayIso}, null),
        ('rs_ot', 'ten_other', 'otherguest', '10.9.9.2', '10.9.9.9', 1, 1, ${todayIso}, null)`;

    const clock = Date.parse("2026-09-18T12:00:00Z");
    await asRole("ten_hs");
    const dash = await loadHotspotDashboard(sql, {
      tenantId: "ten_hs",
      canRevenue: true,
      canRouters: true,
      canSessions: true,
      now,
    });

    assert.equal(dash.revenue.today_kes, 195);
    assert.equal(dash.revenue.today_count, 3);
    assert.equal(dash.revenue.yesterday_kes, 40);
    assert.equal(dash.revenue.month_kes, 235);
    assert.equal(dash.revenue.prev_month_kes, 20);
    assert.ok(!dash.payments.some((p) => p.reference === "PP-TODAY"));
    assert.ok(!dash.payments.some((p) => p.reference === "HS-PEND" || p.reference === "HS-FAIL"));
    assert.ok(!dash.payments.some((p) => p.reference === "OT-TODAY"));
    assert.ok(dash.payments.some((p) => p.reference === "HS-LINE"));
    assert.ok(dash.alerts.some((a) => a.kind === "failed_callbacks"));

    assert.equal(dash.routers.total, 3);
    assert.equal(dash.routers.rows.some((r) => r.id === "rtr_pp" || r.id === "rtr_ot"), false);
    const byId = Object.fromEntries(dash.routers.rows.map((r) => [r.id, r]));
    assert.equal(hotspotRouterStatus(byId.rtr_on?.last_seen ?? null, byId.rtr_on?.wg_status ?? "", true, clock), "online");
    assert.equal(byId.rtr_on?.status, "online");
    assert.equal(byId.rtr_stale?.status, "warning");
    assert.equal(byId.rtr_off?.status, "offline");
    assert.ok(dash.alerts.some((a) => a.kind === "router_offline"));
    assert.ok(dash.alerts.some((a) => a.kind === "router_stale"));

    assert.equal(dash.sessions.active, 2);
    assert.equal(dash.sessions.unique_users, 2);
    assert.ok(dash.sessions.rows.some((s) => s.username === "HS-LIVE01" && s.status === "online"));
    assert.ok(dash.sessions.rows.some((s) => s.username === "guest1" && s.service_account_number === "AF3RB"));
    assert.equal(dash.sessions.rows.some((s) => s.username === "amina"), false);
    assert.equal(dash.sessions.rows.some((s) => s.username === "otherguest"), false);

    const hidden = await loadHotspotDashboard(sql, {
      tenantId: "ten_hs",
      canRevenue: false,
      canRouters: true,
      canSessions: true,
      now,
    });
    assert.equal(hidden.revenue.available, false);
    assert.equal(hidden.revenue.today_kes, 0);
    assert.equal(hidden.payments.length, 0);

    const otherId = await loadHotspotDashboard(sql, {
      tenantId: "ten_other",
      canRevenue: true,
      canRouters: true,
      canSessions: true,
      now,
    });
    assert.equal(otherId.revenue.today_kes, 0);
    assert.equal(otherId.routers.total, 0);
    assert.equal(otherId.sessions.active, 0);

    await asRole("ten_other");
    const other = await loadHotspotDashboard(sql, {
      tenantId: "ten_other",
      canRevenue: true,
      canRouters: true,
      canSessions: true,
      now,
    });
    assert.equal(other.revenue.today_kes, 50);
    assert.equal(other.routers.total, 1);
    assert.equal(other.sessions.active, 1);

    assert.equal(hasPermission("network_engineer", "payments.read"), false);
    assert.equal(hasPermission("network_engineer", "radius.manage"), true);
    assert.equal(hasPermission("finance", "radius.manage"), false);
  } finally {
    await close();
  }
});

test("hotspot dashboard server fn asserts radius.manage", () => {
  const src = readFileSync(new URL("./server-hotspot.ts", import.meta.url), "utf8");
  assert.match(src, /export const getHotspotDashboardFn[\s\S]+?assertPermission\(role, "radius.manage"\)/);
  assert.match(src, /export const deployHotspotPortalFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(src, /hasPermission\(role, "payments.read"\)/);
});
