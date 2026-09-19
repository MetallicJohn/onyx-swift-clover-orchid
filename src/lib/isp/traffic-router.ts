import { nid } from "../utils.ts";
import { loadServiceConfig } from "./runtime-config.ts";
import { logEvent } from "./obs.ts";
import { metricIncr, metricSet } from "./metrics.ts";
import { bytesToBps, trafficFreshness } from "./traffic-format.ts";
import { loadServiceMaps, mapIdentity, matchRouter, loadRouterIndex } from "./traffic-map.ts";
import { getTrafficSettings, type TrafficSettings } from "./traffic-settings.ts";
import { readRouterLive, writeRouterLive, type RouterIfaceLive, type RouterLive } from "./traffic-store.ts";
import { applyRls } from "./rls.ts";
import { open } from "./secrets.ts";
import { netflowAdapter, routerosAdapter, snmpAdapter } from "./traffic-sources.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type RouterRow = {
  id: string;
  tenant_id: string;
  name: string;
  api_user: string;
  api_password: string;
  api_port: number;
  api_host: string;
  wg_address: string;
};

export type RestJson = { path: string; status: number; json: unknown; error?: string };

export type RestJsonClient = (path: string) => Promise<RestJson>;

/** RouterOS REST targets come only from stored api_host / WG overlay — never a request URL. */
export function restTarget(router: { api_host: string; wg_address: string; api_port: number }) {
  const raw = String(router.api_host || router.wg_address || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/^https?:\/\//i, "");
  const host = stripped.replace(/\/\d+$/, "").split("/")[0].split(":")[0].trim();
  if (!host || /[\s@]/.test(host)) return null;
  if (/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) return null;
  const port = Number(router.api_port || 443);
  return { host, port: Number.isFinite(port) && port > 0 ? port : 443 };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseUptime(raw: unknown): number | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.floor(asNum);
  let sec = 0;
  const w = s.match(/(\d+)w/);
  const d = s.match(/(\d+)d/);
  const h = s.match(/(\d+)h/);
  const m = s.match(/(\d+)m/);
  const ss = s.match(/(\d+)s/);
  if (w) sec += Number(w[1]) * 7 * 86400;
  if (d) sec += Number(d[1]) * 86400;
  if (h) sec += Number(h[1]) * 3600;
  if (m) sec += Number(m[1]) * 60;
  if (ss) sec += Number(ss[1]);
  return sec > 0 ? sec : null;
}

export function parseResource(json: unknown): { cpu_pct: number | null; ram_pct: number | null; uptime_seconds: number | null } {
  const row = Array.isArray(json) ? json[0] : json;
  if (!row || typeof row !== "object") return { cpu_pct: null, ram_pct: null, uptime_seconds: null };
  const o = row as Record<string, unknown>;
  const cpu = num(o["cpu-load"] ?? o.cpu_load ?? o.cpu);
  const free = num(o["free-memory"] ?? o.free_memory);
  const total = num(o["total-memory"] ?? o.total_memory);
  let ram: number | null = null;
  if (free != null && total && total > 0) ram = Math.round(((total - free) / total) * 100);
  return {
    cpu_pct: cpu == null ? null : Math.min(100, Math.max(0, Math.round(cpu))),
    ram_pct: ram == null ? null : Math.min(100, Math.max(0, ram)),
    uptime_seconds: parseUptime(o.uptime),
  };
}

export function parseInterfaces(json: unknown): RouterIfaceLive[] {
  if (!Array.isArray(json)) return [];
  const out: RouterIfaceLive[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const name = String(o.name || "").trim();
    if (!name) continue;
    out.push({
      name,
      type: String(o.type || o["default-name"] || "").trim(),
      rx_bytes: Math.max(0, num(o["rx-byte"] ?? o.rx_byte) || 0),
      tx_bytes: Math.max(0, num(o["tx-byte"] ?? o.tx_byte) || 0),
      rx_bps: null,
      tx_bps: null,
      running: String(o.running ?? "true").toLowerCase() !== "false",
    });
  }
  return out;
}

export function parsePppActive(json: unknown): Array<{ username: string; address: string; uptime: string }> {
  if (!Array.isArray(json)) return [];
  const out: Array<{ username: string; address: string; uptime: string }> = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const username = String(o.name || o.user || "").trim();
    if (!username) continue;
    out.push({
      username,
      address: String(o.address || "").trim(),
      uptime: String(o.uptime || "").trim(),
    });
  }
  return out;
}

