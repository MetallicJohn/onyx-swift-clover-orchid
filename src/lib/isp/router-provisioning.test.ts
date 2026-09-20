import assert from "node:assert/strict";
import { test } from "node:test";
import { enrollFields, nextWgAddress } from "./agent.ts";
import { validateRosScript } from "./mikrotik-ops.ts";
import { applyRls } from "./rls.ts";
import {
  bootstrapPasteScript,
  configContainsSecrets,
  createIpPool,
  generateProvisionToken,
  generateRouterConfig,
  hashProvisionToken,
  ipPoolRanges,
  issueProvisioningToken,
  listAvailablePools,
  listTenantRouters,
  lookupRouterByProvisionToken,
  PROVISION_TOKEN_PREFIX,
  provisionTokenHint,
  publicOnlineStatus,
  revokeProvisioningToken,
  serveBootstrapRsc,
  setRouterPools,
  toPublicRouter,
} from "./router-provisioning.ts";
import { openTestDb } from "./test-db.ts";

test("provisioning tokens are unique, hashed, and hinted", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    const token = generateProvisionToken();
    assert.match(token, new RegExp(`^${PROVISION_TOKEN_PREFIX}`));
    assert.equal(token.length > 40, true);
    const hash = hashProvisionToken(token);
    assert.equal(hash.length, 64);
    assert.notEqual(hash, token);
    assert.equal(seen.has(hash), false);
    seen.add(hash);
    assert.equal(provisionTokenHint(token), token.slice(-4));
  }
});

