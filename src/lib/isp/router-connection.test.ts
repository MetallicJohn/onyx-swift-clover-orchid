import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AUTOCOPY_DONE, AUTOCOPY_IDLE, COPY_SCRIPT_IDLE, autocopyLabel, copyScriptLabel } from "../copy-text.ts";
import { enrollFields, nextWgAddress } from "./agent.ts";
import {
  issueApiCredentialRotationScript,
  issueExistingRouterRepairScript,
  issueNewRouterEnrollmentScript,
  issueWireGuardRotationScript,
  probeRouterConnection,
  scriptDidNotMarkOnline,
} from "./router-connection.ts";
import { connectionStatusLabel } from "./router-enroll-state.ts";
import { updateRouterFields } from "./router-provisioning.ts";
import {
  generateAgentScript,
  generateApiCredentialRotationScript,
  generateExistingRouterRepairScript,
  generateNewRouterEnrollmentScript,
  generateWireGuardRotationScript,
  rosOverlayUserName,
} from "./routeros.ts";
import { rscFilename, scriptSections } from "./ros-script-pack.ts";
import { seal } from "./secrets.ts";
import { openTestDb } from "./test-db.ts";
import { generateWireGuardKeypair } from "./wireguard.ts";

function sampleOpts(extra: Partial<Parameters<typeof generateNewRouterEnrollmentScript>[0]> = {}) {
  const hub = generateWireGuardKeypair();
  const client = generateWireGuardKeypair();
  return {
    name: "nicee",
    identity: "nicee",
    token: "agt_testtoken",
    routerId: "rtr_1bbbf491f60e48f3",
    wgPublic: client.publicKey,
    wgPrivate: client.privateKey,
    wgAddress: "10.200.0.4/32",
    serverPublic: hub.publicKey,
    endpointHost: "wg.ispsolutions.co.ke",
    endpointPort: 51820,
    serverAddress: "10.200.0.1",
    pullUrl: "https://ispsolutions.co.ke/api/agent/script/agt_testtoken",
    apiUser: "10200004",
    apiPassword: "ApiPassTest123",
    ...extra,
  };
}

function assertConnectionRules(script: string, kind: "full" | "api" | "agent" = "full") {
  if (kind !== "api") assert.match(script, /check-certificate=no/);
  assert.doesNotMatch(script, /owner=admin/);
  assert.doesNotMatch(script, /check-certificate=yes/);
  assert.doesNotMatch(script, /HTTPS fetch failed — check URL/);
  assert.doesNotMatch(script, /endpoint-address="ispsolutions\.co\.ke"/);
  if (kind === "full") assert.match(script, /allowed-address="10\.200\.0\.1\/32"/);
}

test("named generators share one engine and stay cert-free", () => {
  const opts = sampleOpts();
  const enroll = generateNewRouterEnrollmentScript(opts);
  const repair = generateExistingRouterRepairScript(opts);
  const wg = generateWireGuardRotationScript(opts);
  const api = generateApiCredentialRotationScript(opts);
  const agent = generateAgentScript(opts);
  assert.match(enroll, /ISP Solutions RouterOS v7 Enrollment/);
  assert.match(repair, /ISP Solutions RouterOS v7 Repair/);
  assert.match(wg, /ISP Solutions RouterOS v7 WireGuard rotation/);
  assert.match(api, /ISP Solutions RouterOS v7 API credential rotation/);
  assert.match(agent, /ISP Solutions RouterOS v7 Agent/);
  assert.match(enroll, /interface wireguard add name=wg-ispsolutions/);
  assert.match(repair, /interface wireguard add name=wg-ispsolutions/);
  assert.match(wg, /interface wireguard add name=wg-ispsolutions/);
  assert.doesNotMatch(api, /interface wireguard add/);
  assert.doesNotMatch(agent, /interface wireguard add/);
  assert.match(agent, /system script add name="ispsolutions-pull"/);
  assert.match(agent, /ispSolLock/);
  assert.match(enroll, /\/user add name="10200004" password=/);
  assert.match(api, /\/user add name="10200004" password=/);
  assert.match(enroll, /Download from ispsolutions\.co\.ke FINISHED/);
  assert.match(enroll, /ISP Solutions agent: HTTP /);
  assert.match(enroll, /configuration imported successfully/);
  for (const script of [enroll, repair, wg]) assertConnectionRules(script, "full");
  assertConnectionRules(api, "api");
  assertConnectionRules(agent, "agent");
  assert.equal(rosOverlayUserName("10.200.0.4/32"), "10200004");
});

