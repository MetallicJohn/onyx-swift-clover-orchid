import { getRedis } from "./redis.ts";
import { liveTtlSec, routerTtlSec, shortTtlSec, type TrafficSettings } from "./traffic-settings.ts";

export type LiveSample = {
  tenant_id: string;
  username: string;
  service_id: string;
  customer_id: string;
  package_id: string;
  access_method: string;
  nas_ip: string;
  framed_ip: string;
  router_id: string;
  router_name: string;
  bytes_in: number;
  bytes_out: number;
  up_bps: number | null;
  down_bps: number | null;
  online: boolean;
  source: string;
  collected_at: string;
  collector_id: string;
};

export type SparkPoint = { at: number; up_bps: number | null; down_bps: number | null };

export type RouterIfaceLive = {
  name: string;
  type: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_bps: number | null;
  tx_bps: number | null;
  running: boolean;
};

export type RouterLive = {
  tenant_id: string;
  router_id: string;
  cpu_pct: number | null;
  ram_pct: number | null;
  uptime_seconds: number | null;
  ppp_active: number | null;
  customers_online: number | null;
  source: string;
  collected_at: string;
  interfaces: RouterIfaceLive[];
};

export function liveKey(tenantId: string, username: string) {
  return `traffic:live:${tenantId}:${username}`;
}

export function shortKey(tenantId: string, username: string) {
  return `traffic:short:${tenantId}:${username}`;
}

export function routerLiveKey(tenantId: string, routerId: string) {
  return `traffic:router:${tenantId}:${routerId}`;
}

export function routerShortKey(tenantId: string, routerId: string) {
  return `traffic:router:short:${tenantId}:${routerId}`;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readLiveSample(tenantId: string, username: string) {
  try {
    return parseJson<LiveSample>(await getRedis().get(liveKey(tenantId, username)));
  } catch {
    return null;
  }
}

export async function writeLiveSample(sample: LiveSample, settings: TrafficSettings) {
  const redis = getRedis();
  const payload = JSON.stringify(sample);
  const spark: SparkPoint = {
    at: Date.parse(sample.collected_at) || Date.now(),
    up_bps: sample.up_bps,
    down_bps: sample.down_bps,
  };
  try {
    await redis.set(liveKey(sample.tenant_id, sample.username), payload, liveTtlSec(settings));
    await redis.pushRing(
      shortKey(sample.tenant_id, sample.username),
      JSON.stringify(spark),
      settings.ringMax,
      shortTtlSec(settings),
    );
    return true;
  } catch {
    return false;
  }
}

export async function readShortSpark(tenantId: string, username: string) {
  try {
    const rows = await getRedis().lrange(shortKey(tenantId, username), 0, -1);
    const out: SparkPoint[] = [];
    for (const raw of rows) {
      const p = parseJson<SparkPoint>(raw);
      if (p && Number.isFinite(p.at)) out.push(p);
    }
    return out;
  } catch {
    return [] as SparkPoint[];
  }
}

export async function readRouterLive(tenantId: string, routerId: string) {
  try {
    return parseJson<RouterLive>(await getRedis().get(routerLiveKey(tenantId, routerId)));
  } catch {
    return null;
  }
}

export async function writeRouterLive(sample: RouterLive, settings: TrafficSettings) {
  const redis = getRedis();
  try {
    await redis.set(routerLiveKey(sample.tenant_id, sample.router_id), JSON.stringify(sample), routerTtlSec(settings));
    await redis.pushRing(
      routerShortKey(sample.tenant_id, sample.router_id),
      JSON.stringify({
        at: Date.parse(sample.collected_at) || Date.now(),
        cpu_pct: sample.cpu_pct,
        ram_pct: sample.ram_pct,
        ppp_active: sample.ppp_active,
      }),
      settings.ringMax,
      shortTtlSec(settings),
    );
    return true;
  } catch {
    return false;
  }
}
