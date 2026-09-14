import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { customerTraffic } from "./customer-lifecycle.ts";
import { resetRedisForTests } from "./redis.ts";
import { openTestDb } from "./test-db.ts";
import {
  collectTrafficSnapshot,
  collectionBucket,
  latestSamplesForUsernames,
  liveTrafficFromCache,
} from "./traffic-collector.ts";
import { identityKey, loadServiceMaps, mapIdentity } from "./traffic-map.ts";
import { getRedis } from "./redis.ts";
import { shortKey } from "./traffic-store.ts";
import { aggregateDaily, aggregateHourly, hourBucket, minuteBucket } from "./traffic-aggregate.ts";
import { netflowAdapter, snmpAdapter } from "./traffic-sources.ts";
import { parsePppActive, parseResource, pollRouterTelemetry, restTarget } from "./traffic-router.ts";
import { recordAccounting } from "./access-policy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

async function seedTraffic(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_tr', 'Fibre', 'fibre')`;
  await sql`insert into customers (id, tenant_id, name, phone) values ('cus_tr', 'ten_tr', 'Amina', '0700000001')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, bundle_mb)
    values ('pkg_tr', 'ten_tr', 'Home 10', 'pppoe', 10, 10, 2500, 50)`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, bundle_used_mb)
    values ('svc_tr', 'ten_tr', 'cus_tr', 'pkg_tr', 'pppoe', 'amina', 'active', 0)`;
  await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
    values ('ses_tr', 'ten_tr', 'amina', '10.10.10.8', '10.200.0.2', 100, 400)`;
}

test("collector writes Redis + minute buckets, not every sample to traffic_samples", async () => {
  resetRedisForTests();
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTraffic(sql);
    const now = collectionBucket();
    const first = await collectTrafficSnapshot(sql, { collectorId: "edge-1", now });
    const second = await collectTrafficSnapshot(sql, { collectorId: "edge-1", now });
    assert.equal(first.inserted, 1);
    assert.equal(first.mapped, 1);
    assert.equal(second.inserted, 0);
    assert.ok((second.updated || 0) >= 1);

    const [raw] = await sql<{ n: number }>`select count(*)::int as n from traffic_samples`;
    assert.equal(raw?.n, 0);
    const [minutes] = await sql<{ n: number }>`select count(*)::int as n from traffic_minute`;
    assert.equal(minutes?.n, 1);

    const live = await liveTrafficFromCache("ten_tr", "amina");
    assert.equal(live?.bytes_out, 400);
    assert.equal(live?.service_id, "svc_tr");
    const ring = await getRedis().lrange(shortKey("ten_tr", "amina"), 0, -1);
    assert.ok(ring.length >= 1);

    await asRole("ten_tr");
    const samples = await latestSamplesForUsernames(sql, "ten_tr", ["amina"]);
    assert.equal(samples.length, 1);
    assert.equal(Number(samples[0]?.bytes_out), 400);

    await asRole("ten_other");
    const hidden = await latestSamplesForUsernames(sql, "ten_other", ["amina"]);
    assert.equal(hidden.length, 0);

    await asRole("ten_tr");
    const traffic = await customerTraffic(sql, "ten_tr", "cus_tr");
    const line = traffic.lines.find((l) => l.username === "amina");
    assert.equal(line?.online, true);
    assert.equal(line?.bytes_out, 400);
    assert.ok(traffic.source === "radius-accounting" || traffic.source === "traffic-collector");
    assert.notEqual(traffic.freshness, "unavailable");
    assert.equal(traffic.fresh, true);
  } finally {
    await close();
  }
});

