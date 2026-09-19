import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayServiceStatus,
  EMPTY_SERVICE_FILTERS,
  hasActiveServiceFilters,
  likeNeedle,
  networkIdentity,
  normalizeServiceDeskQuery,
  queryServicesDesk,
  selectedServicesCsv,
  serviceDeskFilterChips,
  serviceRecordPath,
  serviceStatusLabel,
  suspendReasonLabel,
} from "./service-desk.ts";
import { openTestDb } from "./test-db.ts";

test("service desk helpers stay honest", () => {
  assert.equal(likeNeedle("svc_amina"), "%svc#_amina%");
  assert.equal(networkIdentity({ access_method: "pppoe", username: "amina.pppoe", static_ip: null }), "amina.pppoe");
  assert.equal(networkIdentity({ access_method: "static", username: null, static_ip: "10.8.0.44" }), "10.8.0.44");
  assert.equal(networkIdentity({ access_method: "hotspot", username: "cynthia.hot", static_ip: null }), "cynthia.hot");
  assert.equal(serviceStatusLabel("grace"), "Grace Period");
  assert.equal(suspendReasonLabel("invoice"), "Non-payment");
  assert.equal(suspendReasonLabel("time"), "Expiry");
  assert.equal(suspendReasonLabel("manual"), "Staff action");
  assert.equal(suspendReasonLabel("bundle"), "Data cap");
  assert.equal(
    displayServiceStatus({ status: "suspended", period_end: "2020-01-01T00:00:00Z", access_until: null }),
    "expired",
  );
  assert.equal(
    displayServiceStatus({ status: "suspended", period_end: "2099-01-01T00:00:00Z", access_until: null }),
    "suspended",
  );
  assert.equal(displayServiceStatus({ status: "active", period_end: "2020-01-01T00:00:00Z", access_until: null }), "active");
  assert.equal(displayServiceStatus({ status: "grace", period_end: null, access_until: null }), "grace");
  const q = normalizeServiceDeskQuery({ q: "  Amina  ", page: 0, status: "nope" });
  assert.equal(q.q, "Amina");
  assert.equal(q.page, 1);
  assert.equal(q.status, "all");
  assert.equal(hasActiveServiceFilters(q), true);
  assert.equal(serviceRecordPath("svc_1"), "/app/services/svc_1");
  const chips = serviceDeskFilterChips(
    { ...EMPTY_SERVICE_FILTERS, status: "grace", routerId: "rtr_kas", overdue: true },
    { routers: [{ id: "rtr_kas", name: "Kasarani AP" }] },
  );
  assert.equal(chips.some((c) => c.label === "Grace Period"), true);
  assert.equal(chips.some((c) => c.label === "Kasarani AP"), true);
  assert.equal(chips.some((c) => c.label === "Overdue"), true);
});

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
    values ('pkg_home', 'ten_a', 'Home 10', 'pppoe', 10, 5, 2500),
           ('pkg_static', 'ten_a', 'Office', 'static', 20, 20, 5000),
           ('pkg_hot', 'ten_a', 'Hotspot Day', 'hotspot', 5, 5, 100),
           ('pkg_b', 'ten_b', 'Other', 'pppoe', 10, 10, 1)`;
  await sql`insert into customers (id, tenant_id, name, phone, email, address, status, account_number, created_at) values
    ('cus_live', 'ten_a', 'Amina Otieno', '0712001001', 'amina@isp.test', 'Kasarani', 'active', 'AMN01', now() - interval '10 days'),
    ('cus_susp', 'ten_a', 'Brian Mwangi', '0712001002', 'brian@isp.test', 'Westlands', 'active', 'BRN02', now() - interval '9 days'),
    ('cus_exp', 'ten_a', 'Cynthia Wanjiku', '0712001003', '', 'Kasarani', 'active', 'CYN03', now() - interval '8 days'),
    ('cus_wait', 'ten_a', 'Esther Pending', '0712001004', 'esther@isp.test', 'Kilimani', 'active', 'EST04', now() - interval '7 days'),
    ('cus_gone', 'ten_a', 'Archived One', '0712001099', '', 'Town', 'active', 'ARC99', now() - interval '6 days'),
    ('cus_b', 'ten_b', 'Other ISP', '0712001999', 'o@x.test', 'Mombasa', 'active', 'OTH01', now() - interval '5 days')`;
  await sql`update customers set deleted_at = now() where id = 'cus_gone'`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end) values
    ('svc_amina_pppoe', 'ten_a', 'cus_live', 'pkg_home', 'pppoe', 'amina.pppoe', null, 'active', now() + interval '3 days'),
    ('svc_amina_static', 'ten_a', 'cus_live', 'pkg_static', 'static', null, '10.8.0.44', 'suspended', now() + interval '20 days'),
    ('svc_brian', 'ten_a', 'cus_susp', 'pkg_home', 'pppoe', 'brian.pppoe', null, 'suspended', now() + interval '12 days'),
    ('svc_cynthia', 'ten_a', 'cus_exp', 'pkg_hot', 'hotspot', 'cynthia.hot', null, 'terminated', now() - interval '12 days'),
    ('svc_esther', 'ten_a', 'cus_wait', 'pkg_home', 'pppoe', 'esther.pppoe', null, 'pending', now() + interval '30 days'),
    ('svc_grace', 'ten_a', 'cus_wait', 'pkg_hot', 'hotspot', 'esther.hot', null, 'grace', now() - interval '1 day'),
    ('svc_gone', 'ten_a', 'cus_live', 'pkg_home', 'pppoe', 'gone.pppoe', null, 'active', now() + interval '10 days'),
    ('svc_b', 'ten_b', 'cus_b', 'pkg_b', 'pppoe', 'other.pppoe', null, 'active', now() + interval '30 days')`;
  await sql`update services set deleted_at = now(), suspend_reason = 'manual' where id = 'svc_gone'`;
  await sql`update services set suspend_reason = 'manual' where id in ('svc_amina_static','svc_brian')`;
  await sql`update services set account_number = 'SAN-AMINA' where id = 'svc_amina_pppoe'`;
  await sql`update services set account_number = 'SAN-BRIAN' where id = 'svc_brian'`;
  await sql`insert into service_grace_periods (id, tenant_id, service_id, customer_id, days_granted, starts_at, expires_at, status, granted_by_type, granted_by_label)
    values ('gr_esther', 'ten_a', 'svc_grace', 'cus_wait', 3, now() - interval '1 day', now() + interval '2 days', 'active', 'staff', 'Desk')`;
  await sql`insert into routers (id, tenant_id, name) values ('rtr_kas', 'ten_a', 'Kasarani AP'), ('rtr_b', 'ten_b', 'Other NAS')`;
  await sql`insert into service_provisioning (id, tenant_id, service_id, customer_id, router_id, username, framed_ip, overall, radius_status)
    values ('prov_amina', 'ten_a', 'svc_amina_pppoe', 'cus_live', 'rtr_kas', 'amina.pppoe', '10.8.0.20', 'ok', 'ok')`;
  await sql`insert into ip_pools (id, tenant_id, name, cidr) values ('pool_office', 'ten_a', 'Office pool', '10.8.0.0/24')`;
  await sql`insert into ip_addresses (id, tenant_id, pool_id, address, status, service_id, customer_id)
    values ('ip_static', 'ten_a', 'pool_office', '10.8.0.44', 'assigned', 'svc_amina_static', 'cus_live')`;
  await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, paid_kes, status, due_date) values
    ('inv_over', 'ten_a', 'cus_susp', 'INV-1', 2500, 0, 'overdue', current_date - 4),
    ('inv_ok', 'ten_a', 'cus_live', 'INV-2', 2500, 2500, 'paid', current_date + 10)`;
  await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out, started_at, stopped_at)
    values ('rad_live', 'ten_a', 'amina.pppoe', '10.8.0.20', '10.0.0.1', 1000, 2000, '2026-09-14T06:00:00Z', null)`;
}

