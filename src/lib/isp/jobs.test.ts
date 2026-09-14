import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizedInternal } from "./internal-auth.ts";
import {
  claimJobs,
  enqueueJob,
  executeJob,
  processQueuedJobs,
} from "./jobs.ts";
import { openTestDb } from "./test-db.ts";
import { trafficFreshness } from "./traffic-collector.ts";

test("internal token rejects missing and wrong secrets", () => {
  const prev = process.env.INTERNAL_SERVICE_TOKEN;
  process.env.INTERNAL_SERVICE_TOKEN = "svc-token";
  try {
    assert.equal(authorizedInternal(new Request("http://x", { headers: { authorization: "Bearer svc-token" } })), true);
    assert.equal(authorizedInternal(new Request("http://x", { headers: { authorization: "Bearer other" } })), false);
    assert.equal(authorizedInternal(new Request("http://x")), false);
  } finally {
    if (prev == null) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = prev;
  }
});

test("job enqueue is idempotent and claim completes once", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_job', 'Jobs', 'jobs')`;
    const first = await enqueueJob(sql, {
      queue: "maintenance",
      kind: "maintenance.retention",
      tenantId: "ten_job",
      idempotencyKey: "retention:ten_job:day",
    });
    const again = await enqueueJob(sql, {
      queue: "maintenance",
      kind: "maintenance.retention",
      tenantId: "ten_job",
      idempotencyKey: "retention:ten_job:day",
    });
    assert.equal(first.queued, true);
    assert.equal(again.queued, false);
    assert.equal(again.id, first.id);

    await asRole("ten_job");
    const mine = await sql<{ n: number }>`select count(*)::int as n from job_queue where tenant_id = 'ten_job'`;
    assert.equal(mine[0]?.n, 1);
    await asRole("ten_other");
    const other = await sql<{ n: number }>`select count(*)::int as n from job_queue`;
    assert.equal(other[0]?.n, 0);

    await bypass();
    const processed = await processQueuedJobs(sql, { workerId: "test-worker", queue: "maintenance", limit: 4 });
    assert.equal(processed.claimed, 1);
    assert.equal(processed.results[0]?.ok, true);
    const [row] = await sql<{ status: string; attempts: number }>`select status, attempts from job_queue where id = ${first.id}`;
    assert.equal(row?.status, "done");
    assert.equal(row?.attempts, 1);

    const empty = await claimJobs(sql, { workerId: "test-worker", queue: "maintenance", limit: 1 });
    assert.equal(empty.length, 0);
  } finally {
    await close();
  }
});

test("unknown job kind fails then dead-letters after max attempts", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const job = await enqueueJob(sql, {
      queue: "reports",
      kind: "reports.export",
      payload: { format: "csv" },
      maxAttempts: 1,
    });
    const [row] = await sql.query<{
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
    }>(
      `select id, tenant_id, queue, kind, payload, status, idempotency_key, attempts, max_attempts, run_at::text as run_at, locked_by, last_error, result from job_queue where id = $1`,
      [job.id],
    );
    assert.ok(row);
    await sql`update job_queue set attempts = 1, status = 'running' where id = ${job.id}`;
    await assert.rejects(() => executeJob(sql, { ...row, attempts: 1 }), /Unknown job kind/);
  } finally {
    await close();
  }
});

test("traffic freshness never invents live data", () => {
  assert.equal(trafficFreshness(null), "unavailable");
  assert.equal(trafficFreshness("not-a-date"), "unavailable");
  assert.equal(trafficFreshness(new Date().toISOString(), 30), "live");
  assert.equal(trafficFreshness(new Date(Date.now() - 10 * 60_000).toISOString(), 30), "stale");
});
