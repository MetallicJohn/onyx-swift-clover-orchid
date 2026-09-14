#!/usr/bin/env node
/**
 * Thin traffic collector: asks the application to snapshot RADIUS sessions.
 * The collector can run on another VPS; it never talks to PostgreSQL directly.
 */
const BASE = (process.env.GRIDLINE_INTERNAL_URL || process.env.APP_URL || "").replace(/\/+$/, "");
const TOKEN = (process.env.INTERNAL_SERVICE_TOKEN || process.env.TRAFFIC_COLLECTOR_API_KEY || process.env.ACS_EDGE_TOKEN || "").trim();
const INTERVAL = Math.max(5000, Number(process.env.TRAFFIC_COLLECTION_INTERVAL || 30) * 1000);
const COLLECTOR_ID = (process.env.COLLECTOR_ID || "default").slice(0, 80);

if (!BASE) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "GRIDLINE_INTERNAL_URL is required", service: "collector" }));
  process.exit(1);
}
if (!TOKEN) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "INTERNAL_SERVICE_TOKEN is required", service: "collector" }));
  process.exit(1);
}

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(`${BASE}/api/internal/traffic`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-collector-id": COLLECTOR_ID,
        "x-request-id": `col_${Date.now()}`,
      },
      body: JSON.stringify({ collectorId: COLLECTOR_ID }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "traffic.poll", status: res.status, service: "collector" }));
    }
  } catch (err) {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg: "traffic.poll.error", error: err instanceof Error ? err.message : String(err), service: "collector" }));
  } finally {
    busy = false;
  }
}

console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "collector.start", base: BASE, intervalSec: INTERVAL / 1000, service: "collector" }));
void tick();
setInterval(() => void tick(), INTERVAL);