export async function defaultRestClient(
  router: RouterRow,
  timeoutMs?: number,
): Promise<RestJsonClient | null> {
  const target = restTarget(router);
  if (!target || !router.api_password) return null;
  const ms = timeoutMs ?? loadServiceConfig().mikrotikTimeoutMs;
  const base = `https://${target.host}:${target.port}`;
  const auth = Buffer.from(`${router.api_user || "ispsolutions-agent"}:${open(router.api_password)}`).toString("base64");
  return async (path: string) => {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        signal: AbortSignal.timeout(ms),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { path, status: res.status, json };
    } catch (err) {
      return {
        path,
        status: 0,
        json: null,
        error: err instanceof Error ? err.message.slice(0, 180) : "unreachable",
      };
    }
  };
}

function applyIfaceRates(prev: RouterLive | null, next: RouterIfaceLive[], nowMs: number) {
  if (!prev) return next;
  const prevMs = Date.parse(prev.collected_at);
  const byName = new Map(prev.interfaces.map((i) => [i.name, i]));
  return next.map((iface) => {
    const last = byName.get(iface.name);
    if (!last) return iface;
    return {
      ...iface,
      rx_bps: bytesToBps(last.rx_bytes, iface.rx_bytes, prevMs, nowMs) || null,
      tx_bps: bytesToBps(last.tx_bytes, iface.tx_bytes, prevMs, nowMs) || null,
    };
  });
}

async function upsertRouterMinute(
  sql: Sql,
  live: RouterLive,
  bucket: Date,
  collectorId: string,
  lastError = "",
) {
  const id = nid("rmet");
  await sql.query(
    `insert into router_metrics (
        id, tenant_id, router_id, collector_id, cpu_pct, ram_pct, uptime_seconds,
        ppp_active, customers_online, source, last_error, bucket_at, collected_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (tenant_id, router_id, bucket_at) do update set
        cpu_pct = excluded.cpu_pct,
        ram_pct = excluded.ram_pct,
        uptime_seconds = excluded.uptime_seconds,
        ppp_active = excluded.ppp_active,
        customers_online = excluded.customers_online,
        source = excluded.source,
        last_error = excluded.last_error,
        collected_at = excluded.collected_at`,
    [
      id,
      live.tenant_id,
      live.router_id,
      collectorId,
      live.cpu_pct,
      live.ram_pct,
      live.uptime_seconds,
      live.ppp_active,
      live.customers_online,
      live.source,
      lastError,
      bucket.toISOString(),
      live.collected_at,
    ],
  );
  for (const iface of live.interfaces) {
    await sql.query(
      `insert into interface_metrics (
          id, tenant_id, router_id, interface_name, interface_type,
          rx_bytes, tx_bytes, rx_bps, tx_bps, running, bucket_at, collected_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (tenant_id, router_id, interface_name, bucket_at) do update set
          rx_bytes = excluded.rx_bytes,
          tx_bytes = excluded.tx_bytes,
          rx_bps = excluded.rx_bps,
          tx_bps = excluded.tx_bps,
          running = excluded.running,
          collected_at = excluded.collected_at,
          interface_type = excluded.interface_type`,
      [
        nid("ifm"),
        live.tenant_id,
        live.router_id,
        iface.name.slice(0, 80),
        iface.type.slice(0, 40),
        iface.rx_bytes,
        iface.tx_bytes,
        iface.rx_bps,
        iface.tx_bps,
        iface.running,
        bucket.toISOString(),
        live.collected_at,
      ],
    );
  }
}