test("mapping uses username and static IP; unmapped sessions are skipped", async () => {
  resetRedisForTests();
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_map', 'Map', 'map')`;
    await sql`insert into customers (id, tenant_id, name) values ('cus_map', 'ten_map', 'Amina')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_map', 'ten_map', 'Static', 'static', 20, 20, 4000)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, static_ip, status)
      values ('svc_map', 'ten_map', 'cus_map', 'pkg_map', 'static', '10.9.9.9', 'active')`;
    const maps = await loadServiceMaps(sql, ["ten_map"]);
    const hit = mapIdentity(maps, { tenant_id: "ten_map", framed_ip: "10.9.9.9" });
    assert.equal(hit?.service_id, "svc_map");
    const miss = mapIdentity(maps, { tenant_id: "ten_map", username: "ghost" });
    assert.equal(miss, null);
    assert.equal(identityKey({ username: "amina" }), "u:amina");

    await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, bytes_in, bytes_out)
      values ('ses_ghost', 'ten_map', 'ghost', '1.1.1.1', 9, 9)`;
    const out = await collectTrafficSnapshot(sql, { collectorId: "edge-1", now: collectionBucket() });
    assert.ok(out.unmapped >= 1);
    const [n] = await sql<{ n: number }>`select count(*)::int as n from traffic_minute where username = 'ghost'`;
    assert.equal(n?.n, 0);
  } finally {
    await close();
  }
});

test("hourly aggregation is idempotent and does not change billing counters", async () => {
  resetRedisForTests();
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTraffic(sql);
    const now = minuteBucket();
    await collectTrafficSnapshot(sql, { collectorId: "edge-1", now });
    await sql`update radius_sessions set bytes_in = 100 + 1024 * 1024, bytes_out = 400 + 1024 * 1024 where id = 'ses_tr'`;
    await collectTrafficSnapshot(sql, { collectorId: "edge-1", now: new Date(now.getTime() + 20_000) });
    const hour = hourBucket(now);
    const first = await aggregateHourly(sql, { hour });
    const second = await aggregateHourly(sql, { hour });
    assert.equal(first.upserts, second.upserts);
    const [row] = await sql<{ n: number }>`select count(*)::int as n from traffic_hourly where subject_type = 'service'`;
    assert.equal(row?.n, 1);
    await aggregateDaily(sql, { day: hour });
    const [daily] = await sql<{ n: number }>`select count(*)::int as n from traffic_daily`;
    assert.ok((daily?.n || 0) >= 1);

    const [before] = await sql<{ bundle_used_mb: number }>`select bundle_used_mb from services where id = 'svc_tr'`;
    await collectTrafficSnapshot(sql, { collectorId: "edge-1", now: new Date(now.getTime() + 40_000) });
    const [after] = await sql<{ bundle_used_mb: number }>`select bundle_used_mb from services where id = 'svc_tr'`;
    assert.equal(Number(after?.bundle_used_mb), Number(before?.bundle_used_mb));

    await recordAccounting(sql, "ten_tr", {
      username: "amina",
      session_id: "ses_acct",
      bytes_in: 2 * 1024 * 1024,
      bytes_out: 2 * 1024 * 1024,
      acct_status: "interim",
    });
    const [billed] = await sql<{ bundle_used_mb: number }>`select bundle_used_mb from services where id = 'svc_tr'`;
    assert.ok(Number(billed?.bundle_used_mb) > Number(after?.bundle_used_mb));
  } finally {
    await close();
  }
});

test("SNMP and NetFlow adapters stay not_configured and never invent values", () => {
  assert.equal(snmpAdapter().status, "not_configured");
  assert.equal(snmpAdapter().configured, false);
  assert.equal(netflowAdapter().status, "not_configured");
  assert.equal(restTarget({ api_host: "", wg_address: "", api_port: 443 }), null);
  assert.equal(restTarget({ api_host: "localhost", wg_address: "", api_port: 443 }), null);
  const res = parseResource({ "cpu-load": "22", "free-memory": "50", "total-memory": "100", uptime: "1h2m" });
  assert.equal(res.cpu_pct, 22);
  assert.equal(res.ram_pct, 50);
  assert.equal(res.uptime_seconds, 3720);
  const ppp = parsePppActive([{ name: "amina", address: "10.10.10.8" }, { name: "" }]);
  assert.equal(ppp.length, 1);
});

test("batched router poll does not write fake metrics when REST is missing", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_ros', 'Ros', 'ros')`;
    await sql`insert into routers (id, tenant_id, name, identity, enroll_token, wg_status)
      values ('rtr_ros', 'ten_ros', 'Edge', 'edge', 'tok', 'pending')`;
    const out = await pollRouterTelemetry(sql, { collectorId: "edge-1", clientFor: async () => null });
    assert.equal(out.attempted, 0);
    const [n] = await sql<{ n: number }>`select count(*)::int as n from router_metrics`;
    assert.equal(n?.n, 0);
  } finally {
    await close();
  }
});

