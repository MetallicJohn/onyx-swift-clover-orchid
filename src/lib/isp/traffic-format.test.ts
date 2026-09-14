import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesToBps, formatBps, formatDuration, meterPercent, trafficFreshness, TRAFFIC_POLL_MS } from "./traffic-format.ts";

test("bytesToBps uses octet deltas over wall time", () => {
  // 1_250_000 bytes over 5s = 2_000_000 bps = 2 Mbps
  assert.equal(bytesToBps(0, 1_250_000, 0, 5000), 2_000_000);
  assert.equal(bytesToBps(100, 100, 0, 5000), 0);
  assert.equal(bytesToBps(500, 100, 0, 5000), 0);
  assert.equal(bytesToBps(0, 100, 5000, 5000), 0);
});

test("formatBps and meter stay empty until a real sample", () => {
  assert.equal(formatBps(null), "—");
  assert.equal(formatBps(0), "0 bps");
  assert.equal(formatBps(850), "850 bps");
  assert.equal(formatBps(12_400), "12.4 kbps");
  assert.equal(formatBps(2_000_000), "2.00 Mbps");
  assert.equal(meterPercent(null, 10), 0);
  assert.equal(meterPercent(5_000_000, 10), 50);
  assert.equal(meterPercent(40_000_000, 10), 100);
  assert.equal(TRAFFIC_POLL_MS, 5000);
});

test("freshness and duration never invent live data", () => {
  assert.equal(trafficFreshness(null), "unavailable");
  assert.equal(trafficFreshness("not-a-date"), "unavailable");
  assert.equal(trafficFreshness(new Date().toISOString(), 30), "live");
  assert.equal(trafficFreshness(new Date(Date.now() - 10 * 60_000).toISOString(), 30), "stale");
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(65), "1m 5s");
});
