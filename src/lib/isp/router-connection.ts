/** VPS WireGuard → MikroTik → RouterOS API → agent. One engine for enroll/repair/rotate. */
import { nid } from "../utils.ts";
import { agentPullUrl, generateRouterApiPassword } from "./agent.ts";
import {
  connectionStatusLabel,
  parseEnrollState,
  type EnrollState,
} from "./router-enroll-state.ts";
import {
  generateAgentScript,
  generateApiCredentialRotationScript,
  generateExistingRouterRepairScript,
  generateNewRouterEnrollmentScript,
  generateWireGuardRotationScript,
  rosOverlayUserName,
  type RosConnectionKind,
  type RosConnectionOpts,
} from "./routeros.ts";
import { seal } from "./secrets.ts";
import { applyDumpToHealth, signalFresh, verifyRouterApi } from "./router-health.ts";
import { handshakeLive, readHostWgDump, removeHostPeer } from "./wg-host.ts";
import { generateWireGuardKeypair, wgEnrollContext } from "./wireguard.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type RouterScriptKind = RosConnectionKind;

export type IssuedRouterScript = {
  kind: RouterScriptKind;
  title: string;
  description: string;
  identity: string;
  routerId: string;
  script: string;
  wg_address: string;
  wg_public: string;
  rotated: boolean;
  enroll_state: string;
  connection_status: string;
};

type RouterConnRow = {
  id: string;
  name: string;
  identity: string;
  enroll_token: string;
  wg_public: string;
  wg_address: string;
  wg_private_ref: string;
  wg_public_previous: string;
  wg_private_ref_previous: string;
  api_user: string;
  api_password: string;
  api_password_previous: string;
  enroll_state: string;
  wg_status: string;
  last_seen: string | null;
  last_handshake_at: string | null;
  api_verified_at: string | null;
  agent_last_ok_at: string | null;
  last_api_check_at: string | null;
  enabled: boolean;
};

const SCRIPT_META: Record<RouterScriptKind, { title: string; event: string; audit: string }> = {
  enroll: { title: "RouterOS Enrollment Script", event: "enroll_script_generated", audit: "router.enroll_script" },
  repair: { title: "RouterOS Repair Script", event: "repair_script_generated", audit: "router.repair" },
  "wireguard-rotate": {
    title: "WireGuard rotation script",
    event: "wireguard_rotated",
    audit: "router.wg_rotated",
  },
  "api-rotate": {
    title: "API credential rotation script",
    event: "api_credentials_rotated",
    audit: "router.api_rotated",
  },
  agent: { title: "Agent script", event: "agent_script_generated", audit: "router.agent_regenerated" },
};

async function loadConn(sql: Sql, tenantId: string, routerId: string): Promise<RouterConnRow> {
  const [row] = await sql<RouterConnRow>`
    select id, name, identity, enroll_token, wg_public, wg_address, wg_private_ref,
      coalesce(wg_public_previous,'') as wg_public_previous,
      coalesce(wg_private_ref_previous,'') as wg_private_ref_previous,
      coalesce(api_user,'') as api_user,
      coalesce(api_password,'') as api_password,
      coalesce(api_password_previous,'') as api_password_previous,
      coalesce(enroll_state,'PENDING') as enroll_state,
      wg_status, last_seen::text as last_seen,
      last_handshake_at::text as last_handshake_at,
      api_verified_at::text as api_verified_at,
      agent_last_ok_at::text as agent_last_ok_at,
      last_api_check_at::text as last_api_check_at,
      coalesce(enabled, true) as enabled
    from routers where id = ${routerId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Router not found");
  return row;
}

async function writeAudit(
  sql: Sql,
  tenantId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  const text = JSON.stringify(details);
  if (/wg_private|private_key|api_password|agt_|enc:v1:/i.test(text)) {
    throw new Error("Refusing to audit secrets");
  }
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${actorUserId || ""}, ${action}, ${"router"}, ${entityId}, ${text.slice(0, 2000)})`;
}

async function recordEvent(
  sql: Sql,
  tenantId: string,
  routerId: string,
  event: string,
  actorUserId: string,
  detail: Record<string, unknown>,
) {
  await sql`insert into router_provision_events (id, tenant_id, router_id, event, actor_user_id, detail)
    values (${nid("rpe")}, ${tenantId}, ${routerId}, ${event}, ${actorUserId || ""}, ${JSON.stringify(detail).slice(0, 4000)})`;
}

