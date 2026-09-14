import { nid } from "../utils.ts";
import { logEvent } from "./obs.ts";
import { metricIncr, metricSet } from "./metrics.ts";
import { applyRls } from "./rls.ts";
import { getTrafficSettings } from "./traffic-settings.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export function minuteBucket(at = new Date()) {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}

export function hourBucket(at = new Date()) {
  return new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
}

export function dayBucket(at = new Date()) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

async function upsertRollup(
  sql: Sql,
  table: "traffic_hourly" | "traffic_daily",
  row: {
    tenant_id: string;
    subject_type: string;
    subject_id: string;
    bytes_in: number;
    bytes_out: number;
    peak_up_bps: number;
    peak_down_bps: number;
    avg_up_bps: number;
    avg_down_bps: number;
    online_ms: number;
    session_count: number;
    samples: number;
    bucket_at: string;
  },
) {
  await sql.query(
    `insert into ${table} (
        id, tenant_id, subject_type, subject_id, bytes_in, bytes_out,
        peak_up_bps, peak_down_bps, avg_up_bps, avg_down_bps,
        online_ms, session_count, samples, bucket_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     on conflict (tenant_id, subject_type, subject_id, bucket_at) do update set
        bytes_in = excluded.bytes_in,
        bytes_out = excluded.bytes_out,
        peak_up_bps = excluded.peak_up_bps,
        peak_down_bps = excluded.peak_down_bps,
        avg_up_bps = excluded.avg_up_bps,
        avg_down_bps = excluded.avg_down_bps,
        online_ms = excluded.online_ms,
        session_count = excluded.session_count,
        samples = excluded.samples,
        updated_at = now()`,
    [
      nid(table === "traffic_hourly" ? "th" : "td"),
      row.tenant_id,
      row.subject_type,
      row.subject_id,
      row.bytes_in,
      row.bytes_out,
      row.peak_up_bps,
      row.peak_down_bps,
      row.avg_up_bps,
      row.avg_down_bps,
      row.online_ms,
      row.session_count,
      row.samples,
      row.bucket_at,
    ],
  );
}