export async function pollOneRouter(
  sql: Sql,
  router: RouterRow,
  opts: {
    collectorId: string;
    settings: TrafficSettings;
    now?: Date;
    client?: RestJsonClient | null;
  },
) {
  const now = opts.now || new Date();
  const client = opts.client === undefined ? await defaultRestClient(router) : opts.client;
  if (!client) {
    return { routerId: router.id, status: "not_configured" as const };
  }
  const started = Date.now();
  const [resource, ifaces, ppp] = await Promise.all([
    client("/rest/system/resource"),
    client("/rest/interface"),
    client("/rest/ppp/active"),
  ]);
  const failed = [resource, ifaces, ppp].filter((r) => r.status === 0 || (r.status >= 400 && r.status !== 404));
  if (resource.status === 0) {
    metricIncr("traffic.router_fail");
    logEvent("warn", "traffic.router.unreachable", {
      operation: "traffic.router.poll",
      category: "traffic",
      tenantId: router.tenant_id,
      result: "error",
      error: resource.error || "unreachable",
    });
    return { routerId: router.id, status: "unreachable" as const, error: resource.error || "unreachable" };
  }
  const parsed = parseResource(resource.json);
  let interfaces = parseInterfaces(ifaces.json);
  const sessions = parsePppActive(ppp.json);
  const prev = await readRouterLive(router.tenant_id, router.id);
  interfaces = applyIfaceRates(prev, interfaces, now.getTime());
  const live: RouterLive = {
    tenant_id: router.tenant_id,
    router_id: router.id,
    cpu_pct: parsed.cpu_pct,
    ram_pct: parsed.ram_pct,
    uptime_seconds: parsed.uptime_seconds,
    ppp_active: sessions.length,
    customers_online: sessions.length,
    source: "routeros",
    collected_at: now.toISOString(),
    interfaces,
  };
  await writeRouterLive(live, opts.settings);
  const bucket = minuteBucketFromDate(now);
  await upsertRouterMinute(sql, live, bucket, opts.collectorId);
  if (parsed.cpu_pct != null) {
    await sql.query(`update routers set cpu_pct = $1, last_seen = $2 where id = $3 and tenant_id = $4`, [
      parsed.cpu_pct,
      now.toISOString(),
      router.id,
      router.tenant_id,
    ]);
    if (parsed.uptime_seconds != null) {
      await sql.query(`update routers set uptime_hours = $1 where id = $2 and tenant_id = $3`, [
        Math.max(0, Math.floor(parsed.uptime_seconds / 3600)),
        router.id,
        router.tenant_id,
      ]);
    }
  }
  metricSet("traffic.router_latency_ms", Date.now() - started);
  metricIncr("traffic.routers_ok");
  return {
    routerId: router.id,
    status: "ok" as const,
    cpu_pct: parsed.cpu_pct,
    ppp_active: sessions.length,
    interfaces: interfaces.length,
    failed: failed.length,
    ppp: sessions,
  };
}

function minuteBucketFromDate(at: Date) {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}

export async function pollRouterTelemetry(
  sql: Sql,
  opts: {
    collectorId?: string;
    now?: Date;
    clientFor?: (router: RouterRow) => Promise<RestJsonClient | null> | RestJsonClient | null;
  } = {},
) {
  const settings = await getTrafficSettings(sql);
  const collectorId = String(opts.collectorId || "default").slice(0, 80) || "default";
  const now = opts.now || new Date();
  await applyRls(sql, { bypass: true });
  const routers = await sql.query<RouterRow>(
    `select id, tenant_id, name, coalesce(api_user,'ispsolutions') as api_user,
            coalesce(api_password,'') as api_password, coalesce(api_port,443) as api_port,
            coalesce(api_host,'') as api_host, coalesce(wg_address,'') as wg_address
     from routers`,
  );
  let attempted = 0;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  const pppUsers: Array<{ tenant_id: string; username: string; address: string; router_id: string; router_name: string }> =
    [];
  for (const router of routers) {
    const client = opts.clientFor ? await opts.clientFor(router) : undefined;
    if (client === null || (client === undefined && !restTarget(router))) {
      skipped += 1;
      continue;
    }
    attempted += 1;
    const out = await pollOneRouter(sql, router, {
      collectorId,
      settings,
      now,
      client: client === undefined ? undefined : client,
    });
    if (out.status === "ok") {
      ok += 1;
      if ("ppp" in out && Array.isArray(out.ppp)) {
        for (const s of out.ppp) {
          pppUsers.push({
            tenant_id: router.tenant_id,
            username: s.username,
            address: s.address,
            router_id: router.id,
            router_name: router.name,
          });
        }
      }
    } else if (out.status === "unreachable") failed += 1;
    else skipped += 1;
  }
  await sql.query(
    `update traffic_collectors set last_router_ok_at = case when $2 > 0 then now() else last_router_ok_at end
     where id = $1`,
    [collectorId, ok],
  );
  const snmp = snmpAdapter();
  const netflow = netflowAdapter();
  const ros = routerosAdapter({ attempted, ok, failed });
  metricSet("traffic.routers_monitored", ok);
  logEvent("info", "traffic.router.poll", {
    operation: "traffic.router.poll",
    category: "traffic",
    result: failed && !ok ? "error" : "ok",
  });
  return {
    collectorId,
    routers: routers.length,
    attempted,
    ok,
    failed,
    skipped,
    ppp: pppUsers.length,
    sources: { routeros: ros, snmp, netflow },
    bucket: minuteBucketFromDate(now).toISOString(),
  };
}

