import assert from "node:assert/strict";
import { test } from "node:test";
import { enrollFields, enqueueServiceCommand } from "./agent.ts";
import { allocateStaticIp } from "./access-service.ts";
import { activateVoucher, generateVouchers, revokeVoucher } from "./hotspot.ts";
import { compileMikrotik, executeRestOps, pullCommands, queueCompiledCommand, renderAgentScript } from "./mikrotik.ts";
import {
  commandDiff,
  duplicateRisks,
  inverseCommand,
  markUnreachableRouters,
  restOpsUnreachable,
  rollbackCommand,
  routerReachability,
  validateRosScript,
} from "./mikrotik-ops.ts";
import { enrollRosScript, wrapPullRosScript } from "./routeros.ts";
import { openTestDb } from "./test-db.ts";
import { generateWireGuardKeypair, generateX25519Pair, x25519Agree } from "./wireguard.ts";

const PKG = { package: "Home 10", upload_mbps: 5, download_mbps: 10 };

function enroll(extra: Partial<Parameters<typeof enrollRosScript>[0]> = {}) {
  const hub = generateWireGuardKeypair();
  const client = generateWireGuardKeypair();
  return enrollRosScript({
    name: "edge-01",
    identity: "edge-01",
    token: "agt_testtoken",
    wgPublic: client.publicKey,
    wgPrivate: client.privateKey,
    wgAddress: "10.200.0.2/32",
    serverPublic: hub.publicKey,
    endpointHost: "vpn.imani.ke",
    endpointPort: 51820,
    serverAddress: "10.200.0.1",
    pullUrl: "https://ops.imani.ke/api/agent/script?token=agt_testtoken",
    apiUser: "ispsolutions",
    apiPassword: "ApiPassTest123",
    ...extra,
  });
}

test("router enrollment script is RouterOS v7 and names ISP Solutions", () => {
  const script = enroll();
  const issues = validateRosScript(script);
  assert.deepEqual(issues, []);
  assert.match(script, /ISP Solutions agent enroll/);
  assert.match(script, /interface wireguard add name=wg-ispsolutions/);
  assert.match(script, /system script add name="ispsolutions-pull"/);
  assert.match(script, /system scheduler add name="ispsolutions-agent"/);
  assert.match(script, /\/ip service set api disabled=no port=8728 address=10\.200\.0\.0\/24/);
  assert.match(script, /\/user add name="ispsolutions" password=/);
  assert.match(script, /allowed-address="10\.200\.0\.1\/32"/);
  assert.match(script, /ispSolLock/);
  assert.match(script, /check-certificate=no/);
  assert.doesNotMatch(script, /enrolled token=/);
  assert.doesNotMatch(script, /www-ssl/);
  assert.doesNotMatch(script, /\/ip service set winbox/);
  assert.doesNotMatch(script, /in-interface=wg-ispsolutions action=accept;/);
  assert.match(script, /persistent-keepalive=25s/);
  assert.match(script, /check-certificate=no/);
  assert.doesNotMatch(script, /check-certificate=yes/);
  assert.doesNotMatch(script, /http-method=get/);
  assert.equal(duplicateRisks(script).length, 0);
});

test("enrollment skips the API user when no password is stored", () => {
  const script = enroll({ apiPassword: "" });
  assert.doesNotMatch(script, /\/user add name=/);
});

test("WireGuard overlay is live only when the hub endpoint is set", () => {
  const withEp = enroll();
  assert.match(withEp, /endpoint-address="vpn.imani.ke" endpoint-port=51820/);
  assert.doesNotMatch(withEp, /cannot start the handshake/);
  const missing = enroll({ endpointHost: "" });
  assert.match(missing, /cannot start the handshake/);
  assert.doesNotMatch(missing, /endpoint-address=/);
  const a = generateX25519Pair();
  const b = generateX25519Pair();
  assert.notEqual(a.publicKey, b.publicKey);
  const ab = x25519Agree(a.privateKey, b.publicKey);
  const ba = x25519Agree(b.privateKey, a.publicKey);
  assert.deepEqual(ab, ba);
});

