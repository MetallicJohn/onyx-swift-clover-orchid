#!/usr/bin/env node
/**
 * Thin worker: polls the application internal jobs API.
 * Execution stays in the web process (VPS image has .output only).
 */
const BASE = (process.env.ISPSOLUTIONS_INTERNAL_URL || process.env.GRIDLINE_INTERNAL_URL || process.env.APP_URL || "").replace(/\/+$/, "");
const TOKEN = (process.env.INTERNAL_SERVICE_TOKEN || process.env.ACS_EDGE_TOKEN || "").trim();
const QUEUE = (process.env.JOB_QUEUE_NAME || "").trim();
const INTERVAL = Math.max(1000, Number(process.env.WORKER_POLL_MS || 2500));
const LIMIT = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 2));
const WORKER_ID = (process.env.WORKER_ID || `worker-${process.pid}`).slice(0, 80);

if (!BASE) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "ISPSOLUTIONS_INTERNAL_URL is required", service: "worker" }));
  process.exit(1);
}
if (!TOKEN) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "INTERNAL_SERVICE_TOKEN is required", service: "worker" }));
  process.exit(1);
}

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(`${BASE}/api/internal/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-worker-id": WORKER_ID,
        "x-request-id": `wrk_${Date.now()}`,
      },
      body: JSON.stringify({ queue: QUEUE, limit: LIMIT, workerId: WORKER_ID }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "jobs.poll", status: res.status, service: "worker" }));
    } else {
      let body = {};
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
      if (body.claimed) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "jobs.run", claimed: body.claimed, service: "worker" }));
      }
    }
  } catch (err) {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "jobs.poll.error", error: err instanceof Error ? err.message : String(err), service: "worker" }));
  } finally {
    busy = false;
  }
}

console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "worker.start", base: BASE, queue: QUEUE || "*", service: "worker" }));
void tick();
setInterval(() => void tick(), INTERVAL);
