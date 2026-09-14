import { nid } from "../utils.ts";
import { metricIncr, metricSet } from "./metrics.ts";
import { logEvent } from "./obs.ts";
import { getRedis } from "./redis.ts";
import { applyRls } from "./rls.ts";
import { loadServiceConfig } from "./runtime-config.ts";
import { bytesToBps, trafficFreshness as freshnessOf } from "./traffic-format.ts";
import { identityKey, loadRouterIndex, loadServiceMaps, mapIdentity, matchRouter, noteUnmapped } from "./traffic-map.ts";
import { getTrafficSettings, liveTtlSec, type TrafficSettings } from "./traffic-settings.ts";
import { readLiveSample, readShortSpark, writeLiveSample, type LiveSample } from "./traffic-store.ts";
import { minuteBucket, retainTrafficData } from "./traffic-aggregate.ts";
import { radiusAdapter } from "./traffic-sources.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type TrafficSample = {
  tenant_id: string;
  username: string;
  service_id: string;
  nas_ip: string;
  framed_ip: string;
  bytes_in: number;
  bytes_out: number;
  online: boolean;
  collected_at: string;
  collector_id: string;
  up_bps?: number | null;
  down_bps?: number | null;
  source?: string;
};

export function collectionBucket(at = new Date(), intervalSec = loadServiceConfig().trafficIntervalSec) {
  const ms = Math.max(5, intervalSec) * 1000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

export function trafficFreshness(collectedAt: string | null | undefined, intervalSec = loadServiceConfig().trafficIntervalSec) {
  return freshnessOf(collectedAt, intervalSec);
}

function rateOrNull(prevBytes: number, nextBytes: number, prevMs: number, nextMs: number) {
  if (!Number.isFinite(prevMs) || !Number.isFinite(nextMs) || nextMs <= prevMs) return null;
  if (nextBytes < prevBytes) return null;
  return bytesToBps(prevBytes, nextBytes, prevMs, nextMs);
}

export async function heartbeatCollector(
  sql: Sql,
  opts: { collectorId: string; error?: string; samplesOk?: number; samplesDropped?: number },
) {
  const id = String(opts.collectorId || "default").slice(0, 80) || "default";
  const err = String(opts.error || "").slice(0, 400);
  await sql.query(
    `insert into traffic_collectors (id, name, last_seen, last_ok_at, last_error, samples_ok, samples_dropped)
     values ($1, $1, now(), ${err ? "null" : "now()"}, $2, $3, $4)
     on conflict (id) do update set
       last_seen = now(),
       last_ok_at = case when $2 = '' then now() else traffic_collectors.last_ok_at end,
       last_error = $2,
       samples_ok = traffic_collectors.samples_ok + $3,
       samples_dropped = traffic_collectors.samples_dropped + $4`,
    [id, err, opts.samplesOk || 0, opts.samplesDropped || 0],
  );
  return { id };
}

async function upsertMinute(
  sql: Sql,
  sample: LiveSample,
  settings: TrafficSettings,
  now: Date,
): Promise<"inserted" | "updated"> {
  const key = identityKey(sample);
  if (!key) return "updated";
  const bucket = minuteBucket(now);
  const existing = await sql.query<{
    id: string;
    bytes_in: number;
    bytes_out: number;
    delta_in: number;
    delta_out: number;
    peak_up_bps: number;
    peak_down_bps: number;
    avg_up_bps: number;
    avg_down_bps: number;
    samples: number;
    online_ms: number;
  }>(
    `select id, bytes_in, bytes_out, delta_in, delta_out, peak_up_bps, peak_down_bps, avg_up_bps, avg_down_bps, samples, online_ms
     from traffic_minute where tenant_id = $1 and identity_key = $2 and bucket_at = $3`,
    [sample.tenant_id, key, bucket.toISOString()],
  );
  const up = sample.up_bps == null ? 0 : Math.max(0, Math.round(sample.up_bps));
  const down = sample.down_bps == null ? 0 : Math.max(0, Math.round(sample.down_bps));
  const stepMs = Math.max(5, settings.intervalSec) * 1000;
  if (!existing[0]) {
    await sql.query(
      `insert into traffic_minute (
          id, tenant_id, collector_id, identity_key, customer_id, service_id, package_id, access_method,
          username, framed_ip, nas_ip, router_id, bytes_in, bytes_out, delta_in, delta_out,
          peak_up_bps, peak_down_bps, avg_up_bps, avg_down_bps, samples, online_ms, source, bucket_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0,$15,$16,$17,$18,1,$19,$20,$21,now())`,
      [
        nid("tmin"),
        sample.tenant_id,
        sample.collector_id,
        key,
        sample.customer_id,
        sample.service_id,
        sample.package_id,
        sample.access_method,
        sample.username,
        sample.framed_ip,
        sample.nas_ip,
        sample.router_id,
        sample.bytes_in,
        sample.bytes_out,
        up,
        down,
        up,
        down,
        sample.online ? stepMs : 0,
        sample.source,
        bucket.toISOString(),
      ],
    );
    return "inserted";
  }
  const prev = existing[0];
  const dIn = Math.max(0, sample.bytes_in - Number(prev.bytes_in));
  const dOut = Math.max(0, sample.bytes_out - Number(prev.bytes_out));
  const samples = Number(prev.samples || 0) + 1;
  const avgUp = Math.round((Number(prev.avg_up_bps) * Number(prev.samples) + up) / samples);
  const avgDown = Math.round((Number(prev.avg_down_bps) * Number(prev.samples) + down) / samples);
  await sql.query(
    `update traffic_minute set
        bytes_in = $2, bytes_out = $3,
        delta_in = delta_in + $4, delta_out = delta_out + $5,
        peak_up_bps = greatest(peak_up_bps, $6),
        peak_down_bps = greatest(peak_down_bps, $7),
        avg_up_bps = $8, avg_down_bps = $9,
        samples = $10,
        online_ms = online_ms + $11,
        source = $12,
        framed_ip = $13, nas_ip = $14, router_id = $15,
        customer_id = case when $16 = '' then customer_id else $16 end,
        service_id = case when $17 = '' then service_id else $17 end,
        updated_at = now()
     where id = $1`,
    [
      prev.id,
      sample.bytes_in,
      sample.bytes_out,
      dIn,
      dOut,
      up,
      down,
      avgUp,
      avgDown,
      samples,
      sample.online ? stepMs : 0,
      sample.source,
      sample.framed_ip,
      sample.nas_ip,
      sample.router_id,
      sample.customer_id,
      sample.service_id,
    ],
  );
  return "updated";
}

export async function collectTrafficSnapshot(
  sql: Sql,
  opts: { collectorId?: string; now?: Date; pollRouters?: boolean } = {},
) {
  const settings = await getTrafficSettings(sql);
  const collectorId = String(opts.collectorId || "default").slice(0, 80) || "default";
  const now = opts.now || new Date();
  const bucket = collectionBucket(now, settings.intervalSec);
  if (!settings.enabled) {
    await heartbeatCollector(sql, { collectorId, error: "disabled" });
    return { collectorId, sessions: 0, inserted: 0, updated: 0, duplicates: 0, mapped: 0, unmapped: 0, skipped: true, bucket: bucket.toISOString() };
  }
  await applyRls(sql, { bypass: true });
  const sessions = await sql.query<{
    tenant_id: string;
    username: string;
    nas_ip: string;
    framed_ip: string;
    bytes_in: number;
    bytes_out: number;
    stopped_at: string | null;
    started_at: string;
  }>(
    `select tenant_id, username, coalesce(nas_ip,'') as nas_ip, coalesce(framed_ip,'') as framed_ip,
            bytes_in, bytes_out, stopped_at::text as stopped_at, started_at::text as started_at
     from radius_sessions
     where stopped_at is null or started_at > now() - interval '2 hours'`,
  );

  const tenantIds = [...new Set(sessions.map((s) => s.tenant_id))];
  const maps = await loadServiceMaps(sql, tenantIds);
  const routers = await loadRouterIndex(sql, tenantIds);

  let inserted = 0;
  let updated = 0;
  let mapped = 0;
  let unmapped = 0;
  let redisOk = 0;
  let redisFail = 0;
  const radius = radiusAdapter(sessions.length);

  for (const ses of sessions) {
    const online = !ses.stopped_at;
    const mapping = mapIdentity(maps, {
      tenant_id: ses.tenant_id,
      username: ses.username,
      framed_ip: ses.framed_ip,
      nas_ip: ses.nas_ip,
    });
    if (!mapping) {
      unmapped += 1;
      noteUnmapped({ tenant_id: ses.tenant_id, username: ses.username, framed_ip: ses.framed_ip });
      continue;
    }
    mapped += 1;
    const router = matchRouter(routers, ses.tenant_id, ses.nas_ip);
    const prev = ses.username ? await readLiveSample(ses.tenant_id, ses.username) : null;
    const prevMs = prev ? Date.parse(prev.collected_at) : NaN;
    const up_bps = prev ? rateOrNull(prev.bytes_in, Number(ses.bytes_in || 0), prevMs, now.getTime()) : null;
    const down_bps = prev ? rateOrNull(prev.bytes_out, Number(ses.bytes_out || 0), prevMs, now.getTime()) : null;
    const sample: LiveSample = {
      tenant_id: ses.tenant_id,
      username: ses.username,
      service_id: mapping.service_id,
      customer_id: mapping.customer_id,
      package_id: mapping.package_id,
      access_method: mapping.access_method,
      nas_ip: ses.nas_ip,
      framed_ip: ses.framed_ip,
      router_id: router?.id || "",
      router_name: router?.name || "",
      bytes_in: Number(ses.bytes_in || 0),
      bytes_out: Number(ses.bytes_out || 0),
      up_bps,
      down_bps,
      online,
      source: "radius-accounting",
      collected_at: now.toISOString(),
      collector_id: collectorId,
    };
    if (online || prev) {
      const wrote = await writeLiveSample(sample, settings);
      if (wrote) redisOk += 1;
      else redisFail += 1;
    }
    const minute = await upsertMinute(sql, sample, settings, now);
    if (minute === "inserted") inserted += 1;
    else updated += 1;
  }

  await heartbeatCollector(sql, {
    collectorId,
    samplesOk: mapped,
    samplesDropped: unmapped,
  });
  await retainTrafficData(sql);
  try {
    const { enqueueJob } = await import("./jobs.ts");
    await enqueueJob(sql, {
      queue: "traffic",
      kind: "traffic.aggregate.hourly",
      payload: { hour: minuteBucket(now).toISOString() },
      idempotencyKey: `traffic.hourly:${new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString()}`,
    });
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
    await enqueueJob(sql, {
      queue: "traffic",
      kind: "traffic.aggregate.daily",
      payload: { day },
      idempotencyKey: `traffic.daily:${day}`,
    });
    const slot = Math.floor(now.getTime() / (settings.routerIntervalSec * 1000));
    await enqueueJob(sql, {
      queue: "traffic",
      kind: "traffic.router.poll",
      payload: { collectorId },
      idempotencyKey: `traffic.router:${slot}`,
    });
  } catch {
    /* jobs table may be mid-migrate */
  }

  if (opts.pollRouters) {
    try {
      const { pollRouterTelemetry } = await import("./traffic-router.ts");
      await pollRouterTelemetry(sql, { collectorId, now });
    } catch (err) {
      logEvent("warn", "traffic.router.poll", {
        operation: "traffic.router.poll",
        category: "traffic",
        result: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  metricIncr("traffic.samples", mapped);
  metricIncr("traffic.unmapped", unmapped);
  if (redisFail) metricIncr("traffic.redis_fail", redisFail);
  metricSet("traffic.last_ok_ms", Date.now());
  logEvent("info", "traffic.collect", {
    operation: "traffic.collect",
    result: "ok",
    category: "traffic",
  });
  return {
    collectorId,
    sessions: sessions.length,
    inserted,
    updated,
    duplicates: updated,
    mapped,
    unmapped,
    redisOk,
    redisFail,
    redis: getRedis().configured ? (redisFail && !redisOk ? "error" : "ok") : "not_configured",
    source: radius,
    bucket: bucket.toISOString(),
    ttlSec: liveTtlSec(settings),
  };
}

export async function retainTrafficSamples(sql: Sql, keepHours?: number) {
  if (keepHours != null) {
    await applyRls(sql, { bypass: true });
    const hours = Math.min(168, Math.max(1, keepHours));
    await sql.query(`delete from traffic_samples where collected_at < now() - ($1 * interval '1 hour')`, [hours]);
    await sql.query(`delete from traffic_minute where bucket_at < now() - ($1 * interval '1 hour')`, [hours]);
    return { keepHours: hours };
  }
  return retainTrafficData(sql);
}

export async function latestSamplesForUsernames(sql: Sql, tenantId: string, usernames: string[]) {
  if (!usernames.length) return [] as TrafficSample[];
  const minutes = await sql.query<TrafficSample>(
    `select distinct on (username)
        tenant_id, username, service_id, nas_ip, framed_ip, bytes_in, bytes_out,
        (online_ms > 0) as online, updated_at::text as collected_at, collector_id, source
     from traffic_minute
     where tenant_id = $1 and username = any($2::text[])
     order by username, bucket_at desc`,
    [tenantId, usernames],
  );
  if (minutes.length) return minutes;
  return sql.query<TrafficSample>(
    `select distinct on (username)
        tenant_id, username, service_id, nas_ip, framed_ip, bytes_in, bytes_out, online,
        collected_at::text as collected_at, collector_id
     from traffic_samples
     where tenant_id = $1 and username = any($2::text[])
     order by username, collected_at desc`,
    [tenantId, usernames],
  );
}

export async function liveTrafficFromCache(tenantId: string, username: string) {
  return readLiveSample(tenantId, username);
}

export async function shortSparkForUser(tenantId: string, username: string) {
  return readShortSpark(tenantId, username);
}

export async function collectorHealth(sql: Sql) {
  await applyRls(sql, { bypass: true });
  const rows = await sql.query<{
    id: string;
    last_ok_at: string | null;
    last_error: string;
    last_router_ok_at: string | null;
    samples_ok: number;
    samples_dropped: number;
  }>(
    `select id, last_ok_at::text as last_ok_at, last_error,
            last_router_ok_at::text as last_router_ok_at,
            samples_ok, samples_dropped
     from traffic_collectors order by last_seen desc nulls last limit 8`,
  );
  const latest = rows[0];
  if (!latest) return { status: "not_configured" as const, collectors: [] as typeof rows };
  const fresh = trafficFreshness(latest.last_ok_at);
  const status = latest.last_error
    ? ("error" as const)
    : fresh === "unavailable" || fresh === "stale"
      ? ("stale" as const)
      : ("ok" as const);
  return { status, collectors: rows, last_ok_at: latest.last_ok_at };
}