test("Copy Script, Autocopy, and Download .rsc are wired", () => {
  assert.equal(AUTOCOPY_IDLE, "Autocopy");
  assert.equal(COPY_SCRIPT_IDLE, "Copy Script");
  assert.equal(copyScriptLabel(false), "Copy Script");
  assert.equal(copyScriptLabel(true), AUTOCOPY_DONE);
  assert.equal(autocopyLabel(false), "Autocopy");
  assert.equal(
    rscFilename({ routerId: "rtr_1bbbf491f60e48f3", kind: "enroll" }),
    "ispsolutions-rtr_1bbbf491f60e48f3-enroll.rsc",
  );
  assert.equal(
    rscFilename({ routerId: "rtr_1bbbf491f60e48f3", kind: "repair" }),
    "ispsolutions-rtr_1bbbf491f60e48f3-repair.rsc",
  );
  assert.equal(
    rscFilename({ routerId: "rtr_1bbbf491f60e48f3", kind: "wireguard-rotate" }),
    "ispsolutions-rtr_1bbbf491f60e48f3-wireguard-rotate.rsc",
  );
  const dialog = readFileSync(new URL("../../components/isp/ros-script-dialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /Copy Script/);
  assert.match(dialog, /Download \.rsc/);
  assert.match(dialog, /copyText\(first\.body\)/);
  assert.doesNotMatch(dialog, /localStorage/);
  assert.doesNotMatch(dialog, /sessionStorage/);
  const enrollFirst = scriptSections({
    kind: "enroll",
    enroll: "# enroll",
    bootstrap: "# boot",
  });
  assert.equal(enrollFirst[0]?.label, "Enroll");
});

test("connection status labels match the staff-facing machine", () => {
  assert.equal(connectionStatusLabel("PENDING"), "Pending");
  assert.equal(connectionStatusLabel("BOOTSTRAP_GENERATED"), "Provisioning");
  assert.equal(connectionStatusLabel("BOOTSTRAP_EXECUTED"), "Waiting for connection");
  assert.equal(connectionStatusLabel("WIREGUARD_CONNECTED"), "WireGuard connected");
  assert.equal(connectionStatusLabel("API_VERIFIED"), "API connected");
  assert.equal(connectionStatusLabel("AGENT_CONNECTED"), "Agent connected");
  assert.equal(connectionStatusLabel("ENROLLED"), "Online");
  assert.equal(connectionStatusLabel("DEGRADED"), "Degraded");
  assert.equal(connectionStatusLabel("REVOKED"), "Revoked");
  assert.equal(scriptDidNotMarkOnline("BOOTSTRAP_GENERATED", "pending"), true);
  assert.equal(scriptDidNotMarkOnline("ENROLLED", "connected"), false);
});

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], tenant = "ten_wg") {
  await sql`insert into tenants (id, name, slug, public_base_url, wg_endpoint_host, wg_listen_port)
    values (${tenant}, 'Imani', ${`isp-${tenant}`}, 'https://ispsolutions.co.ke', 'wg.ispsolutions.co.ke', 51820)
    on conflict (id) do nothing`;
  const address = await nextWgAddress(sql, tenant);
  const enroll = enrollFields("edge-01", address);
  const id = `rtr_${tenant}_${address.replace(/\D/g, "")}`;
  await sql`insert into routers (
      id, tenant_id, name, identity, location, role, wg_status, last_seen,
      enroll_token, wg_public, wg_private_ref, wg_address, model, ros_version, site_pop,
      api_user, api_password, enroll_state
    ) values (
      ${id}, ${tenant}, 'edge-01', 'edge-01', 'Nanyuki', 'access', 'pending', null,
      ${enroll.token}, ${enroll.wg_public}, ${enroll.wg_private_sealed}, ${address},
      'RB5009', '7.16', 'Nanyuki',
      ${enroll.api_user}, ${seal(enroll.api_password)},
      'PENDING'
    )`;
  return { id, enroll, address };
}

test("overlay IPs are unique, skip the hub, and are not reused", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const a = await seed(sql, "ten_ua");
    const b = await seed(sql, "ten_ub");
    assert.notEqual(a.address, b.address);
    assert.notEqual(a.address, "10.200.0.1/32");
    assert.notEqual(b.address, "10.200.0.1/32");
    const third = await nextWgAddress(sql, "ten_ua");
    assert.notEqual(third, a.address);
    assert.notEqual(third, b.address);
  } finally {
    await close();
  }
});

