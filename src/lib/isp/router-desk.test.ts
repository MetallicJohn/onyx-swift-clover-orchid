import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { enrollFields, nextWgAddress } from "./agent.ts";
import { assertPermission, hasPermission } from "./rbac.ts";
import {
  archiveRouter,
  archiveRouterPool,
  createRouterPool,
  listPayloadHasSecrets,
  listPoolAssignments,
  listRouterPools,
  queryRoutersDesk,
  setPoolEnabled,
  setRouterEnabled,
  testRouterConnection,
  updateRouterPool,
} from "./router-desk.ts";
import {
  EMPTY_ROUTER_FILTERS,
  listPayloadHasSecrets as formatSecrets,
  normalizeRouterDeskQuery,
  routerRecordPath,
  validatePoolDraft,
} from "./router-desk-format.ts";
import { cidrOverlaps, ipv4InCidr } from "./ipam.ts";
import { openTestDb } from "./test-db.ts";

test("CIDR overlap and gateway membership are real IPv4 checks", () => {
  assert.equal(cidrOverlaps("10.10.10.0/24", "10.10.10.128/25"), true);
  assert.equal(cidrOverlaps("10.10.10.0/24", "10.10.11.0/24"), false);
  assert.equal(ipv4InCidr("10.10.10.1", "10.10.10.0/24"), true);
  assert.equal(ipv4InCidr("10.10.11.1", "10.10.10.0/24"), false);
});

test("pool drafts reject bad CIDR, inverted range, and gateway outside the network", () => {
  const ok = validatePoolDraft({
    name: "Nanyuki PPPoE",
    code: "NAN-PPPOE",
    cidr: "10.10.10.0/24",
    gateway: "10.10.10.1",
    first_ip: "10.10.10.10",
    last_ip: "10.10.10.250",
    access_type: "pppoe",
    vlan_id: 20,
  });
  assert.equal(ok.first_ip, "10.10.10.10");
  assert.equal(ok.last_ip, "10.10.10.250");
  assert.throws(() => validatePoolDraft({ name: "x", cidr: "not-a-cidr" }), /Invalid IPv4 CIDR/);
  assert.throws(
    () => validatePoolDraft({ name: "x", cidr: "10.10.10.0/24", gateway: "10.9.9.1" }),
    /Gateway must belong/,
  );
  assert.throws(
    () =>
      validatePoolDraft({
        name: "x",
        cidr: "10.10.10.0/24",
        first_ip: "10.10.10.50",
        last_ip: "10.10.10.10",
      }),
    /Start IP must not exceed end IP/,
  );
  assert.throws(() => validatePoolDraft({ name: "x", cidr: "10.10.10.0/24", vlan_id: 5000 }), /VLAN ID/);
});

test("router list path does not encode details or monitoring", () => {
  assert.equal(routerRecordPath("rtr_a"), "/app/routers/rtr_a");
  assert.equal(routerRecordPath("rtr_a", { tab: "pools" }), "/app/routers/rtr_a?tab=pools");
  assert.equal(normalizeRouterDeskQuery({ q: "  edge  ", page: 0 }).page, 1);
  assert.equal(formatSecrets({ enroll_token: "agt_secret" }), true);
  assert.equal(listPayloadHasSecrets({ name: "edge-01", identity: "edge" }), false);
});

async function seedDesk(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], tenant = "ten_rd") {
  await sql`insert into tenants (id, name, slug, public_base_url)
    values (${tenant}, 'Imani', ${`isp-${tenant}`}, 'https://ops.imani.ke')
    on conflict (id) do nothing`;
  const enroll = enrollFields("edge-01");
  const address = await nextWgAddress(sql, tenant);
  await sql`insert into routers (
      id, tenant_id, name, identity, location, role, wg_status, last_seen,
      enroll_token, wg_public, wg_private_ref, wg_address, model, vendor, ros_version, site_pop, management_ip
    ) values (
      ${`rtr_${tenant}`}, ${tenant}, 'edge-01', 'edge-01', 'Nanyuki', 'access', 'pending', null,
      ${enroll.token}, ${enroll.wg_public}, ${enroll.wg_private_sealed}, ${address},
      'RB5009', 'MikroTik', '7.16', 'Nanyuki POP', '10.200.0.2'
    )`;
  return { enroll, address, routerId: `rtr_${tenant}` };
}