test("easy queues: PCQ types create/update; leftover simple queues are removed, never added", () => {
  const up = compileMikrotik("static.upsert", { username: "brian", static_ip: "10.10.10.20", ...PKG });
  assert.match(up.script, /\/queue type add name=\$upType kind=pcq/);
  assert.match(up.script, /\/queue type set \[find where name=\$upType\]/);
  assert.match(up.script, /\/queue simple remove \[find where name=\$qname\]/);
  assert.doesNotMatch(up.script, /\/queue simple add/);
  const down = compileMikrotik("static.disable", { username: "brian", static_ip: "10.10.10.20", ...PKG, status: "suspended" });
  assert.match(down.script, /\/queue simple remove/);
  assert.match(down.script, /\/ip firewall address-list remove/);
  assert.equal(up.rest.some((op) => op.path.includes("/queue/simple") && op.method === "PUT"), false);
  assert.ok(down.rest.some((op) => op.path.includes("/queue/simple") && op.method === "DELETE"));
});

test("PPPoE profiles are created or updated, never duplicated", () => {
  const { script, rest } = compileMikrotik("pppoe.upsert", { username: "amina", password: "s3cret", ...PKG });
  assert.deepEqual(validateRosScript(script), []);
  assert.deepEqual(duplicateRisks(script), []);
  assert.match(script, /\/ppp profile add name=\$profile/);
  assert.match(script, /\/ppp secret add name=\$user/);
  assert.match(script, /\[:len \[\/ppp secret find where name=\$user\]\] = 0/);
  assert.ok(rest.some((op) => op.path === "/rest/ppp/profile" && op.body?.name === "isp-home-10"));
  assert.ok(rest.some((op) => op.path === "/rest/ppp/secret" && op.body?.profile === "isp-home-10"));
});

test("static IP services bind the package address-list without duplicate entries", () => {
  const { script } = compileMikrotik("static.upsert", { username: "brian", static_ip: "10.10.10.20", ...PKG });
  assert.deepEqual(validateRosScript(script), []);
  assert.deepEqual(duplicateRisks(script), []);
  assert.match(script, /list=\$list address=\$ip/);
  assert.match(script, /list="ispsolutions-active"/);
  assert.match(script, /\[:len \[\/ip firewall address-list find where list=\$list and address=\$ip\]\] = 0/);
  const dup = `/ip firewall address-list add list=isp-home-10 address=10.10.10.20
/ip firewall address-list add list=isp-home-10 address=10.10.10.20`;
  assert.ok(duplicateRisks(dup).includes("address-list add without existence check"));
});

test("hotspot users upsert or disable without duplicate add", () => {
  const up = compileMikrotik("hotspot.upsert", { username: "HS-ABC123", password: "daypass", ...PKG });
  assert.deepEqual(validateRosScript(up.script), []);
  assert.deepEqual(duplicateRisks(up.script), []);
  assert.match(up.script, /\/ip hotspot user add name=\$user/);
  const off = compileMikrotik("hotspot.disable", { username: "HS-ABC123", status: "terminated" });
  assert.match(off.script, /disabled=yes/);
  assert.match(off.script, /\/ip hotspot active remove/);
});

test("service suspension disables the secret and kicks the session; restore re-enables", () => {
  const suspend = compileMikrotik("pppoe.disable", { username: "amina", status: "suspended" });
  assert.match(suspend.script, /disabled=yes/);
  assert.match(suspend.script, /\/ppp active remove/);
  const restore = compileMikrotik("pppoe.upsert", { username: "amina", password: "s3cret", status: "active", ...PKG });
  assert.match(restore.script, /disabled=no/);
  const inv = inverseCommand("pppoe.upsert", { username: "amina" });
  assert.equal(inv?.kind, "pppoe.disable");
  const back = inverseCommand("pppoe.disable", { username: "amina" });
  assert.equal(back?.kind, "pppoe.upsert");
});

test("configuration diff reports only changed fields", () => {
  const before = { username: "amina", package: "Home 10", download_mbps: 10, upload_mbps: 5 };
  const after = { username: "amina", package: "Home 20", download_mbps: 20, upload_mbps: 5 };
  const diff = commandDiff(before, after);
  assert.equal(diff.same, false);
  assert.deepEqual(diff.changed, ["download_mbps", "package"]);
  assert.equal(commandDiff(before, { ...before }).same, true);
});