export async function aggregateHourly(sql: Sql, opts: { now?: Date; hour?: Date } = {}) {
  const started = Date.now();
  await applyRls(sql, { bypass: true });
  const hour = hourBucket(opts.hour || opts.now || new Date());
  const next = new Date(hour.getTime() + 3_600_000);
  const rows = await sql.query<{
    tenant_id: string;
    service_id: string;
    customer_id: string;
    router_id: string;
    bytes_in: string;
    bytes_out: string;
    peak_up: string;
    peak_down: string;
    avg_up: string;
    avg_down: string;
    online_ms: string;
    samples: number;
    identities: number;
  }>(
    `select tenant_id,
            coalesce(nullif(service_id,''),'') as service_id,
            coalesce(nullif(customer_id,''),'') as customer_id,
            coalesce(nullif(router_id,''),'') as router_id,
            coalesce(sum(delta_in),0)::text as bytes_in,
            coalesce(sum(delta_out),0)::text as bytes_out,
            coalesce(max(peak_up_bps),0)::text as peak_up,
            coalesce(max(peak_down_bps),0)::text as peak_down,
            coalesce(avg(avg_up_bps),0)::text as avg_up,
            coalesce(avg(avg_down_bps),0)::text as avg_down,
            coalesce(sum(online_ms),0)::text as online_ms,
            coalesce(sum(samples),0)::int as samples,
            count(*)::int as identities
     from traffic_minute
     where bucket_at >= $1 and bucket_at < $2
     group by tenant_id, coalesce(nullif(service_id,''),''), coalesce(nullif(customer_id,''),''), coalesce(nullif(router_id,''),'')`,
    [hour.toISOString(), next.toISOString()],
  );

  let upserts = 0;
  const customerAcc = new Map<string, typeof rows[number]>();
  const routerAcc = new Map<string, typeof rows[number]>();

  for (const row of rows) {
    if (row.service_id) {
      await upsertRollup(sql, "traffic_hourly", {
        tenant_id: row.tenant_id,
        subject_type: "service",
        subject_id: row.service_id,
        bytes_in: Number(row.bytes_in || 0),
        bytes_out: Number(row.bytes_out || 0),
        peak_up_bps: Number(row.peak_up || 0),
        peak_down_bps: Number(row.peak_down || 0),
        avg_up_bps: Math.round(Number(row.avg_up || 0)),
        avg_down_bps: Math.round(Number(row.avg_down || 0)),
        online_ms: Number(row.online_ms || 0),
        session_count: Number(row.identities || 0),
        samples: Number(row.samples || 0),
        bucket_at: hour.toISOString(),
      });
      upserts += 1;
    }
    if (row.customer_id) {
      const key = `${row.tenant_id}\0${row.customer_id}`;
      const prev = customerAcc.get(key);
      if (!prev) customerAcc.set(key, { ...row });
      else {
        prev.bytes_in = String(Number(prev.bytes_in) + Number(row.bytes_in));
        prev.bytes_out = String(Number(prev.bytes_out) + Number(row.bytes_out));
        prev.peak_up = String(Math.max(Number(prev.peak_up), Number(row.peak_up)));
        prev.peak_down = String(Math.max(Number(prev.peak_down), Number(row.peak_down)));
        prev.online_ms = String(Number(prev.online_ms) + Number(row.online_ms));
        prev.samples = Number(prev.samples) + Number(row.samples);
        prev.identities = Number(prev.identities) + Number(row.identities);
      }
    }
    if (row.router_id) {
      const key = `${row.tenant_id}\0${row.router_id}`;
      const prev = routerAcc.get(key);
      if (!prev) routerAcc.set(key, { ...row });
      else {
        prev.bytes_in = String(Number(prev.bytes_in) + Number(row.bytes_in));
        prev.bytes_out = String(Number(prev.bytes_out) + Number(row.bytes_out));
        prev.peak_up = String(Math.max(Number(prev.peak_up), Number(row.peak_up)));
        prev.peak_down = String(Math.max(Number(prev.peak_down), Number(row.peak_down)));
        prev.samples = Number(prev.samples) + Number(row.samples);
      }
    }
  }

  for (const row of customerAcc.values()) {
    await upsertRollup(sql, "traffic_hourly", {
      tenant_id: row.tenant_id,
      subject_type: "customer",
      subject_id: row.customer_id,
      bytes_in: Number(row.bytes_in || 0),
      bytes_out: Number(row.bytes_out || 0),
      peak_up_bps: Number(row.peak_up || 0),
      peak_down_bps: Number(row.peak_down || 0),
      avg_up_bps: Math.round(Number(row.avg_up || 0)),
      avg_down_bps: Math.round(Number(row.avg_down || 0)),
      online_ms: Number(row.online_ms || 0),
      session_count: Number(row.identities || 0),
      samples: Number(row.samples || 0),
      bucket_at: hour.toISOString(),
    });
    upserts += 1;
  }
  for (const row of routerAcc.values()) {
    await upsertRollup(sql, "traffic_hourly", {
      tenant_id: row.tenant_id,
      subject_type: "router",
      subject_id: row.router_id,
      bytes_in: Number(row.bytes_in || 0),
      bytes_out: Number(row.bytes_out || 0),
      peak_up_bps: Number(row.peak_up || 0),
      peak_down_bps: Number(row.peak_down || 0),
      avg_up_bps: Math.round(Number(row.avg_up || 0)),
      avg_down_bps: Math.round(Number(row.avg_down || 0)),
      online_ms: Number(row.online_ms || 0),
      session_count: Number(row.identities || 0),
      samples: Number(row.samples || 0),
      bucket_at: hour.toISOString(),
    });
    upserts += 1;
  }

  metricSet("traffic.aggregate_hourly_ms", Date.now() - started);
  metricIncr("traffic.hourly_upserts", upserts);
  logEvent("info", "traffic.aggregate.hourly", {
    operation: "traffic.aggregate.hourly",
    category: "traffic",
    result: "ok",
    durationMs: Date.now() - started,
  });
  return { hour: hour.toISOString(), groups: rows.length, upserts };
}

export async function aggregateDaily(sql: Sql, opts: { now?: Date; day?: Date } = {}) {
  const started = Date.now();
  await applyRls(sql, { bypass: true });
  const day = dayBucket(opts.day || opts.now || new Date());
  const next = new Date(day.getTime() + 86_400_000);
  const rows = await sql.query<{
    tenant_id: string;
    subject_type: string;
    subject_id: string;
    bytes_in: string;
    bytes_out: string;
    peak_up: string;
    peak_down: string;
    avg_up: string;
    avg_down: string;
    online_ms: string;
    session_count: number;
    samples: number;
  }>(
    `select tenant_id, subject_type, subject_id,
            coalesce(sum(bytes_in),0)::text as bytes_in,
            coalesce(sum(bytes_out),0)::text as bytes_out,
            coalesce(max(peak_up_bps),0)::text as peak_up,
            coalesce(max(peak_down_bps),0)::text as peak_down,
            coalesce(avg(avg_up_bps),0)::text as avg_up,
            coalesce(avg(avg_down_bps),0)::text as avg_down,
            coalesce(sum(online_ms),0)::text as online_ms,
            coalesce(sum(session_count),0)::int as session_count,
            coalesce(sum(samples),0)::int as samples
     from traffic_hourly
     where bucket_at >= $1 and bucket_at < $2
     group by tenant_id, subject_type, subject_id`,
    [day.toISOString(), next.toISOString()],
  );
  let upserts = 0;
  for (const row of rows) {
    await upsertRollup(sql, "traffic_daily", {
      tenant_id: row.tenant_id,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      bytes_in: Number(row.bytes_in || 0),
      bytes_out: Number(row.bytes_out || 0),
      peak_up_bps: Number(row.peak_up || 0),
      peak_down_bps: Number(row.peak_down || 0),
      avg_up_bps: Math.round(Number(row.avg_up || 0)),
      avg_down_bps: Math.round(Number(row.avg_down || 0)),
      online_ms: Number(row.online_ms || 0),
      session_count: Number(row.session_count || 0),
      samples: Number(row.samples || 0),
      bucket_at: day.toISOString(),
    });
    upserts += 1;
  }
  metricSet("traffic.aggregate_daily_ms", Date.now() - started);
  metricIncr("traffic.daily_upserts", upserts);
  logEvent("info", "traffic.aggregate.daily", {
    operation: "traffic.aggregate.daily",
    category: "traffic",
    result: "ok",
    durationMs: Date.now() - started,
  });
  return { day: day.toISOString(), groups: rows.length, upserts };
}

