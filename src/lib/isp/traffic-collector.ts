import { nid } from "../utils.ts";
import { metricIncr, metricSet } from "./metrics.ts";
import { logEvent } from "./obs.ts";
import { getRedis } from "./redis.ts";
import { applyRls } from "./rls.ts";
import { loadServiceConfig } from "./runtime-config.ts";

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
};

export function collectionBucket(at = new Date(), intervalSec = loadServiceConfig().trafficIntervalSec) {
  const ms = Math.max(5, intervalSec) * 1000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

export async function heartbeatCollector(
  sql: Sql,
  opts: { collectorId: string; error?: string },
) {
  const id = String(opts.collectorId || "default").slice(0, 80) || "default";
  const err = String(opts.error || "").slice(0, 400);
  await sql.query(
    `insert into traffic_collectors (id, name, last_seen, last_ok_at, last_error)
     values ($1, $1, now(), ${err ? "null" : "now()"}, $2)
     on conflict (id) do update set
       last_seen = now(),
       last_ok_at = case when $2 = '' then now() else traffic_collectors.last_ok_at end,
       last_error = $2`,
    [id, err],
  );
  return { id };
}

export async function collectTrafficSnapshot(
  sql: Sql,
  opts: { collectorId?: string; now?: Date } = {},
) {
  const cfg = loadServiceConfig();
  const collectorId = String(opts.collectorId || "default").slice(0, 80) || "default";
  const now = opts.now || new Date();
  const bucket = collectionBucket(now, cfg.trafficIntervalSec);
  await applyRls(sql, { bypass: true });
  const sessions = await sql.query<{
    tenant_id: string;
    username: string;
    nas_ip: string;
    framed_ip: string;
    bytes_in: number;
    bytes_out: number;
    stopped_at: string | null;
  }>(
    `select tenant_id, username, coalesce(nas_ip,'') as nas_ip, coalesce(framed_ip,'') as framed_ip,
            bytes_in, bytes_out, stopped_at::text as stopped_at
     from radius_sessions
     where stopped_at is null or started_at > now() - interval '2 hours'`,
  );

  let inserted = 0;
  let duplicates = 0;
  const redis = getRedis();
  for (const ses of sessions) {
    const online = !ses.stopped_at;
    const id = nid("tsamp");
    try {
      await sql.query(
        `insert into traffic_samples
           (id, tenant_id, collector_id, username, nas_ip, framed_ip, bytes_in, bytes_out, online, bucket_at, collected_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          ses.tenant_id,
          collectorId,
          ses.username,
          ses.nas_ip,
          ses.framed_ip,
          Number(ses.bytes_in || 0),
          Number(ses.bytes_out || 0),
          online,
          bucket.toISOString(),
          now.toISOString(),
        ],
      );
      inserted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate/i.test(msg)) {
        duplicates += 1;
      } else {
        throw err;
      }
    }
    if (online) {
      const live = JSON.stringify({
        username: ses.username,
        nas_ip: ses.nas_ip,
        framed_ip: ses.framed_ip,
        bytes_in: Number(ses.bytes_in || 0),
        bytes_out: Number(ses.bytes_out || 0),
        collected_at: now.toISOString(),
        collector_id: collectorId,
      });
      try {
        await redis.set(`traffic:live:${ses.tenant_id}:${ses.username}`, live, cfg.trafficIntervalSec * 3);
      } catch {
        /* redis is optional */
      }
    }
  }
  await heartbeatCollector(sql, { collectorId });
  await retainTrafficSamples(sql);
  metricIncr("traffic.samples", inserted);
  metricSet("traffic.last_ok_ms", Date.now());
  logEvent("info", "traffic.collect", {
    operation: "traffic.collect",
    result: "ok",
    category: "traffic",
  });
  return { collectorId, sessions: sessions.length, inserted, duplicates, bucket: bucket.toISOString() };
}

export async function retainTrafficSamples(sql: Sql, keepHours = 24) {
  await applyRls(sql, { bypass: true });
  const hours = Math.min(168, Math.max(1, keepHours));
  await sql.query(`delete from traffic_samples where collected_at < now() - ($1 * interval '1 hour')`, [hours]);
  return { keepHours: hours };
}

export async function latestSamplesForUsernames(sql: Sql, tenantId: string, usernames: string[]) {
  if (!usernames.length) return [] as TrafficSample[];
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
  try {
    const raw = await getRedis().get(`traffic:live:${tenantId}:${username}`);
    if (!raw) return null;
    return JSON.parse(raw) as {
      username: string;
      nas_ip: string;
      framed_ip: string;
      bytes_in: number;
      bytes_out: number;
      collected_at: string;
      collector_id: string;
    };
  } catch {
    return null;
  }
}

export function trafficFreshness(collectedAt: string | null | undefined, intervalSec = loadServiceConfig().trafficIntervalSec) {
  if (!collectedAt) return "unavailable" as const;
  const t = Date.parse(collectedAt);
  if (Number.isNaN(t)) return "unavailable" as const;
  const age = Date.now() - t;
  if (age <= intervalSec * 3 * 1000) return "live" as const;
  if (age <= 15 * 60 * 1000) return "stale" as const;
  return "unavailable" as const;
}

export async function collectorHealth(sql: Sql) {
  await applyRls(sql, { bypass: true });
  const rows = await sql.query<{ id: string; last_ok_at: string | null; last_error: string }>(
    `select id, last_ok_at::text as last_ok_at, last_error from traffic_collectors order by last_seen desc nulls last limit 8`,
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
