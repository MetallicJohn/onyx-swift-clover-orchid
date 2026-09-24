import { ROS_API_USER } from "../brand.ts";
import { nid } from "../utils.ts";
import { metricIncr, metricSet } from "./metrics.ts";
import { logEvent } from "./obs.ts";
import { attr, routerosApiCommand } from "./routeros-api.ts";
import { compositeEnrollState, recordEnrollState, type EnrollState } from "./router-enroll-state.ts";
import { rosOverlayUserName } from "./routeros.ts";
import { open } from "./secrets.ts";
import { findDumpPeer, handshakeLive, parseWgDump, removeHostPeer, type WgDumpPeer } from "./wg-host.ts";

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
  wg_public_previous?: string;
  api_password_previous?: string;
};

export function signalFresh(iso: string | null | undefined, now = Date.now(), maxAgeMs = 180_000) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= maxAgeMs;
}

function apiLoginNames(row: RouterHealthRow) {
  const overlay = rosOverlayUserName(row.wg_address);
  const primary = (row.api_user || "").trim() || overlay || ROS_API_USER;
  const names = [primary];
  if (overlay && !names.includes(overlay)) names.push(overlay);
  if (!names.includes(ROS_API_USER)) names.push(ROS_API_USER);
  return names;
}

function isApiNetworkFailure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err || "");
  return /timeout|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN|EPERM|ECONNRESET|EAI_AGAIN|ENOTFOUND/i.test(
    message,
  );
}

function explainApiError(err: unknown, host: string) {
  const message = err instanceof Error ? err.message : "API failed";
  if (/timeout|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN/i.test(message)) {
    return `No reply from ${host}:8728. The router accepts API only from 10.200.0.1.`;
  }
  if (/ECONNREFUSED/i.test(message)) {
    return `Connection refused on ${host}:8728. Enable the API service for 10.200.0.1 only.`;
  }
  return message;
}

export function applyDumpToHealth(row: RouterHealthRow, dump: WgDumpPeer[], now = Date.now()) {
  const current = findDumpPeer(dump, row.wg_public);
  const previous = row.wg_public_previous ? findDumpPeer(dump, row.wg_public_previous) : null;
  const currentLive = handshakeLive(current, now);
  const previousLive = handshakeLive(previous, now);
  const peer = currentLive ? current : previousLive ? previous : current || previous;
  const overlayHost = row.wg_address.replace(/\/\d+$/, "");
  return {
    handshake: currentLive || previousLive,
    handshakeCurrent: currentLive,
    handshakePrevious: previousLive,
    lastHandshakeAt: peer?.lastHandshakeAt || null,
    rx: peer?.rxBytes || 0,
    tx: peer?.txBytes || 0,
    overlayMatch: peer ? peer.allowedIps.includes(overlayHost) : false,
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
  if (applied.handshakeCurrent && row.wg_public_previous) {
    await removeHostPeer(row.wg_public_previous).catch(() => null);
    await sql`update routers set wg_public_previous = '', wg_private_ref_previous = ''
      where id = ${row.id} and tenant_id = ${row.tenant_id}`;
  }
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

export async function verifyRouterApi(
  sql: Sql,
  row: RouterHealthRow,
  opts?: { timeoutMs?: number; retirePrevious?: boolean },
) {
  const host = (row.wg_address || "").replace(/\/\d+$/, "");
  const names = apiLoginNames(row);
  const current = open(row.api_password);
  const previous = open(row.api_password_previous || "");
  const started = Date.now();
  const timeoutMs = opts?.timeoutMs;
  async function attempt(user: string, password: string) {
    const identity = await routerosApiCommand(
      { host, user, password, port: row.api_port || 8728, timeoutMs },
      ["/system/identity/print"],
    );
    const resource = await routerosApiCommand(
      { host, user, password, port: row.api_port || 8728, timeoutMs },
      ["/system/resource/print"],
    );
    const board = await routerosApiCommand(
      { host, user, password, port: row.api_port || 8728, timeoutMs },
      ["/system/routerboard/print"],
    ).catch(() => null);
    return {
      identity: attr(identity, "name"),
      version: attr(resource, "version"),
      board: attr(resource, "board-name") || attr(resource, "architecture-name") || (board ? attr(board, "model") : ""),
    };
  }
  async function attemptPassword(password: string) {
    let last: unknown;
    for (const name of names) {
      try {
        return await attempt(name, password);
      } catch (err) {
        last = err;
        if (isApiNetworkFailure(err)) throw err;
      }
    }
    throw last instanceof Error ? last : new Error("RouterOS API login failed");
  }
  try {
    if (!host || !current) throw new Error("API credentials or overlay missing");
    let usedPrevious = false;
    let result: { identity: string; version: string; board: string };
    try {
      result = await attemptPassword(current);
    } catch (err) {
      if (!previous || previous === current || isApiNetworkFailure(err)) throw err;
      result = await attemptPassword(previous);
      usedPrevious = true;
    }
    await sql`update routers set
      api_verified_at = now(),
      last_api_check_at = now(),
      api_last_error = '',
      ros_version = case when ${result.version} = '' then ros_version else ${result.version} end,
      board_name = case when ${result.board} = '' then board_name else ${result.board} end
      where id = ${row.id}`;
    if (!usedPrevious && opts?.retirePrevious !== false && row.api_password_previous) {
      await sql`update routers set api_password_previous = '' where id = ${row.id} and tenant_id = ${row.tenant_id}`;
    }
    await recordEnrollState(sql, {
      tenantId: row.tenant_id,
      routerId: row.id,
      state: "API_VERIFIED",
      detail: { identity: result.identity, version: result.version },
    });
    metricIncr("router_api_success");
    logEvent("info", "router.api.verified", {
      tenantId: row.tenant_id,
      operation: "api.verify",
      durationMs: Date.now() - started,
      result: "ok",
      category: "mikrotik",
    });
    return { ok: true, identity: result.identity, version: result.version, board: result.board, error: "" };
  } catch (err) {
    const message = explainApiError(err, host).slice(0, 400);
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
    return { ok: false, error: message, identity: "", version: "", board: "" };
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
  if (handshake && api && agent) {
    const { settleVerifiedRouter } = await import("./router-provisioning.ts");
    await settleVerifiedRouter(sql, { tenantId: row.tenant_id, routerId: row.id });
  }
  return { handshake, api, agent, state };
}

export function parseWgShowDump(text: string) {
  return parseWgDump(text);
}