async function enrollOpts(sql: Sql, tenantId: string, row: RouterConnRow): Promise<RosConnectionOpts> {
  const { tenantPublicOriginOrEmpty } = await import("./domain-resolve.ts");
  const { ensureRouterApiCredentials, httpsPublicBase } = await import("./router-provisioning.ts");
  const base = await tenantPublicOriginOrEmpty(sql, tenantId, "public_api");
  const api = await ensureRouterApiCredentials(sql, tenantId, row.id);
  const ctx = await wgEnrollContext(sql, tenantId, {
    id: row.id,
    name: row.name,
    identity: row.identity,
    token: row.enroll_token,
    wg_public: row.wg_public,
    wg_private_ref: row.wg_private_ref,
    wg_address: row.wg_address || "10.200.0.2/32",
    pullUrl: agentPullUrl(httpsPublicBase(base, true), row.enroll_token),
    wg_public_previous: row.wg_public_previous,
  });
  return { ...ctx, apiUser: api.user, apiPassword: api.password };
}

function render(kind: RouterScriptKind, opts: RosConnectionOpts) {
  if (kind === "repair") return generateExistingRouterRepairScript(opts);
  if (kind === "wireguard-rotate") return generateWireGuardRotationScript(opts);
  if (kind === "api-rotate") return generateApiCredentialRotationScript(opts);
  if (kind === "agent") return generateAgentScript(opts);
  return generateNewRouterEnrollmentScript(opts);
}

async function issue(
  sql: Sql,
  opts: {
    tenantId: string;
    routerId: string;
    actorUserId?: string;
    kind: RouterScriptKind;
    rotated: boolean;
  },
): Promise<IssuedRouterScript> {
  const row = await loadConn(sql, opts.tenantId, opts.routerId);
  const scriptOpts = await enrollOpts(sql, opts.tenantId, row);
  const script = render(opts.kind, scriptOpts);
  const meta = SCRIPT_META[opts.kind];
  const state = parseEnrollState(row.enroll_state);
  const status = connectionStatusLabel(state);
  await recordEvent(sql, opts.tenantId, row.id, meta.event, opts.actorUserId || "", {
    kind: opts.kind,
    rotated: opts.rotated,
    overlay: row.wg_address,
  });
  await writeAudit(sql, opts.tenantId, opts.actorUserId || "", meta.audit, row.id, {
    kind: opts.kind,
    rotated: opts.rotated,
  });
  return {
    kind: opts.kind,
    title: meta.title,
    description: `Router: ${row.identity || row.name}. Overlay ${row.wg_address || "unassigned"}. Status: ${status}. Paste in New Terminal.`,
    identity: row.identity || row.name,
    routerId: row.id,
    script,
    wg_address: row.wg_address,
    wg_public: row.wg_public,
    rotated: opts.rotated,
    enroll_state: row.enroll_state,
    connection_status: status,
  };
}

export async function issueNewRouterEnrollmentScript(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  return issue(sql, { ...opts, kind: "enroll", rotated: false });
}

export async function issueExistingRouterRepairScript(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  return issue(sql, { ...opts, kind: "repair", rotated: false });
}

export async function issueWireGuardRotationScript(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  const row = await loadConn(sql, opts.tenantId, opts.routerId);
  const keys = generateWireGuardKeypair();
  const previousPublic = row.wg_public_previous || row.wg_public;
  const previousPrivate = row.wg_private_ref_previous || row.wg_private_ref;
  if (row.wg_public && row.wg_public !== previousPublic) {
    await removeHostPeer(row.wg_public).catch(() => null);
  }
  await sql`update routers set
    wg_public_previous = ${previousPublic},
    wg_private_ref_previous = ${previousPrivate},
    wg_public = ${keys.publicKey},
    wg_private_ref = ${keys.privateKeySealed},
    wg_status = 'pending'
    where id = ${row.id} and tenant_id = ${opts.tenantId}`;
  return issue(sql, { ...opts, kind: "wireguard-rotate", rotated: true });
}

export async function issueApiCredentialRotationScript(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  const row = await loadConn(sql, opts.tenantId, opts.routerId);
  const overlayUser = rosOverlayUserName(row.wg_address) || row.api_user;
  const previous = row.api_password_previous || row.api_password;
  const next = seal(generateRouterApiPassword());
  await sql`update routers set
    api_user = ${overlayUser},
    api_password_previous = ${previous},
    api_password = ${next},
    api_port = 8728
    where id = ${row.id} and tenant_id = ${opts.tenantId}`;
  await sql`insert into router_credentials (id, tenant_id, router_id, kind, secret_sealed)
    values (${nid("rcr")}, ${opts.tenantId}, ${row.id}, 'api_password', ${next})
    on conflict (router_id, kind) do update set secret_sealed = excluded.secret_sealed, rotated_at = now()`;
  return issue(sql, { ...opts, kind: "api-rotate", rotated: true });
}