test("service desk searches live records, pages, and stays in the tenant", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");

    const all = await queryServicesDesk(sql, "ten_a", { pageSize: 4 });
    assert.equal(all.counters.total, 4);
    assert.equal(all.counters.active, 1);
    assert.equal(all.counters.pending, 1);
    assert.equal(all.counters.expired, 0);
    assert.equal(all.counters.suspended, 2);
    assert.equal(all.counters.grace, 0);
    assert.equal(all.total, 4);
    assert.equal(all.pages, 1);
    assert.equal(all.services.length, 4);
    assert.equal(all.services.some((s) => s.access_method === "hotspot"), false);
    assert.equal(all.services.some((s) => s.id === "svc_gone"), false);
    assert.equal(all.services.some((s) => s.id === "svc_b"), false);

    const byName = await queryServicesDesk(sql, "ten_a", { q: "Amina" });
    assert.equal(byName.services.every((s) => s.customer_id === "cus_live"), true);
    const byAccount = await queryServicesDesk(sql, "ten_a", { q: "SAN-BRIAN" });
    assert.deepEqual(byAccount.services.map((s) => s.id), ["svc_brian"]);
    const byCustomerId = await queryServicesDesk(sql, "ten_a", { q: "BRN02" });
    assert.equal(byCustomerId.total, 0);
    const byPhone = await queryServicesDesk(sql, "ten_a", { q: "0712001003" });
    assert.deepEqual(byPhone.services.map((s) => s.id), []);
    const byEmail = await queryServicesDesk(sql, "ten_a", { q: "amina@isp.test" });
    assert.equal(byEmail.services.every((s) => s.customer_id === "cus_live"), true);
    const byService = await queryServicesDesk(sql, "ten_a", { q: "svc_amina_static" });
    assert.deepEqual(byService.services.map((s) => s.id), ["svc_amina_static"]);
    const byUser = await queryServicesDesk(sql, "ten_a", { q: "amina.pppoe" });
    assert.deepEqual(byUser.services.map((s) => s.id), ["svc_amina_pppoe"]);
    const byIp = await queryServicesDesk(sql, "ten_a", { q: "10.8.0.44" });
    assert.deepEqual(byIp.services.map((s) => s.id), ["svc_amina_static"]);
    const byHotspot = await queryServicesDesk(sql, "ten_a", { q: "cynthia.hot" });
    assert.deepEqual(byHotspot.services.map((s) => s.id), []);
    const byPlace = await queryServicesDesk(sql, "ten_a", { q: "Westlands" });
    assert.deepEqual(byPlace.services.map((s) => s.id), ["svc_brian"]);
    const byRouter = await queryServicesDesk(sql, "ten_a", { q: "Kasarani AP" });
    assert.deepEqual(byRouter.services.map((s) => s.id), ["svc_amina_pppoe"]);
    const byUnderscore = await queryServicesDesk(sql, "ten_a", { q: "svc_amina_static" });
    assert.equal(byUnderscore.total, 1);

    const archived = await queryServicesDesk(sql, "ten_a", { q: "gone.pppoe" });
    assert.equal(archived.total, 0);
    const other = await queryServicesDesk(sql, "ten_b", { q: "Amina" });
    assert.equal(other.total, 0);
  } finally {
    await close();
  }
});

