import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountState,
  accountStateLabel,
  customerInitials,
  customerRecordPath,
  deskFilterChips,
  EMPTY_DESK_FILTERS,
  hasActiveDeskFilters,
  likeNeedle,
  lineStatusFromLines,
  lineStatusLabel,
  normalizeDeskQuery,
  normalizeProfileSearch,
  packageSummary,
  queryCustomersDesk,
  selectedCustomersCsv,
  serviceStatusSummary,
  uniqueSmsRecipients,
} from "./customer-desk.ts";
import { openTestDb } from "./test-db.ts";

test("desk helpers keep search and presentation honest", () => {
  assert.equal(likeNeedle("ami%na"), "%ami#%na%");
  assert.equal(likeNeedle("svc_amina"), "%svc#_amina%");
  assert.equal(customerInitials("Amina Otieno"), "AO");
  assert.equal(packageSummary(["Home 10", "Home 10", "Business"]), "Home 10 +1");
  assert.equal(serviceStatusSummary([]), "No service");
  assert.equal(serviceStatusSummary([{ status: "active" }, { status: "active" }, { status: "suspended" }]), "2 active · 1 suspended");
  assert.equal(accountState({ customerStatus: "active", live: 0, suspended: 2 }), "suspended");
  assert.equal(accountState({ customerStatus: "active", live: 1, suspended: 1 }), "active");
  assert.equal(accountState({ customerStatus: "inactive", live: 1, suspended: 0 }), "inactive");
  assert.equal(lineStatusFromLines([]), "none");
  assert.equal(lineStatusFromLines([{ status: "suspended", period_end: null, access_until: null }]), "suspended");
  assert.equal(
    lineStatusFromLines([{ status: "terminated", period_end: "2020-01-01T00:00:00Z", access_until: null }]),
    "expired",
  );
  const q = normalizeDeskQuery({ q: "  Amina  ", page: 0, tagIds: ["tag_a", "tag_a", ""] });
  assert.equal(q.q, "Amina");
  assert.equal(q.page, 1);
  assert.deepEqual(q.tagIds, ["tag_a"]);
  assert.equal(hasActiveDeskFilters(q), true);
  assert.equal(accountStateLabel("inactive"), "Inactive");
  assert.equal(lineStatusLabel("grace"), "Grace Period");
  assert.deepEqual(normalizeProfileSearch({ tab: "billing", action: "add-service" }), { tab: "billing", action: "add-service" });
  assert.deepEqual(normalizeProfileSearch({ tab: "overview" }), { tab: undefined, action: undefined });
  assert.equal(customerRecordPath("cus_1", { tab: "services", action: "add-service" }), "/app/customers/cus_1?tab=services&action=add-service");
  const chips = deskFilterChips({ ...EMPTY_DESK_FILTERS, customerStatus: "suspended", overdue: true, tagIds: ["tag_vip"] }, [
    { id: "tag_vip", name: "VIP" },
  ]);
  assert.equal(chips.some((c) => c.label === "Customer: Suspended"), true);
  assert.equal(chips.some((c) => c.label === "Overdue"), true);
  assert.equal(chips.some((c) => c.label === "VIP"), true);
});

