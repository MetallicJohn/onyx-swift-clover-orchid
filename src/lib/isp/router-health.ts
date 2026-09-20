import { nid } from "../utils.ts";
import { metricIncr, metricSet } from "./metrics.ts";
import { logEvent } from "./obs.ts";
import { attr, routerosApiCommand } from "./routeros-api.ts";
import { compositeEnrollState, recordEnrollState, type EnrollState } from "./router-enroll-state.ts";
import { open } from "./secrets.ts";
import { findDumpPeer, handshakeFresh, parseWgDump, type WgDumpPeer } from "./wg-host.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};

export type RouterHealthRow = {
  id: string;
  tenant_id: string;
  enroll_state: string;
  wg_public: string;
  wg_address: string;
  api_user: string;
  api_password: string;
  api_port: number;
  last_seen: string | null;
  last_handshake_at: string | null;
  api_verified_at: string | null;
  agent_last_ok_at: string | null;
  wg_rx_bytes: number;
  wg_tx_bytes: number;
};

export function signalFresh(iso: string | null | undefined, now = Date.now(), maxAgeMs = 180_000) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= maxAgeMs;
}

export function applyDumpToHealth(row: RouterHealthRow, dump: WgDumpPeer[], now = Date.now()) {
  const peer = findDumpPeer(dump, row.wg_public);
  const handshake = Boolean(peer && handshakeFresh(peer.lastHandshakeUnix, now));
  return {
    handshake,
    lastHandshakeAt: peer?.lastHandshakeAt || null,
    rx: peer?.rxBytes || 0,
    tx: peer?.txBytes || 0,
    overlayMatch: peer ? peer.allowedIps.includes(row.wg_address.replace(/\/\d+$/, "")) : false,
  };
}

export async function persistHandshake(
  sql: Sql,
  row: RouterHealthRow,
  dump: WgDumpPeer[],
  now = Date.now(),
) {
  const applied = applyDumpToHealth(row, dump, now);
  await sql`update routers set
    last_handshake_at = ${applied.lastHandshakeAt},
    wg_rx_bytes = ${applied.rx},
    wg_tx_bytes = ${applied.tx}
    where id = ${row.id} and tenant_id = ${row.tenant_id}`;
  await sql`update wireguard_peers set
    last_handshake_at = ${applied.lastHandshakeAt},
    rx_bytes = ${applied.rx},
    tx_bytes = ${applied.tx},
    status = ${applied.handshake ? "connected" : "pending"}
    where tenant_id = ${row.tenant_id} and router_id = ${row.id}`;
  if (applied.handshake) {
    await recordEnrollState(sql, {
      tenantId: row.tenant_id,
      routerId: row.id,
      state: "WIREGUARD_CONNECTED",
      detail: { rx: applied.rx, tx: applied.tx },
    });
    metricIncr("router_wireguard_online");
  }
  metricSet(`router_wireguard_handshake_age:${row.id}`, applied.lastHandshakeAt ? 0 : -1);
  return applied;
}

export async function verifyRouterApi(sql: Sql, row: RouterHealthRow) {
  const host = (row.wg_address || "").replace(/\/\d+$/, "");
  const user = row.api_user || "ispsolutions-agent";
  const password = open(row.api_password);
  const started = Date.now();
  try {
    if (!host || !password) throw new Error("API credentials or overlay missing");
    const identity = await routerosApiCommand(
      { host, user, password, port: row.api_port || 8728 },
      ["/system/identity/print"],
    );
    const resource = await routerosApiCommand(
      { host, user, password, port: row.api_port || 8728 },
      ["/system/resource/print"],
    );
    const name = attr(identity, "name");
    const version = attr(resource, "version");
    const board = attr(resource, "board-name") || attr(resource, "architecture-name");
    await sql`update routers set
      api_verified_at = now(),
      last_api_check_at = now(),
      api_last_error = '',
      ros_version = case when ${version} = '' then ros_version else ${version} end,
      board_name = case when ${board} = '' then board_name else ${board} end
      where id = ${row.id}`;
    await recordEnrollState(sql, {
      tenantId: row.tenant_id,
      routerId: row.id,
      state: "API_VERIFIED",
      detail: { identity: name, version },
    });
    metricIncr("router_api_success");
    logEvent("info", "router.api.verified", {
      tenantId: row.tenant_id,
      operation: "api.verify",
      durationMs: Date.now() - started,
      result: "ok",
      category: "mikrotik",
    });
    return { ok: true, identity: name, version, board };
  } catch (err) {
    const message = err instanceof Error ? err.message : "API failed";
    await sql`update routers set last_api_check_at = now(), api_last_error = ${message.slice(0, 400)}
      where id = ${row.id}`;
    metricIncr("router_api_failure");
    logEvent("warn", "router.api.failed", {
      tenantId: row.tenant_id,
      operation: "api.verify",
      durationMs: Date.now() - started,
      result: "failed",
      error: message.slice(0, 200),
      category: "mikrotik",
    });
    return { ok: false, error: message };
  }
}

export async function snapshotHealth(sql: Sql, row: RouterHealthRow, now = Date.now()) {
  const handshake = signalFresh(row.last_handshake_at, now);
  const api = signalFresh(row.api_verified_at, now, 15 * 60_000);
  const agent = signalFresh(row.agent_last_ok_at || row.last_seen, now);
  const state = compositeEnrollState({
    current: row.enroll_state as EnrollState,
    handshake,
    api,
    agent,
  });
  await sql`insert into router_health_snapshots
    (id, tenant_id, router_id, wireguard, api, agent, handshake_age_sec, cpu_pct, uptime_hours, last_error)
    values (
      ${nid("rhs")}, ${row.tenant_id}, ${row.id},
      ${handshake ? "up" : "down"}, ${api ? "up" : "down"}, ${agent ? "up" : "down"},
      ${row.last_handshake_at ? Math.max(0, Math.round((now - Date.parse(row.last_handshake_at)) / 1000)) : -1},
      0, 0, ${handshake && api && agent ? "" : "incomplete"}
    )`;
  if (state === "ENROLLED" || state === "DEGRADED") {
    await recordEnrollState(sql, { tenantId: row.tenant_id, routerId: row.id, state });
  }
  return { handshake, api, agent, state };
}

export function parseWgShowDump(text: string) {
  return parseWgDump(text);
}