export async function issueAgentScript(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  return issue(sql, { ...opts, kind: "agent", rotated: false });
}

export type ProbeChannel = {
  ok: boolean;
  status: "connected" | "failed" | "not_verified";
  detail: string;
};

export type ConnectionTestResult = {
  id: string;
  name: string;
  online: boolean;
  reachability: string;
  last_seen: string | null;
  provisioning_status?: string;
  source: string;
  enroll_state: EnrollState;
  connection_status: string;
  wireguard: ProbeChannel;
  api: ProbeChannel;
  agent: ProbeChannel;
  identity?: string;
  version?: string;
};

function channel(ok: boolean, verified: boolean, connected: string, failed: string, pending: string): ProbeChannel {
  if (ok) return { ok: true, status: "connected", detail: connected };
  if (verified) return { ok: false, status: "failed", detail: failed };
  return { ok: false, status: "not_verified", detail: pending };
}

export async function probeRouterConnection(
  sql: Sql,
  tenantId: string,
  routerId: string,
  actorUserId = "",
): Promise<ConnectionTestResult> {
  const row = await loadConn(sql, tenantId, routerId);
  const dump = await readHostWgDump();
  const healthRow = {
    id: row.id,
    tenant_id: tenantId,
    enroll_state: row.enroll_state,
    wg_public: row.wg_public,
    wg_address: row.wg_address,
    api_user: row.api_user,
    api_password: row.api_password,
    api_port: 8728,
    last_seen: row.last_seen,
    last_handshake_at: row.last_handshake_at,
    api_verified_at: row.api_verified_at,
    agent_last_ok_at: row.agent_last_ok_at,
    wg_rx_bytes: 0,
    wg_tx_bytes: 0,
    wg_public_previous: row.wg_public_previous,
    api_password_previous: row.api_password_previous,
  };
  const applied = applyDumpToHealth(healthRow, dump);
  const livePeer = handshakeLive(
    dump.find((p) => p.publicKey === row.wg_public) ||
      (row.wg_public_previous ? dump.find((p) => p.publicKey === row.wg_public_previous) : null),
  );
  const wgOk = applied.handshake || livePeer;
  let apiOk = false;
  let apiError = "";
  let identity = "";
  let version = "";
  if (wgOk) {
    const result = await verifyRouterApi(sql, healthRow, { timeoutMs: 6000, retirePrevious: true });
    apiOk = result.ok;
    apiError = result.error || "";
    identity = result.identity || "";
    version = result.version || "";
  }
  const agentOk = signalFresh(row.agent_last_ok_at || row.last_seen);
  const state = parseEnrollState(row.enroll_state);
  const all = wgOk && apiOk && agentOk;
  await recordEvent(sql, tenantId, row.id, all ? "connection_verified" : "connection_test_failed", actorUserId, {
    wireguard: wgOk,
    api: apiOk,
    agent: agentOk,
  });
  await writeAudit(sql, tenantId, actorUserId, all ? "router.connection_ok" : "router.connection_failed", row.id, {
    wireguard: wgOk,
    api: apiOk,
    agent: agentOk,
  });
  return {
    id: row.id,
    name: row.name,
    online: all && row.enabled !== false,
    reachability: all ? "connected" : wgOk ? "partial" : row.last_seen ? "stale" : "pending",
    last_seen: row.last_seen,
    source: agentOk ? "agent_heartbeat" : wgOk ? "wireguard" : "none",
    enroll_state: state,
    connection_status: connectionStatusLabel(state),
    identity,
    version,
    wireguard: channel(
      wgOk,
      Boolean(
        dump.find((p) => p.publicKey === row.wg_public) ||
          (row.wg_public_previous && dump.find((p) => p.publicKey === row.wg_public_previous)),
      ),
      "Connected",
      applied.overlayMatch ? "No recent handshake" : "Peer or overlay mismatch",
      "Not verified",
    ),
    api: channel(
      apiOk,
      wgOk,
      identity ? `Connected (${identity})` : "Connected",
      apiError || "Failed",
      "Not verified",
    ),
    agent: channel(
      agentOk,
      Boolean(row.agent_last_ok_at || row.last_seen),
      "Connected",
      "No recent pull",
      "Not verified",
    ),
  };
}

export function scriptDidNotMarkOnline(enrollState: string, wgStatus: string) {
  return parseEnrollState(enrollState) !== "ENROLLED" && wgStatus !== "connected" && wgStatus !== "online";
}