export async function routerTelemetry(sql: Sql, tenantId: string, routerId: string) {
  const settings = await getTrafficSettings(sql);
  const [router] = await sql.query<{
    id: string;
    name: string;
    identity: string;
    role: string;
    wg_status: string;
    wg_address: string;
    last_seen: string | null;
    cpu_pct: number;
    uptime_hours: number;
  }>(
    `select id, name, identity, role, wg_status, coalesce(wg_address,'') as wg_address,
            last_seen::text as last_seen, cpu_pct, uptime_hours
     from routers where id = $1 and tenant_id = $2`,
    [routerId, tenantId],
  );
  if (!router) throw new Error("Router not found");
  const live = await readRouterLive(tenantId, routerId);
  const [metric] = await sql.query<{
    cpu_pct: number | null;
    ram_pct: number | null;
    uptime_seconds: number | null;
    ppp_active: number | null;
    customers_online: number | null;
    source: string;
    last_error: string;
    collected_at: string;
  }>(
    `select cpu_pct, ram_pct, uptime_seconds, ppp_active, customers_online, source, last_error,
            collected_at::text as collected_at
     from router_metrics
     where tenant_id = $1 and router_id = $2
     order by collected_at desc limit 1`,
    [tenantId, routerId],
  );
  const ifaces = live?.interfaces?.length
    ? live.interfaces
    : (
        await sql.query<{
          interface_name: string;
          interface_type: string;
          rx_bytes: number;
          tx_bytes: number;
          rx_bps: number | null;
          tx_bps: number | null;
          running: boolean;
          collected_at: string;
        }>(
          `select distinct on (interface_name)
              interface_name, interface_type, rx_bytes, tx_bytes, rx_bps, tx_bps, running,
              collected_at::text as collected_at
           from interface_metrics
           where tenant_id = $1 and router_id = $2
           order by interface_name, collected_at desc`,
          [tenantId, routerId],
        )
      ).map((i) => ({
        name: i.interface_name,
        type: i.interface_type,
        rx_bytes: Number(i.rx_bytes || 0),
        tx_bytes: Number(i.tx_bytes || 0),
        rx_bps: i.rx_bps == null ? null : Number(i.rx_bps),
        tx_bps: i.tx_bps == null ? null : Number(i.tx_bps),
        running: Boolean(i.running),
      }));
  const collectedAt = live?.collected_at || metric?.collected_at || router.last_seen;
  const freshness = trafficFreshness(collectedAt, settings.routerIntervalSec);
  const maps = await loadServiceMaps(sql, [tenantId]);
  const routers = await loadRouterIndex(sql, [tenantId]);
  const sessions = await sql.query<{
    username: string;
    framed_ip: string;
    nas_ip: string;
    started_at: string;
  }>(
    `select username, framed_ip, nas_ip, started_at::text as started_at
     from radius_sessions
     where tenant_id = $1 and stopped_at is null
     order by started_at desc`,
    [tenantId],
  );
  const customers: Array<{
    username: string;
    service_id: string;
    customer_id: string;
    customer_name: string;
    framed_ip: string;
    package_name: string;
  }> = [];
  for (const ses of sessions) {
    const mapped = mapIdentity(maps, { tenant_id: tenantId, username: ses.username, framed_ip: ses.framed_ip, nas_ip: ses.nas_ip });
    const r = matchRouter(routers, tenantId, ses.nas_ip);
    if (r && r.id !== routerId) continue;
    if (!mapped) continue;
    if (r?.id === routerId || (!r && live)) {
      customers.push({
        username: ses.username,
        service_id: mapped.service_id,
        customer_id: mapped.customer_id,
        customer_name: mapped.customer_name,
        framed_ip: ses.framed_ip,
        package_name: mapped.package_name,
      });
    }
  }
  return {
    router,
    freshness,
    fresh: freshness === "live",
    source: live?.source || metric?.source || (router.last_seen ? "agent-heartbeat" : ""),
    last_error: metric?.last_error || "",
    collected_at: collectedAt,
    cpu_pct: live?.cpu_pct ?? metric?.cpu_pct ?? (router.last_seen ? router.cpu_pct : null),
    ram_pct: live?.ram_pct ?? metric?.ram_pct ?? null,
    uptime_seconds: live?.uptime_seconds ?? metric?.uptime_seconds ?? (router.uptime_hours ? router.uptime_hours * 3600 : null),
    ppp_active: live?.ppp_active ?? metric?.ppp_active ?? null,
    customers_online: live?.customers_online ?? metric?.customers_online ?? customers.length,
    interfaces: ifaces,
    customers,
    snmp: snmpAdapter(),
    netflow: netflowAdapter(),
  };
}