test("router list is a summary: no full details, no secrets, tenant isolated", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedDesk(sql, "ten_rd");
    await seedDesk(sql, "ten_other");
    await asRole("ten_rd");
    const listed = await queryRoutersDesk(sql, "ten_rd", { ...EMPTY_ROUTER_FILTERS });
    assert.equal(listed.routers.length, 1);
    assert.equal(listed.routers[0]?.name, "edge-01");
    assert.equal(listed.routers[0]?.identity, "edge-01");
    assert.equal(listed.routers[0]?.pool_count, 0);
    assert.equal(listed.routers[0]?.service_count, 0);
    assert.equal(listPayloadHasSecrets(listed.routers), false);
    assert.equal("enroll_token" in (listed.routers[0] || {}), false);
    const other = await queryRoutersDesk(sql, "ten_other", { ...EMPTY_ROUTER_FILTERS });
    assert.equal(other.routers.some((r) => r.id === "rtr_ten_rd"), false);
  } finally {
    await close();
  }
});

test("create, duplicate, overlap, edit-with-usage, and archive of router IP pools", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { routerId } = await seedDesk(sql, "ten_pool");
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_p', 'ten_pool', 'Amina', '0712001001')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_p', 'ten_pool', 'Home 10', 'pppoe', 10, 10, 2500)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_p', 'ten_pool', 'cus_p', 'pkg_p', 'pppoe', 'amina', 'active')`;
    await asRole("ten_pool");

    const created = await createRouterPool(sql, {
      tenantId: "ten_pool",
      routerId,
      actorUserId: "usr_net",
      draft: { name: "Nanyuki PPPoE", code: "NAN1", cidr: "10.40.0.0/24", gateway: "10.40.0.1", access_type: "pppoe" },
    });
    assert.equal(created?.cidr, "10.40.0.0/24");
    assert.equal(created?.access_type, "pppoe");
    assert.ok((created?.total ?? 0) > 0);

    await assert.rejects(
      () =>
        createRouterPool(sql, {
          tenantId: "ten_pool",
          routerId,
          actorUserId: "usr_net",
          draft: { name: "Nanyuki PPPoE", cidr: "10.41.0.0/24" },
        }),
      /already exists/,
    );
    await assert.rejects(
      () =>
        createRouterPool(sql, {
          tenantId: "ten_pool",
          routerId,
          actorUserId: "usr_net",
          draft: { name: "Overlap", cidr: "10.40.0.0/25" },
        }),
      /overlaps/,
    );
    await assert.rejects(
      () =>
        createRouterPool(sql, {
          tenantId: "ten_other",
          routerId,
          actorUserId: "usr_net",
          draft: { name: "Foreign", cidr: "10.50.0.0/24" },
        }),
      /Router not found/,
    );

    const listed = await listRouterPools(sql, "ten_pool", routerId);
    assert.equal(listed.length, 1);

    await sql`insert into ip_addresses (id, tenant_id, pool_id, address, status, service_id, customer_id)
      values ('ipa_p', 'ten_pool', ${created!.id}, '10.40.0.20', 'assigned', 'svc_p', 'cus_p')`;
    const usage = await listPoolAssignments(sql, "ten_pool", created!.id);
    assert.equal(usage.length, 1);

    await assert.rejects(
      () =>
        updateRouterPool(sql, {
          tenantId: "ten_pool",
          routerId,
          poolId: created!.id,
          actorUserId: "usr_net",
          draft: { name: "Nanyuki PPPoE", cidr: "10.40.0.0/25", gateway: "10.40.0.1" },
        }),
      /Confirm the change/,
    );
    await assert.rejects(
      () =>
        updateRouterPool(sql, {
          tenantId: "ten_pool",
          routerId,
          poolId: created!.id,
          actorUserId: "usr_net",
          confirmImpact: true,
          draft: {
            name: "Nanyuki PPPoE",
            cidr: "10.40.0.0/30",
            gateway: "10.40.0.1",
            first_ip: "10.40.0.1",
            last_ip: "10.40.0.2",
          },
        }),
      /would fall outside/,
    );

    await assert.rejects(
      () => archiveRouterPool(sql, { tenantId: "ten_pool", routerId, poolId: created!.id, actorUserId: "usr_net" }),
      /still assigned/,
    );

    await sql`update ip_addresses set service_id = null, status = 'available' where id = 'ipa_p'`;
    await sql`delete from ip_addresses where id = 'ipa_p'`;
    const archived = await archiveRouterPool(sql, {
      tenantId: "ten_pool",
      routerId,
      poolId: created!.id,
      actorUserId: "usr_net",
    });
    assert.equal(archived.ok, true);
    const after = await listRouterPools(sql, "ten_pool", routerId);
    assert.equal(after.length, 0);

    const [audit] = await sql<{ n: number }>`select count(*)::int as n from audit_logs where tenant_id = 'ten_pool' and entity_type = 'ip_pool'`;
    assert.ok((audit?.n ?? 0) >= 2);
  } finally {
    await close();
  }
});

