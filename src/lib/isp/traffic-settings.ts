import { loadServiceConfig, parseBoolEnv, parseIntEnv } from "./runtime-config.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const TRAFFIC_SOURCE_ORDER = ["radius", "routeros", "snmp", "netflow"] as const;

export type TrafficSettings = {
  enabled: boolean;
  intervalSec: number;
  routerIntervalSec: number;
  shortHours: number;
  hourlyDays: number;
  dailyDays: number;
  sourcePriority: string[];
  ringMax: number;
};

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parseSourcePriority(raw: string) {
  const allowed = new Set<string>(TRAFFIC_SOURCE_ORDER);
  const parts = String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => allowed.has(s));
  const out: string[] = [];
  for (const p of parts) if (!out.includes(p)) out.push(p);
  for (const p of TRAFFIC_SOURCE_ORDER) if (!out.includes(p)) out.push(p);
  return out;
}

export function defaultTrafficSettings(env: NodeJS.ProcessEnv = process.env): TrafficSettings {
  const cfg = loadServiceConfig(env);
  const intervalSec = clamp(parseIntEnv(env.TRAFFIC_COLLECTION_INTERVAL || "", cfg.trafficIntervalSec, 5, 300), 5, 300);
  return {
    enabled: parseBoolEnv(env.TRAFFIC_ENABLED || "", true),
    intervalSec,
    routerIntervalSec: clamp(parseIntEnv(env.TRAFFIC_ROUTER_INTERVAL || "", 60, 15, 600), 15, 600),
    shortHours: clamp(parseIntEnv(env.TRAFFIC_SHORT_HOURS || "", 24, 1, 168), 1, 168),
    hourlyDays: clamp(parseIntEnv(env.TRAFFIC_HOURLY_DAYS || "", 90, 7, 730), 7, 730),
    dailyDays: clamp(parseIntEnv(env.TRAFFIC_DAILY_DAYS || "", 730, 30, 3650), 30, 3650),
    sourcePriority: parseSourcePriority(env.TRAFFIC_SOURCE_PRIORITY || "radius,routeros,snmp,netflow"),
    ringMax: Math.min(180, Math.max(30, Math.floor((20 * 60) / intervalSec))),
  };
}

export async function getTrafficSettings(sql?: Sql | null, env: NodeJS.ProcessEnv = process.env): Promise<TrafficSettings> {
  const base = defaultTrafficSettings(env);
  if (!sql) return base;
  try {
    const rows = await sql.query<{ key: string; value: string }>(
      `select key, value from platform_settings where key like 'traffic_%'`,
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    const intervalSec = map.traffic_interval_sec
      ? clamp(Number(map.traffic_interval_sec), 5, 300)
      : base.intervalSec;
    return {
      enabled: map.traffic_enabled ? map.traffic_enabled !== "false" : base.enabled,
      intervalSec,
      routerIntervalSec: map.traffic_router_interval_sec
        ? clamp(Number(map.traffic_router_interval_sec), 15, 600)
        : base.routerIntervalSec,
      shortHours: map.traffic_short_hours ? clamp(Number(map.traffic_short_hours), 1, 168) : base.shortHours,
      hourlyDays: map.traffic_hourly_days ? clamp(Number(map.traffic_hourly_days), 7, 730) : base.hourlyDays,
      dailyDays: map.traffic_daily_days ? clamp(Number(map.traffic_daily_days), 30, 3650) : base.dailyDays,
      sourcePriority: map.traffic_source_priority
        ? parseSourcePriority(map.traffic_source_priority)
        : base.sourcePriority,
      ringMax: Math.min(180, Math.max(30, Math.floor((20 * 60) / intervalSec))),
    };
  } catch {
    return base;
  }
}

export function liveTtlSec(settings: TrafficSettings) {
  return Math.max(15, settings.intervalSec * 3);
}

export function shortTtlSec(settings: TrafficSettings) {
  return Math.max(liveTtlSec(settings), settings.shortHours * 3600);
}

export function routerTtlSec(settings: TrafficSettings) {
  return Math.max(30, settings.routerIntervalSec * 3);
}