export async function retainTrafficData(sql: Sql) {
  await applyRls(sql, { bypass: true });
  const settings = await getTrafficSettings(sql);
  await sql.query(`delete from traffic_minute where bucket_at < now() - ($1 * interval '1 hour')`, [settings.shortHours]);
  await sql.query(`delete from traffic_hourly where bucket_at < now() - ($1 * interval '1 day')`, [settings.hourlyDays]);
  await sql.query(`delete from traffic_daily where bucket_at < now() - ($1 * interval '1 day')`, [settings.dailyDays]);
  await sql.query(`delete from router_metrics where collected_at < now() - ($1 * interval '1 hour')`, [settings.shortHours]);
  await sql.query(`delete from interface_metrics where collected_at < now() - ($1 * interval '1 hour')`, [
    settings.shortHours,
  ]);
  await sql.query(`delete from traffic_samples where collected_at < now() - ($1 * interval '1 hour')`, [
    Math.min(24, settings.shortHours),
  ]);
  return {
    shortHours: settings.shortHours,
    hourlyDays: settings.hourlyDays,
    dailyDays: settings.dailyDays,
  };
}

export async function customerTrafficHistory(
  sql: Sql,
  tenantId: string,
  customerId: string,
  opts: { hours?: number } = {},
) {
  const hours = Math.min(168, Math.max(6, opts.hours || 24));
  const rows = await sql.query<{
    bucket_at: string;
    bytes_in: number;
    bytes_out: number;
    peak_up_bps: number;
    peak_down_bps: number;
    avg_up_bps: number;
    avg_down_bps: number;
    online_ms: number;
  }>(
    `select bucket_at::text as bucket_at, bytes_in, bytes_out, peak_up_bps, peak_down_bps, avg_up_bps, avg_down_bps, online_ms
     from traffic_hourly
     where tenant_id = $1 and subject_type = 'customer' and subject_id = $2
       and bucket_at > now() - ($3 * interval '1 hour')
     order by bucket_at`,
    [tenantId, customerId, hours],
  );
  return {
    hours,
    buckets: rows.map((r) => ({
      at: r.bucket_at,
      bytes_in: Number(r.bytes_in || 0),
      bytes_out: Number(r.bytes_out || 0),
      peak_up_bps: Number(r.peak_up_bps || 0),
      peak_down_bps: Number(r.peak_down_bps || 0),
      avg_up_bps: Number(r.avg_up_bps || 0),
      avg_down_bps: Number(r.avg_down_bps || 0),
      online_ms: Number(r.online_ms || 0),
    })),
  };
}

export async function serviceTrafficHistory(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  opts: { hours?: number } = {},
) {
  const hours = Math.min(168, Math.max(6, opts.hours || 24));
  const rows = await sql.query<{
    bucket_at: string;
    bytes_in: number;
    bytes_out: number;
    peak_up_bps: number;
    peak_down_bps: number;
    avg_up_bps: number;
    avg_down_bps: number;
    online_ms: number;
  }>(
    `select bucket_at::text as bucket_at, bytes_in, bytes_out, peak_up_bps, peak_down_bps, avg_up_bps, avg_down_bps, online_ms
     from traffic_hourly
     where tenant_id = $1 and subject_type = 'service' and subject_id = $2
       and bucket_at > now() - ($3 * interval '1 hour')
     order by bucket_at`,
    [tenantId, serviceId, hours],
  );
  return {
    hours,
    buckets: rows.map((r) => ({
      at: r.bucket_at,
      bytes_in: Number(r.bytes_in || 0),
      bytes_out: Number(r.bytes_out || 0),
      peak_up_bps: Number(r.peak_up_bps || 0),
      peak_down_bps: Number(r.peak_down_bps || 0),
      avg_up_bps: Number(r.avg_up_bps || 0),
      avg_down_bps: Number(r.avg_down_bps || 0),
      online_ms: Number(r.online_ms || 0),
    })),
  };
}