test("enable/disable and archive stay on the tenant; connection test uses stored evidence only", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { routerId } = await seedDesk(sql, "ten_en");
    await asRole("ten_en");
    const probe = await testRouterConnection(sql, "ten_en", routerId);
    assert.equal(probe.online, false);
    assert.equal(probe.source, "none");
    await setRouterEnabled(sql, { tenantId: "ten_en", routerId, actorUserId: "usr_a", enabled: false });
    const listed = await queryRoutersDesk(sql, "ten_en", { ...EMPTY_ROUTER_FILTERS, status: "disabled" });
    assert.equal(listed.routers[0]?.enabled, false);
    await archiveRouter(sql, { tenantId: "ten_en", routerId, actorUserId: "usr_a" });
    const live = await queryRoutersDesk(sql, "ten_en", { ...EMPTY_ROUTER_FILTERS });
    assert.equal(live.routers.length, 0);
    const archived = await queryRoutersDesk(sql, "ten_en", { ...EMPTY_ROUTER_FILTERS, status: "archived" });
    assert.equal(archived.routers.length, 1);
  } finally {
    await close();
  }
});

test("RBAC: technicians cannot manage routers or IP pools; support can read", () => {
  assert.equal(hasPermission("technician", "routers.read"), false);
  assert.equal(hasPermission("technician", "routers.manage"), false);
  assert.equal(hasPermission("support", "routers.read"), true);
  assert.equal(hasPermission("support", "routers.manage"), false);
  assert.equal(hasPermission("network_engineer", "routers.manage"), true);
  assert.throws(() => assertPermission("finance", "routers.read"), /Forbidden/);
  const server = readFileSync(new URL("./server-routers.ts", import.meta.url), "utf8");
  assert.match(server, /export const queryRoutersDeskFn[\s\S]+?assertPermission\(role, "routers.read"\)/);
  assert.match(server, /export const getRouterDeskFn[\s\S]+?assertPermission\(role, "routers.read"\)/);
  assert.match(server, /export const createRouterPoolFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(server, /export const copyRouterApiUser[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(server, /export const repairRouterConnectionFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(server, /export const rotateRouterWireGuardFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(server, /export const rotateRouterApiFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(server, /export const regenerateRouterAgentFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(server, /export const updateRouterPoolFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
  assert.match(server, /export const archiveRouterPoolFn[\s\S]+?assertPermission\(role, "routers.manage"\)/);
});

test("list page does not load details, pools, or monitoring", () => {
  const page = readFileSync(new URL("../../routes/app/routers.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../components/isp/router-desk-ui.tsx", import.meta.url), "utf8");
  assert.match(page, /queryRoutersDeskFn/);
  assert.match(ui, /Loading routers/);
  assert.doesNotMatch(page, /RouterMonitor/);
  assert.doesNotMatch(page, /getRouterDetailFn/);
  assert.doesNotMatch(page, /listAgentQueue/);
  assert.doesNotMatch(page, /routerTelemetryFn/);
  const detail = readFileSync(new URL("../../routes/app/routers.$routerId.tsx", import.meta.url), "utf8");
  assert.match(detail, /Show monitoring/);
  assert.match(detail, /Hide monitoring/);
  assert.match(detail, /createFileRoute\("\/app\/routers\/\$routerId"\)/);
  assert.match(detail, /Repair Connection/);
  assert.match(detail, /Rotate WireGuard/);
  assert.match(detail, /Rotate API Credentials/);
  assert.match(detail, /Regenerate Agent/);
  assert.match(detail, /Test Connection/);
  assert.match(detail, /Generate Enrollment Script/);
});

test("setPoolEnabled toggles without deleting assignments", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { routerId } = await seedDesk(sql, "ten_dis");
    await asRole("ten_dis");
    const pool = await createRouterPool(sql, {
      tenantId: "ten_dis",
      routerId,
      actorUserId: "usr_a",
      draft: { name: "Hotspot", cidr: "10.90.0.0/24", access_type: "hotspot" },
    });
    const off = await setPoolEnabled(sql, {
      tenantId: "ten_dis",
      routerId,
      poolId: pool!.id,
      actorUserId: "usr_a",
      enabled: false,
    });
    assert.equal(off.status, "disabled");
    const rows = await listRouterPools(sql, "ten_dis", routerId);
    assert.equal(rows[0]?.status, "disabled");
  } finally {
    await close();
  }
});