test("repair keeps keys; rotation creates a new pair and keeps the previous", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { id, enroll, address } = await seed(sql, "ten_rot");
    await asRole("ten_rot");
    const before = await sql<{ wg_public: string; wg_private_ref: string; wg_status: string; enroll_state: string }>`
      select wg_public, wg_private_ref, wg_status, enroll_state from routers where id = ${id}`;
    const repair = await issueExistingRouterRepairScript(sql, { tenantId: "ten_rot", routerId: id, actorUserId: "usr_a" });
    const afterRepair = await sql<{ wg_public: string; wg_private_ref: string }>`
      select wg_public, wg_private_ref from routers where id = ${id}`;
    assert.equal(afterRepair[0]?.wg_public, before[0]?.wg_public);
    assert.equal(afterRepair[0]?.wg_private_ref, before[0]?.wg_private_ref);
    assert.match(repair.script, /ISP Solutions RouterOS v7 Repair/);
    assert.match(repair.script, new RegExp(address.replace(".", "\\.")));
    const rotated = await issueWireGuardRotationScript(sql, { tenantId: "ten_rot", routerId: id, actorUserId: "usr_a" });
    const after = await sql<{
      wg_public: string;
      wg_private_ref: string;
      wg_public_previous: string;
      wg_status: string;
      enroll_state: string;
    }>`
      select wg_public, wg_private_ref, wg_public_previous, wg_status, enroll_state from routers where id = ${id}`;
    assert.notEqual(after[0]?.wg_public, enroll.wg_public);
    assert.equal(after[0]?.wg_public_previous, enroll.wg_public);
    assert.notEqual(after[0]?.wg_private_ref, before[0]?.wg_private_ref);
    assert.equal(after[0]?.wg_status, "pending");
    assert.equal(after[0]?.enroll_state, "PENDING");
    assert.equal(scriptDidNotMarkOnline(after[0]!.enroll_state, after[0]!.wg_status), true);
    assert.match(rotated.script, /WireGuard rotation/);
    const api = await issueApiCredentialRotationScript(sql, { tenantId: "ten_rot", routerId: id, actorUserId: "usr_a" });
    assert.match(api.script, /API credential rotation/);
    const creds = await sql<{ api_password: string; api_password_previous: string; api_user: string }>`
      select api_password, api_password_previous, api_user from routers where id = ${id}`;
    assert.ok(creds[0]?.api_password_previous);
    assert.notEqual(creds[0]?.api_password, creds[0]?.api_password_previous);
    assert.equal(creds[0]?.api_user, rosOverlayUserName(address));
    const enrollScript = await issueNewRouterEnrollmentScript(sql, { tenantId: "ten_rot", routerId: id, actorUserId: "usr_a" });
    assert.doesNotMatch(JSON.stringify(enrollScript), /enc:v1:/);
    const audit = await sql<{ action: string; details: string }>`
      select action, details from audit_logs where tenant_id = 'ten_rot' and entity_id = ${id} order by created_at`;
    assert.ok(audit.some((a) => a.action === "router.wg_rotated"));
    assert.ok(audit.every((a) => !/enc:v1:|agt_|ApiPass|private/i.test(a.details)));
  } finally {
    await close();
  }
});

test("ordinary edit does not rotate keys; test connection reports channels separately", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { id, enroll } = await seed(sql, "ten_ed");
    await asRole("ten_ed");
    await updateRouterFields(sql, {
      tenantId: "ten_ed",
      routerId: id,
      actorUserId: "usr_a",
      fields: { name: "edge-01-renamed", identity: "edge-01" },
    });
    const after = await sql<{ wg_public: string; name: string; wg_status: string }>`
      select wg_public, name, wg_status from routers where id = ${id}`;
    assert.equal(after[0]?.wg_public, enroll.wg_public);
    assert.equal(after[0]?.name, "edge-01-renamed");
    assert.equal(after[0]?.wg_status, "pending");
    const probe = await probeRouterConnection(sql, "ten_ed", id, "usr_a");
    assert.equal(probe.online, false);
    assert.equal(probe.source, "none");
    assert.equal(probe.wireguard.status, "not_verified");
    assert.equal(probe.api.status, "not_verified");
    assert.equal(probe.agent.status, "not_verified");
    assert.equal(probe.connection_status, "Pending");
    assert.ok("wireguard" in probe && "api" in probe && "agent" in probe);
  } finally {
    await close();
  }
});