test("service desk filters combine and keep expired distinct from suspended", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");

    const active = await queryServicesDesk(sql, "ten_a", { status: "active" });
    assert.deepEqual(active.services.map((s) => s.id), ["svc_amina_pppoe"]);
    assert.equal(active.services[0]?.display_status, "active");
    assert.equal(active.services[0]?.session_online, true);
    assert.equal(active.services[0]?.router_name, "Kasarani AP");

    const suspended = await queryServicesDesk(sql, "ten_a", { status: "suspended" });
    assert.deepEqual(suspended.services.map((s) => s.id).sort(), ["svc_amina_static", "svc_brian"]);
    assert.equal(suspended.services.every((s) => s.display_status === "suspended"), true);

    const expired = await queryServicesDesk(sql, "ten_a", { status: "expired" });
    assert.deepEqual(expired.services.map((s) => s.id), []);

    const pending = await queryServicesDesk(sql, "ten_a", { status: "pending" });
    assert.deepEqual(pending.services.map((s) => s.id), ["svc_esther"]);

    const grace = await queryServicesDesk(sql, "ten_a", { status: "grace" });
    assert.deepEqual(grace.services.map((s) => s.id), []);

    const pppoe = await queryServicesDesk(sql, "ten_a", { access: "pppoe" });
    assert.equal(pppoe.services.every((s) => s.access_method === "pppoe"), true);

    const office = await queryServicesDesk(sql, "ten_a", { packageName: "Office" });
    assert.deepEqual(office.services.map((s) => s.id), ["svc_amina_static"]);
    assert.equal(office.services[0]?.pool_name, "Office pool");

    const kasarani = await queryServicesDesk(sql, "ten_a", { location: "Kasarani" });
    assert.equal(kasarani.services.every((s) => s.location === "Kasarani"), true);

    const byCustomer = await queryServicesDesk(sql, "ten_a", { customerId: "cus_live" });
    assert.equal(byCustomer.total, 2);

    const byRouter = await queryServicesDesk(sql, "ten_a", { routerId: "rtr_kas" });
    assert.deepEqual(byRouter.services.map((s) => s.id), ["svc_amina_pppoe"]);

    const byPool = await queryServicesDesk(sql, "ten_a", { poolId: "pool_office" });
    assert.deepEqual(byPool.services.map((s) => s.id), ["svc_amina_static"]);

    const overdue = await queryServicesDesk(sql, "ten_a", { overdue: true });
    assert.deepEqual(overdue.services.map((s) => s.id), ["svc_brian"]);

    const expiring = await queryServicesDesk(sql, "ten_a", { expiringSoon: true });
    assert.deepEqual(expiring.services.map((s) => s.id), ["svc_amina_pppoe"]);

    const combo = await queryServicesDesk(sql, "ten_a", { access: "hotspot", status: "expired" });
    assert.deepEqual(combo.services.map((s) => s.id), []);

    const sorted = await queryServicesDesk(sql, "ten_a", { sort: "customer", dir: "asc", pageSize: 10 });
    assert.equal(sorted.services[0]?.customer_name, "Amina Otieno");

    const live = (await queryServicesDesk(sql, "ten_a", { q: "amina.pppoe" })).services[0];
    assert.ok(live);
    assert.equal(live.last_activity?.startsWith("2026-09-14"), true);
    const csv = selectedServicesCsv([live]);
    assert.match(csv, /Amina Otieno/);
    assert.match(csv, /amina.pppoe/);
    assert.match(csv, /SAN-AMINA/);
    assert.doesNotMatch(csv, /AMN01/);
  } finally {
    await close();
  }
});