test("bootstrap paste checks internet, fetches HTTPS, and skips MikroTik CA verify", () => {
  const script = bootstrapPasteScript({
    url: "https://ops.imani.ke/api/vpn/routers/prv_test/bootstrap.rsc",
    identity: "edge-01",
  });
  assert.deepEqual(validateRosScript(script), []);
  assert.match(script, /\/ping 1\.1\.1\.1 count=3/);
  assert.match(script, /\/ip cloud set update-time=yes/);
  assert.match(script, /\/system ntp client set enabled=yes/);
  assert.match(script, /check-certificate=no/);
  assert.match(script, /dst-path="flash\/ispsolutions-bootstrap.rsc"/);
  assert.match(script, /mode=https check-certificate=no/);
  assert.match(script, /output=user as-value/);
  assert.match(script, /Copy enroll/);
  assert.match(script, /https:\/\/ops\.imani\.ke\/api\/vpn\/routers\//);
  assert.match(script, /\/import file-name=\$bootFile/);
  assert.match(script, /:find \$n /);
  assert.doesNotMatch(script, /check-certificate=yes/);
  assert.doesNotMatch(script, /http:\/\//);
});

test("CIDR pool ranges skip network and broadcast", () => {
  assert.equal(ipPoolRanges("10.10.10.0/24"), "10.10.10.10-10.10.10.254");
  assert.equal(ipPoolRanges("10.8.0.0/30"), "10.8.0.1-10.8.0.2");
});

test("online is false until last_seen evidence exists", () => {
  assert.deepEqual(publicOnlineStatus(null, "pending"), { reachability: "pending", online: false });
  assert.equal(publicOnlineStatus("2026-09-16T07:20:00Z", "connected", Date.parse("2026-09-16T07:21:00Z")).online, true);
  const publicRow = toPublicRouter({
    id: "rtr_x",
    tenant_id: "ten_a",
    name: "edge",
    identity: "edge",
    location: "Nanyuki",
    role: "access",
    model: "RB5009",
    ros_version: "7.16",
    site_pop: "Nanyuki",
    management_ip: "",
    wg_status: "pending",
    last_seen: null,
    cpu_pct: 0,
    uptime_hours: 0,
    enroll_token: "agt_secret",
    wg_public: "pub",
    wg_address: "10.200.0.2/32",
    wg_private_ref: "enc:v1:nope",
    agent_version: "",
    provisioning_status: "awaiting_bootstrap",
    provision_token_hash: "abc",
    provision_token_hint: "wxyz",
    provision_token_expires_at: null,
    provision_token_revoked_at: null,
    provisioned_at: null,
    config_version: 0,
  });
  assert.equal(publicRow.online, false);
  assert.equal("enroll_token" in publicRow, false);
  assert.equal("wg_private_ref" in publicRow, false);
  assert.equal("provision_token_hash" in publicRow, false);
  assert.equal(configContainsSecrets(publicRow), false);
});

async function seedRouter(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], tenant = "ten_pv") {
  await sql`insert into tenants (id, name, slug, public_base_url)
    values (${tenant}, 'Imani', ${`isp-${tenant}`}, 'https://ops.imani.ke')
    on conflict (id) do nothing`;
  const enroll = enrollFields("edge-01");
  const address = await nextWgAddress(sql, tenant);
  await sql`insert into routers (
      id, tenant_id, name, identity, location, role, wg_status, last_seen,
      enroll_token, wg_public, wg_private_ref, wg_address, model, ros_version, site_pop, management_ip
    ) values (
      ${`rtr_${tenant}`}, ${tenant}, 'edge-01', 'edge-01', 'Nanyuki', 'access', 'pending', null,
      ${enroll.token}, ${enroll.wg_public}, ${enroll.wg_private_sealed}, ${address},
      'RB5009', '7.16', 'Nanyuki POP', '10.200.0.2'
    )`;
  await sql`insert into ip_pools (id, tenant_id, name, cidr, next_host)
    values (${`pool_${tenant}`}, ${tenant}, 'nanyuki', '10.10.10.0/24', 10)
    on conflict (id) do nothing`;
  return { enroll, address };
}

test("issue, fetch bootstrap over token, revoke, and isolate tenants", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedRouter(sql, "ten_pv");
    await seedRouter(sql, "ten_other");

    await asRole("ten_pv");
    const issued = await issueProvisioningToken(sql, { tenantId: "ten_pv", routerId: "rtr_ten_pv", actorUserId: "usr_a" });
    assert.match(issued.token, /^prv_/);
    assert.match(issued.bootstrap, /check-certificate=no/);
    assert.match(issued.enroll, /interface wireguard/);
    assert.match(issued.enroll, /\/user add name=/);
    assert.doesNotMatch(issued.bootstrap, /check-certificate=yes/);
    assert.doesNotMatch(issued.bootstrap, /YOUR-PUBLIC-URL/);
    assert.doesNotMatch(issued.bootstrap, /\{\{BOOTSTRAP_URL\}\}/);
    assert.match(issued.bootstrap, /https:\/\/ops\.imani\.ke\/api\/vpn\/routers\//);
    const [stored] = await sql<{ provision_token_hash: string; provisioning_status: string }>`
      select provision_token_hash, provisioning_status from routers where id = ${"rtr_ten_pv"}`;
    assert.equal(stored?.provision_token_hash, hashProvisionToken(issued.token));
    assert.notEqual(stored?.provision_token_hash, issued.token);
    assert.equal(stored?.provisioning_status, "awaiting_bootstrap");

    const listed = await listTenantRouters(sql, "ten_pv");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.online, false);
    assert.equal(configContainsSecrets(listed), false);

    await setRouterPools(sql, {
      tenantId: "ten_pv",
      routerId: "rtr_ten_pv",
      poolIds: ["pool_ten_pv"],
      push: false,
    });

    await bypass();
    const found = await lookupRouterByProvisionToken(sql, issued.token);
    assert.equal(found.error, null);
    assert.equal(found.router?.id, "rtr_ten_pv");

    const served = await serveBootstrapRsc(sql, issued.token);
    assert.equal(served.status, 200);
    assert.deepEqual(validateRosScript(served.body), []);
    assert.match(served.body, /interface wireguard/);
    assert.match(served.body, /\/ip pool/);
    assert.match(served.body, /nanyuki/);
    assert.match(served.body, /\/user add name=/);
    assert.match(served.body, /check-certificate=no/);
    assert.doesNotMatch(served.body, /check-certificate=yes/);

    await asRole("ten_pv");
    const [after] = await sql<{ provisioning_status: string; wg_status: string; last_seen: string | null }>`
      select provisioning_status, wg_status, last_seen::text as last_seen from routers where id = ${"rtr_ten_pv"}`;
    assert.equal(after?.provisioning_status, "bootstrapping");
    assert.equal(after?.wg_status, "pending");
    assert.equal(after?.last_seen, null);

    await setRouterPools(sql, {
      tenantId: "ten_pv",
      routerId: "rtr_ten_pv",
      poolIds: ["pool_ten_pv"],
      push: true,
    });
    const live = await lookupRouterByProvisionToken(sql, issued.token);
    const cfg = await generateRouterConfig(sql, "ten_pv", live.router!, "pools");
    assert.match(cfg.script, /nanyuki/);

    await revokeProvisioningToken(sql, { tenantId: "ten_pv", routerId: "rtr_ten_pv" });
    await bypass();
    const revoked = await lookupRouterByProvisionToken(sql, issued.token);
    assert.equal(revoked.error, "invalid");
    const gone = await serveBootstrapRsc(sql, issued.token);
    assert.equal(gone.status, 404);

    await asRole("ten_other");
    const other = await listTenantRouters(sql, "ten_other");
    assert.equal(other.some((r) => r.id === "rtr_ten_pv"), false);
    await assert.rejects(
      () => issueProvisioningToken(sql, { tenantId: "ten_other", routerId: "rtr_ten_pv" }),
      /Router not found/,
    );

    await applyRls(sql, { tenantId: "ten_pv", bypass: false });
  } finally {
    await close();
  }
});

test("duplicate overlay IPs are not assigned", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_wg', 'WG', 'wg-isp')`;
    const a = await nextWgAddress(sql, "ten_wg");
    await sql`insert into routers (id, tenant_id, name, wg_address) values ('r1', 'ten_wg', 'a', ${a})`;
    const b = await nextWgAddress(sql, "ten_wg");
    assert.notEqual(a, b);
  } finally {
    await close();
  }
});

test("IP pool create validates CIDR and is tenant-scoped", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedRouter(sql, "ten_pool");
    await asRole("ten_pool");
    const pool = await createIpPool(sql, { tenantId: "ten_pool", name: "PPPoE west", cidr: "10.20.0.0/24" });
    assert.equal(pool.ranges, "10.20.0.10-10.20.0.254");
    await assert.rejects(
      () => createIpPool(sql, { tenantId: "ten_pool", name: "bad", cidr: "not-a-cidr" }),
      /Invalid IPv4 CIDR/,
    );
    await assert.rejects(
      () => createIpPool(sql, { tenantId: "ten_pool", name: "PPPoE west", cidr: "10.30.0.0/24" }),
      /already exists/,
    );
    const listed = await listAvailablePools(sql, "ten_pool");
    assert.equal(listed.some((p) => p.id === pool.id), true);
  } finally {
    await close();
  }
});