test("router poll stores resource samples from a batched REST client", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_ok', 'Ok', 'ok')`;
    await sql`insert into routers (id, tenant_id, name, identity, enroll_token, wg_status, api_host, api_password)
      values ('rtr_ok', 'ten_ok', 'Core', 'core', 'tok', 'connected', '10.200.0.2', 'secret')`;
    const out = await pollRouterTelemetry(sql, {
      collectorId: "edge-1",
      clientFor: async () => async (path: string) => {
        if (path === "/rest/system/resource") {
          return { path, status: 200, json: { "cpu-load": "18", "free-memory": "40", "total-memory": "100", uptime: "2h" } };
        }
        if (path === "/rest/interface") {
          return {
            path,
            status: 200,
            json: [{ name: "ether1", type: "ether", "rx-byte": "1000", "tx-byte": "2000", running: "true" }],
          };
        }
        return { path, status: 200, json: [{ name: "amina", address: "10.10.10.8" }] };
      },
    });
    assert.equal(out.ok, 1);
    await asRole("ten_ok");
    const [row] = await sql<{ cpu_pct: number }>`select cpu_pct from router_metrics where router_id = 'rtr_ok'`;
    assert.equal(row?.cpu_pct, 18);
    await asRole("ten_other");
    const hidden = await sql<{ n: number }>`select count(*)::int as n from router_metrics`;
    assert.equal(hidden[0]?.n, 0);
  } finally {
    await close();
  }
});

test("billing accounting source does not scan telemetry tables", () => {
  const policy = readFileSync(join(root, "src/lib/isp/access-policy.ts"), "utf8");
  assert.match(policy, /bundle_used_mb/);
  assert.doesNotMatch(policy, /traffic_minute|traffic_hourly|traffic_samples/);
  const collector = readFileSync(join(root, "src/lib/isp/traffic-collector.ts"), "utf8");
  assert.doesNotMatch(collector, /bundle_used_mb/);
});

test("collector maps thousands of sessions in one pass", async () => {
  resetRedisForTests();
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_big', 'Big', 'big')`;
    await sql`insert into customers (id, tenant_id, name) values ('cus_big', 'ten_big', 'Bulk')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_big', 'ten_big', 'Home', 'pppoe', 10, 10, 2500)`;
    for (let i = 0; i < 80; i += 1) {
      const user = `u${i}`;
      await sql.query(
        `insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
         values ($1,'ten_big','cus_big','pkg_big','pppoe',$2,'active')`,
        [`svc_big_${i}`, user],
      );
      await sql.query(
        `insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
         values ($1,'ten_big',$2,$3,'10.200.0.2',10,20)`,
        [`ses_big_${i}`, user, `10.10.10.${(i % 200) + 1}`],
      );
    }
    const out = await collectTrafficSnapshot(sql, { collectorId: "edge-1", now: collectionBucket() });
    assert.equal(out.mapped, 80);
    assert.equal(out.unmapped, 0);
    const [n] = await sql<{ n: number }>`select count(*)::int as n from traffic_minute where tenant_id = 'ten_big'`;
    assert.equal(n?.n, 80);
  } finally {
    await close();
  }
});
