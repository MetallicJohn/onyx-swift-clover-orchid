import { nid } from "../utils.ts";
import { metricIncr, metricSet } from "./metrics.ts";
import { logEvent } from "./obs.ts";
import { applyRls } from "./rls.ts";
import { getRedis } from "./redis.ts";
import { JOB_QUEUES, loadServiceConfig, type JobQueueName } from "./runtime-config.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type JobStatus = "queued" | "running" | "done" | "failed" | "dead";

export type JobRow = {
  id: string;
  tenant_id: string;
  queue: string;
  kind: string;
  payload: string;
  status: string;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_by: string;
  last_error: string;
  result: string;
};

export type EnqueueInput = {
  queue: JobQueueName | string;
  kind: string;
  tenantId?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
};

function backoffSec(attempts: number) {
  return Math.min(300, 2 ** Math.max(1, attempts));
}

export function assertQueueName(name: string): JobQueueName {
  if ((JOB_QUEUES as readonly string[]).includes(name)) return name as JobQueueName;
  throw new Error(`Unknown job queue ${name}`);
}

export async function enqueueJob(sql: Sql, input: EnqueueInput) {
  const queue = assertQueueName(String(input.queue));
  const kind = String(input.kind || "").trim();
  if (!kind) throw new Error("Job kind is required");
  const id = nid("job");
  const key = String(input.idempotencyKey || "").slice(0, 180);
  const payload = JSON.stringify(input.payload || {});
  const tenantId = String(input.tenantId || "");
  const runAt = (input.runAt || new Date()).toISOString();
  const maxAttempts = Math.min(32, Math.max(1, input.maxAttempts || 8));
  if (key) {
    const existing = await sql.query<{ id: string; status: string }>(
      `select id, status from job_queue where queue = $1 and idempotency_key = $2 limit 1`,
      [queue, key],
    );
    if (existing[0]) {
      return { id: existing[0].id, queued: false, status: existing[0].status };
    }
  }
  try {
    await sql.query(
      `insert into job_queue (id, tenant_id, queue, kind, payload, status, idempotency_key, max_attempts, run_at)
       values ($1,$2,$3,$4,$5,'queued',$6,$7,$8)`,
      [id, tenantId, queue, kind, payload, key, maxAttempts, runAt],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (key && /unique|duplicate/i.test(msg)) {
      const [row] = await sql.query<{ id: string; status: string }>(
        `select id, status from job_queue where queue = $1 and idempotency_key = $2 limit 1`,
        [queue, key],
      );
      if (row) return { id: row.id, queued: false, status: row.status };
    }
    throw err;
  }
  metricIncr("jobs.enqueued");
  return { id, queued: true, status: "queued" as const };
}

export async function claimJobs(sql: Sql, opts: { workerId: string; queue?: string; limit?: number }) {
  const limit = Math.min(32, Math.max(1, opts.limit || loadServiceConfig().workerConcurrency));
  const workerId = String(opts.workerId || "worker").slice(0, 80);
  const queue = String(opts.queue || "").trim();
  const claimed: JobRow[] = [];
  for (let i = 0; i < limit; i += 1) {
    const rows = queue
      ? await sql.query<JobRow>(
          `update job_queue set status = 'running', locked_at = now(), locked_by = $1,
                  attempts = attempts + 1, updated_at = now()
           where id = (
             select id from job_queue
             where status = 'queued' and queue = $2 and run_at <= now()
             order by run_at, created_at
             for update skip locked
             limit 1
           )
           returning id, tenant_id, queue, kind, payload, status, idempotency_key,
                     attempts, max_attempts, run_at::text as run_at, locked_by, last_error, result`,
          [workerId, queue],
        )
      : await sql.query<JobRow>(
          `update job_queue set status = 'running', locked_at = now(), locked_by = $1,
                  attempts = attempts + 1, updated_at = now()
           where id = (
             select id from job_queue
             where status = 'queued' and run_at <= now()
             order by run_at, created_at
             for update skip locked
             limit 1
           )
           returning id, tenant_id, queue, kind, payload, status, idempotency_key,
                     attempts, max_attempts, run_at::text as run_at, locked_by, last_error, result`,
          [workerId],
        );
    if (!rows[0]) break;
    claimed.push(rows[0]);
  }
  return claimed;
}

export async function completeJob(sql: Sql, id: string, result: unknown = {}) {
  await sql.query(
    `update job_queue set status = 'done', result = $2, last_error = '', completed_at = now(), updated_at = now()
     where id = $1`,
    [id, JSON.stringify(result ?? {})],
  );
  metricIncr("jobs.done");
}

export async function failJob(sql: Sql, job: JobRow, error: string) {
  const dead = job.attempts >= job.max_attempts;
  const status = dead ? "dead" : "queued";
  const runAt = new Date(Date.now() + backoffSec(job.attempts) * 1000).toISOString();
  await sql.query(
    `update job_queue set status = $2, last_error = $3, run_at = $4, locked_by = '', locked_at = null, updated_at = now()
     where id = $1`,
    [job.id, status, String(error || "failed").slice(0, 500), runAt],
  );
  metricIncr(dead ? "jobs.dead" : "jobs.failed");
  logEvent(dead ? "error" : "warn", "job.failed", {
    operation: job.kind,
    category: "jobs",
    tenantId: job.tenant_id || undefined,
    error: String(error || "failed").slice(0, 200),
    result: status,
  });
}

async function lockKey(kind: string, tenantId: string, extra: string) {
  try {
    const redis = getRedis();
    if (!redis.configured) return true;
    return await redis.setNx(`joblock:${kind}:${tenantId}:${extra}`, "1", 60);
  } catch {
    return true;
  }
}

export async function executeJob(sql: Sql, job: JobRow) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(job.payload || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const tenantId = job.tenant_id || String(payload.tenantId || "");
  if (tenantId) await applyRls(sql, { tenantId, bypass: false });
  else await applyRls(sql, { bypass: true });

  if (job.kind === "billing.cycle") {
    if (!tenantId) throw new Error("billing.cycle requires tenantId");
    const locked = await lockKey(job.kind, tenantId, String(payload.day || ""));
    if (!locked) return { skipped: true, reason: "lock" };
    const { runBillingCycle } = await import("./notifications.ts");
    const [t] = await sql<{ name: string }>`select name from tenants where id = ${tenantId}`;
    return runBillingCycle(sql, tenantId, t?.name || "");
  }

  if (job.kind === "customers.import") {
    if (!tenantId) throw new Error("customers.import requires tenantId");
    const { confirmCustomerImport } = await import("./onboard-import.ts");
    const [t] = await sql<{ name: string }>`select name from tenants where id = ${tenantId}`;
    return confirmCustomerImport(sql, {
      tenantId,
      tenantName: t?.name || "",
      actorId: String(payload.actorId || job.locked_by || ""),
      input: {
        text: String(payload.text || ""),
        mode: (payload.mode as "new" | "continuing" | "reactivation" | "mixed") || "continuing",
        map: (payload.map as Record<string, string> | undefined) as never,
      },
    });
  }

  if (job.kind === "traffic.collect") {
    await applyRls(sql, { bypass: true });
    const { collectTrafficSnapshot } = await import("./traffic-collector.ts");
    return collectTrafficSnapshot(sql, {
      collectorId: String(payload.collectorId || job.locked_by || "default"),
      pollRouters: payload.pollRouters === true,
    });
  }

  if (job.kind === "traffic.router.poll") {
    await applyRls(sql, { bypass: true });
    const { pollRouterTelemetry } = await import("./traffic-router.ts");
    return pollRouterTelemetry(sql, {
      collectorId: String(payload.collectorId || job.locked_by || "default"),
    });
  }

  if (job.kind === "traffic.aggregate.hourly") {
    await applyRls(sql, { bypass: true });
    const { aggregateHourly } = await import("./traffic-aggregate.ts");
    const hour = payload.hour ? new Date(String(payload.hour)) : undefined;
    return aggregateHourly(sql, { hour });
  }

  if (job.kind === "traffic.aggregate.daily") {
    await applyRls(sql, { bypass: true });
    const { aggregateDaily } = await import("./traffic-aggregate.ts");
    const day = payload.day ? new Date(String(payload.day)) : undefined;
    return aggregateDaily(sql, { day });
  }

  if (job.kind === "genieacs.sync") {
    if (!tenantId) throw new Error("genieacs.sync requires tenantId");
    const { syncAcsDevices } = await import("./acs.ts");
    return syncAcsDevices(sql, tenantId);
  }

  if (job.kind === "maintenance.retention") {
    await applyRls(sql, { bypass: true });
    const { retainTrafficSamples } = await import("./traffic-collector.ts");
    return retainTrafficSamples(sql);
  }

  if (job.kind === "mikrotik.health" || job.kind === "mikrotik.api_verify") {
    await applyRls(sql, { bypass: true });
    const { persistHandshake, snapshotHealth, verifyRouterApi } = await import("./router-health.ts");
    const { persistWantedHubPeersFromSql, readHostWgDump } = await import("./wg-host.ts");
    await persistWantedHubPeersFromSql(sql).catch(() => 0);
    const dump = await readHostWgDump();
    const rows = await sql.query<{
      id: string;
      tenant_id: string;
      enroll_state: string;
      wg_public: string;
      wg_public_previous: string;
      wg_address: string;
      api_user: string;
      api_password: string;
      api_password_previous: string;
      api_port: number;
      last_seen: string | null;
      last_handshake_at: string | null;
      api_verified_at: string | null;
      agent_last_ok_at: string | null;
      wg_rx_bytes: number;
      wg_tx_bytes: number;
    }>(
      `select id, tenant_id, coalesce(enroll_state,'PENDING') as enroll_state, coalesce(wg_public,'') as wg_public,
              coalesce(wg_public_previous,'') as wg_public_previous,
              coalesce(wg_address,'') as wg_address, coalesce(api_user,'') as api_user, coalesce(api_password,'') as api_password,
              coalesce(api_password_previous,'') as api_password_previous,
              coalesce(api_port,8728) as api_port, last_seen::text as last_seen, last_handshake_at::text as last_handshake_at,
              api_verified_at::text as api_verified_at, agent_last_ok_at::text as agent_last_ok_at,
              coalesce(wg_rx_bytes,0)::bigint as wg_rx_bytes, coalesce(wg_tx_bytes,0)::bigint as wg_tx_bytes
       from routers where archived_at is null and enroll_state <> 'REVOKED'
       order by name limit 80`,
    );
    const out: Array<{ id: string; handshake?: boolean; api?: boolean }> = [];
    for (const row of rows) {
      if (tenantId && row.tenant_id !== tenantId) continue;
      const hs = await persistHandshake(sql, row, dump);
      if (job.kind === "mikrotik.api_verify" || hs.handshake) {
        const api = await verifyRouterApi(sql, row);
        await snapshotHealth(sql, { ...row, last_handshake_at: hs.lastHandshakeAt });
        out.push({ id: row.id, handshake: hs.handshake, api: api.ok });
      } else {
        out.push({ id: row.id, handshake: hs.handshake });
      }
    }
    return { routers: out.length, results: out };
  }

  throw new Error(`Unknown job kind ${job.kind}`);
}

export async function processQueuedJobs(
  sql: Sql,
  opts: { workerId?: string; queue?: string; limit?: number } = {},
) {
  const { withDbSession } = await import("../db-session.ts");
  return withDbSession(() => processQueuedJobsOnSession(sql, opts));
}

async function processQueuedJobsOnSession(
  sql: Sql,
  opts: { workerId?: string; queue?: string; limit?: number },
) {
  await applyRls(sql, { bypass: true });
  const claimed = await claimJobs(sql, {
    workerId: opts.workerId || `pid_${process.pid}`,
    queue: opts.queue,
    limit: opts.limit,
  });
  const results: Array<{ id: string; kind: string; ok: boolean; error?: string }> = [];
  for (const job of claimed) {
    const started = Date.now();
    try {
      const result = await executeJob(sql, job);
      await applyRls(sql, { bypass: true });
      await completeJob(sql, job.id, result);
      results.push({ id: job.id, kind: job.kind, ok: true });
      logEvent("info", "job.done", {
        operation: job.kind,
        tenantId: job.tenant_id || undefined,
        durationMs: Date.now() - started,
        result: "ok",
      });
    } catch (err) {
      await applyRls(sql, { bypass: true });
      const message = err instanceof Error ? err.message : String(err);
      await failJob(sql, job, message);
      results.push({ id: job.id, kind: job.kind, ok: false, error: message });
    }
  }
  return { claimed: claimed.length, results };
}

export async function jobHealth(sql: Sql) {
  await applyRls(sql, { bypass: true });
  const [row] = await sql.query<{ queued: number; running: number; failed: number; dead: number }>(
    `select
        coalesce(sum(case when status = 'queued' then 1 else 0 end),0)::int as queued,
        coalesce(sum(case when status = 'running' then 1 else 0 end),0)::int as running,
        coalesce(sum(case when status = 'queued' and last_error <> '' then 1 else 0 end),0)::int as failed,
        coalesce(sum(case when status = 'dead' then 1 else 0 end),0)::int as dead
     from job_queue`,
  );
  const stats = row || { queued: 0, running: 0, failed: 0, dead: 0 };
  metricSet("jobs.queued", stats.queued);
  metricSet("jobs.dead", stats.dead);
  return stats;
}

export function billingIdempotencyKey(tenantId: string, at = new Date()) {
  const day = at.toISOString().slice(0, 10);
  return `billing.cycle:${tenantId}:${day}`;
}

export async function enqueueBillingForAllTenants(sql: Sql) {
  await applyRls(sql, { bypass: true });
  const tenants = await sql<{ id: string; name: string }>`select id, name from tenants`;
  const queued = [];
  const day = new Date().toISOString().slice(0, 10);
  for (const t of tenants) {
    queued.push(
      await enqueueJob(sql, {
        queue: "billing",
        kind: "billing.cycle",
        tenantId: t.id,
        payload: { tenantId: t.id, day },
        idempotencyKey: billingIdempotencyKey(t.id),
      }),
    );
  }
  return { tenants: tenants.length, queued };
}