test("RouterOS syntax errors are rejected; generated scripts are not", () => {
  assert.ok(validateRosScript("{ :put \"oops\"").some((i) => i.message.includes("brace")));
  assert.ok(validateRosScript(":put \"oops").some((i) => i.message.includes("unterminated")));
  assert.ok(validateRosScript("/rest/ppp/secret").some((i) => i.message.includes("REST")));
  assert.ok(validateRosScript(":do { :put 1 } on-error=fail").some((i) => i.message.includes("on-error")));
  assert.deepEqual(validateRosScript("/tool fetch url=https://x check-certificate=no"), []);
  assert.deepEqual(validateRosScript(enroll()), []);
  const wrapped = wrapPullRosScript({
    identity: "edge-01",
    commands: [{ id: "cmd_1", kind: "pppoe.upsert", script: compileMikrotik("pppoe.upsert", { username: "a", ...PKG }).script }],
  });
  assert.deepEqual(validateRosScript(wrapped), []);
  assert.match(wrapped, /on-error=\{\s*:log error/);
});

test("duplicate simple queues are flagged; generated scripts stay idempotent", () => {
  const bad = `/queue simple add name=static-brian target=10.10.10.20
/queue simple add name=static-brian target=10.10.10.20`;
  assert.ok(duplicateRisks(bad).some((r) => r.includes("duplicate queue")));
  const pppoe = compileMikrotik("pppoe.upsert", { username: "amina", password: "x", ...PKG }).script;
  const staticIp = compileMikrotik("static.upsert", { username: "brian", static_ip: "10.10.10.20", ...PKG }).script;
  const hs = compileMikrotik("hotspot.upsert", { username: "guest", password: "x", ...PKG }).script;
  assert.equal(duplicateRisks(pppoe).length, 0);
  assert.equal(duplicateRisks(staticIp).length, 0);
  assert.equal(duplicateRisks(hs).length, 0);
});

test("router reachability: pending, connected, stale, then unreachable", () => {
  const now = Date.parse("2026-09-13T17:00:00Z");
  assert.equal(routerReachability(null, now, "pending"), "pending");
  assert.equal(routerReachability("2026-09-13T16:59:00Z", now, "connected"), "connected");
  assert.equal(routerReachability("2026-09-13T16:55:00Z", now, "connected"), "stale");
  assert.equal(routerReachability("2026-09-13T16:40:00Z", now, "connected"), "unreachable");
});

test("MikroTik REST marks the box unreachable when the overlay is down", async () => {
  const results = await executeRestOps("http://127.0.0.1:1", "ispsolutions", "x", 443, [
    { method: "GET", path: "/rest/system/resource" },
  ]);
  assert.equal(results[0]?.status, 0);
  assert.match(results[0]?.body || "", /unreachable/);
  assert.equal(restOpsUnreachable(results), true);
});

test("enrollment pull, IP pool, vouchers, suspend/restore, rollback, and unreachable sweep", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_mt', 'Mikro', 'mikro')`;
    await sql`insert into tenants (id, name, slug) values ('ten_b', 'Other', 'other')`;
    const enrollA = enrollFields("edge-01");
    await sql`insert into routers (id, tenant_id, name, identity, enroll_token, wg_public, wg_private_ref, wg_address, wg_status, last_seen)
      values ('rtr_mt', 'ten_mt', 'edge-01', 'edge-01', ${enrollA.token}, ${enrollA.wg_public}, ${enrollA.wg_private_sealed}, '10.200.0.2/32', 'pending', null)`;
    await sql`insert into routers (id, tenant_id, name, identity, enroll_token, wg_status, last_seen)
      values ('rtr_old', 'ten_mt', 'edge-old', 'edge-old', 'agt_old', 'connected', ${"2026-01-01T00:00:00Z"})`;
    await sql`insert into customers (id, tenant_id, name, phone)
      values ('cus_mt', 'ten_mt', 'Amina', '0700000001'), ('cus_st', 'ten_mt', 'Brian', '0700000002')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_pp', 'ten_mt', 'Home 10', 'pppoe', 10, 10, 2500),
             ('pkg_st', 'ten_mt', 'Static 10', 'static', 10, 5, 3000),
             ('pkg_hs', 'ten_mt', 'Hotspot Day', 'hotspot', 5, 5, 100)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_pp', 'ten_mt', 'cus_mt', 'pkg_pp', 'pppoe', 'amina', 'active')`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status)
      values ('svc_st', 'ten_mt', 'cus_st', 'pkg_st', 'static', 'brian', null, 'active')`;
    await sql`insert into ip_pools (id, tenant_id, name, cidr, next_host)
      values ('pool_mt', 'ten_mt', 'nanyuki', '10.10.10.0/24', 20),
             ('pool_b', 'ten_b', 'other', '10.10.10.0/24', 20)`;

    await asRole("ten_mt");

    const pulledEmpty = await pullCommands(sql, enrollA.token, true);
    assert.equal(pulledEmpty.router.id, "rtr_mt");
    const [online] = await sql<{ wg_status: string }>`select wg_status from routers where id = ${"rtr_mt"}`;
    assert.equal(online?.wg_status, "connected");
    await assert.rejects(() => pullCommands(sql, "agt_nope", true), /Unknown enroll token/);

    const ip = await allocateStaticIp(sql, "ten_mt", "svc_st", "cus_st");
    assert.equal(ip, "10.10.10.20");
    const again = await allocateStaticIp(sql, "ten_mt", "svc_st", "cus_st");
    assert.equal(again, "10.10.10.21");
    await bypass();
    await sql`insert into customers (id, tenant_id, name) values ('cus_b', 'ten_b', 'Other')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_b', 'ten_b', 'Home', 'static', 10, 10, 1)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, status)
      values ('svc_b', 'ten_b', 'cus_b', 'pkg_b', 'static', 'active')`;
    await asRole("ten_b");
    const otherIp = await allocateStaticIp(sql, "ten_b", "svc_b", "cus_b");
    assert.equal(otherIp, "10.10.10.20");

    await asRole("ten_mt");
    const vouchers = await generateVouchers(sql, "ten_mt", "pkg_hs", 2, 24);
    assert.equal(vouchers.codes.length, 2);
    const [vrow] = await sql<{ id: string }>`select id from hotspot_vouchers where tenant_id = ${"ten_mt"} and code = ${vouchers.codes[0]}`;
    const activated = await activateVoucher(sql, "ten_mt", vrow!.id);
    assert.equal(activated.code, vouchers.codes[0]);
    const hsCmds = await sql<{ kind: string }>`select kind from agent_commands where tenant_id = ${"ten_mt"} and kind like 'hotspot.%'`;
    assert.ok(hsCmds.some((c) => c.kind === "hotspot.upsert"));
    await revokeVoucher(sql, "ten_mt", vrow!.id);
    const afterRevoke = await sql<{ kind: string }>`select kind from agent_commands where tenant_id = ${"ten_mt"} and kind = 'hotspot.disable'`;
    assert.ok(afterRevoke.length >= 1);

    const queued = await enqueueServiceCommand(sql, "ten_mt", {
      id: "svc_pp",
      access_method: "pppoe",
      username: "amina",
      static_ip: null,
      status: "suspended",
      package_name: "Home 10",
    });
    assert.ok(queued);
    const [suspendCmd] = await sql<{ kind: string; payload: string }>`select kind, payload from agent_commands where id = ${queued}`;
    assert.equal(suspendCmd?.kind, "pppoe.disable");
    await enqueueServiceCommand(sql, "ten_mt", {
      id: "svc_pp",
      access_method: "pppoe",
      username: "amina",
      static_ip: null,
      status: "active",
      package_name: "Home 10",
      password: "s3cret",
    });

    const applied = await queueCompiledCommand(sql, "ten_mt", "rtr_mt", "pppoe.upsert", { username: "amina", password: "s3cret", ...PKG });
    await sql`update agent_commands set status = 'acked' where id = ${applied.id}`;
    const rolled = await rollbackCommand(sql, "ten_mt", applied.id, "user_1");
    assert.equal(rolled.kind, "pppoe.disable");
    assert.match(rolled.script, /disabled=yes/);
    await assert.rejects(() => rollbackCommand(sql, "ten_mt", rolled.id), /Only applied/);

    const rendered = await renderAgentScript(sql, enrollA.token);
    assert.match(rendered.script, /ISP Solutions agent pull/);
    assert.match(rendered.script, /on-error=/);

    const sweep = await markUnreachableRouters(sql, "ten_mt", new Date("2026-09-13T17:00:00Z"));
    assert.ok(sweep.marked >= 1);
    const [old] = await sql<{ wg_status: string }>`select wg_status from routers where id = ${"rtr_old"}`;
    assert.equal(old?.wg_status, "unreachable");
  } finally {
    await close();
  }
});