test("SMS recipient count skips empty, invalid, and duplicate phones", () => {
  const out = uniqueSmsRecipients([
    { id: "a", phone: "0712001001" },
    { id: "b", phone: "" },
    { id: "c", phone: "not-a-phone" },
    { id: "d", phone: "254712001001" },
    { id: "e", phone: "0712001002" },
  ]);
  assert.deepEqual(
    out.recipients.map((r) => r.id),
    ["a", "e"],
  );
  assert.equal(out.skipped.some((s) => s.reason === "missing"), true);
  assert.equal(out.skipped.some((s) => s.reason === "invalid"), true);
  assert.equal(out.skipped.some((s) => s.reason === "duplicate"), true);
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
    ('cus_none', 'ten_a', 'David NoLine', '', '', '', 'active', 'DAV04', now() - interval '7 days'),
    ('cus_gone', 'ten_a', 'Archived One', '0712001099', '', 'Town', 'active', 'ARC99', now() - interval '6 days'),
    ('cus_b', 'ten_b', 'Other ISP', '0712001999', 'o@x.test', 'Mombasa', 'active', 'OTH01', now() - interval '5 days')`;
  await sql`update customers set deleted_at = now() where id = 'cus_gone'`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end) values
    ('svc_amina_pppoe', 'ten_a', 'cus_live', 'pkg_home', 'pppoe', 'amina.pppoe', null, 'active', now() + interval '3 days'),
    ('svc_amina_static', 'ten_a', 'cus_live', 'pkg_static', 'static', null, '10.8.0.44', 'suspended', now() + interval '20 days'),
    ('svc_brian', 'ten_a', 'cus_susp', 'pkg_home', 'pppoe', 'brian.pppoe', null, 'suspended', now() + interval '12 days'),
    ('svc_cynthia', 'ten_a', 'cus_exp', 'pkg_hot', 'hotspot', 'cynthia.hot', null, 'terminated', now() - interval '12 days'),
    ('svc_b', 'ten_b', 'cus_b', 'pkg_b', 'pppoe', 'other.pppoe', null, 'active', now() + interval '30 days')`;
  await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, paid_kes, status, due_date) values
    ('inv_over', 'ten_a', 'cus_susp', 'INV-1', 2500, 0, 'overdue', current_date - 4),
    ('inv_ok', 'ten_a', 'cus_live', 'INV-2', 2500, 2500, 'paid', current_date + 10)`;
  await sql`insert into payments (id, tenant_id, customer_id, provider, amount_kes, reference, status, paid_at)
    values ('pay_live', 'ten_a', 'cus_live', 'mpesa', 2500, 'PAYLIVE', 'confirmed', '2026-09-10T08:00:00Z')`;
  await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status, created_at)
    values ('tix_live', 'ten_a', 'cus_live', 'Slow', 'network', 'normal', 'open', '2026-09-12T10:00:00Z')`;
  await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out, started_at, stopped_at)
    values ('rad_live', 'ten_a', 'amina.pppoe', '10.8.0.20', '10.0.0.1', 1000, 2000, '2026-09-14T06:00:00Z', '2026-09-14T07:00:00Z')`;
  await sql`insert into customer_tags (id, tenant_id, name, slug, enabled)
    values ('tag_vip', 'ten_a', 'VIP', 'vip', true), ('tag_b', 'ten_b', 'Other', 'other', true)`;
  await sql`insert into customer_tag_assignments (tenant_id, customer_id, tag_id)
    values ('ten_a', 'cus_live', 'tag_vip')`;
}

test("customer desk searches live records, pages, and stays in the tenant", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");

    const all = await queryCustomersDesk(sql, "ten_a", { pageSize: 2 });
    assert.equal(all.counters.total, 4);
    assert.equal(all.counters.active, 1);
    assert.equal(all.counters.suspended, 1);
    assert.equal(all.counters.overdue, 1);
    assert.equal(all.total, 4);
    assert.equal(all.pages, 2);
    assert.equal(all.customers.length, 2);
    assert.equal(all.customers.some((c) => c.id === "cus_gone"), false);
    assert.equal(all.customers.some((c) => c.id === "cus_b"), false);

    const byName = await queryCustomersDesk(sql, "ten_a", { q: "Amina" });
    assert.deepEqual(byName.customers.map((c) => c.id), ["cus_live"]);
    const byAccount = await queryCustomersDesk(sql, "ten_a", { q: "BRN02" });
    assert.deepEqual(byAccount.customers.map((c) => c.id), ["cus_susp"]);
    const byPhone = await queryCustomersDesk(sql, "ten_a", { q: "0712001003" });
    assert.deepEqual(byPhone.customers.map((c) => c.id), ["cus_exp"]);
    const byEmail = await queryCustomersDesk(sql, "ten_a", { q: "amina@isp.test" });
    assert.deepEqual(byEmail.customers.map((c) => c.id), ["cus_live"]);
    const byService = await queryCustomersDesk(sql, "ten_a", { q: "svc_amina_static" });
    assert.deepEqual(byService.customers.map((c) => c.id), ["cus_live"]);
    const byUser = await queryCustomersDesk(sql, "ten_a", { q: "amina.pppoe" });
    assert.deepEqual(byUser.customers.map((c) => c.id), ["cus_live"]);
    const byIp = await queryCustomersDesk(sql, "ten_a", { q: "10.8.0.44" });
    assert.deepEqual(byIp.customers.map((c) => c.id), ["cus_live"]);
    const byHotspot = await queryCustomersDesk(sql, "ten_a", { q: "cynthia.hot" });
    assert.deepEqual(byHotspot.customers.map((c) => c.id), ["cus_exp"]);
    const byPlace = await queryCustomersDesk(sql, "ten_a", { q: "Westlands" });
    assert.deepEqual(byPlace.customers.map((c) => c.id), ["cus_susp"]);

    const archived = await queryCustomersDesk(sql, "ten_a", { q: "Archived" });
    assert.equal(archived.total, 0);

    const other = await queryCustomersDesk(sql, "ten_b", { q: "Amina" });
    assert.equal(other.total, 0);
  } finally {
    await close();
  }
});

test("customer desk filters combine and never treat a dead line as an active customer", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");

    const active = await queryCustomersDesk(sql, "ten_a", { customerStatus: "active" });
    assert.deepEqual(active.customers.map((c) => c.id), ["cus_live"]);
    assert.equal(active.customers[0]?.account_state, "active");
    assert.equal(active.customers[0]?.line_status, "active");
    assert.match(active.customers[0]?.service_status_summary || "", /active/);
    assert.match(active.customers[0]?.package_summary || "", /Home 10/);
    assert.equal(active.customers[0]?.service_count, 2);

    const suspended = await queryCustomersDesk(sql, "ten_a", { customerStatus: "suspended" });
    assert.deepEqual(suspended.customers.map((c) => c.id), ["cus_susp"]);
    assert.equal(suspended.customers[0]?.account_state, "suspended");
    assert.equal(suspended.customers[0]?.overdue, true);

    const inactive = await queryCustomersDesk(sql, "ten_a", { customerStatus: "inactive" });
    assert.deepEqual(inactive.customers.map((c) => c.id).sort(), ["cus_exp", "cus_none"]);
    assert.equal(inactive.customers.find((c) => c.id === "cus_exp")?.account_state, "inactive");

    const pppoe = await queryCustomersDesk(sql, "ten_a", { access: "pppoe" });
    assert.equal(pppoe.customers.every((c) => c.access_methods.includes("pppoe")), true);

    const office = await queryCustomersDesk(sql, "ten_a", { packageName: "Office" });
    assert.deepEqual(office.customers.map((c) => c.id), ["cus_live"]);

    const kasarani = await queryCustomersDesk(sql, "ten_a", { location: "Kasarani" });
    assert.equal(kasarani.customers.every((c) => c.address === "Kasarani"), true);

    const overdue = await queryCustomersDesk(sql, "ten_a", { overdue: true });
    assert.deepEqual(overdue.customers.map((c) => c.id), ["cus_susp"]);

    const expiring = await queryCustomersDesk(sql, "ten_a", { expiringSoon: true });
    assert.deepEqual(expiring.customers.map((c) => c.id), ["cus_live"]);

    const vip = await queryCustomersDesk(sql, "ten_a", { tagIds: ["tag_vip"] });
    assert.deepEqual(vip.customers.map((c) => c.id), ["cus_live"]);

    const hotspotExpired = await queryCustomersDesk(sql, "ten_a", { access: "hotspot", serviceStatus: "terminated" });
    assert.deepEqual(hotspotExpired.customers.map((c) => c.id), ["cus_exp"]);

    const live = (await queryCustomersDesk(sql, "ten_a", { q: "Amina" })).customers[0];
    assert.ok(live);
    assert.equal(live.last_activity?.startsWith("2026-09-14"), true);
    assert.ok(live.next_expiry);
    assert.equal(live.live_service_ids.includes("svc_amina_pppoe"), true);
    assert.equal(live.suspended_service_ids.includes("svc_amina_static"), true);
    const csv = selectedCustomersCsv([live]);
    assert.match(csv, /Amina Otieno/);
    assert.match(csv, /AMN01/);
  } finally {
    await close();
  }
});
