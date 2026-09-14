import assert from "node:assert/strict";
import { test } from "node:test";
import { customerTraffic } from "./customer-lifecycle.ts";
import { resetRedisForTests } from "./redis.ts";
import { openTestDb } from "./test-db.ts";
import {
  collectTrafficSnapshot,
  collectionBucket,
  latestSamplesForUsernames,
} from "./traffic-collector.ts";

test("collector snapshots RADIUS sessions once per interval bucket", async () => {
  resetRedisForTests();
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_tr', 'Fibre', 'fibre')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_tr', 'ten_tr', 'Amina', '0700000001')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_tr', 'ten_tr', 'Home 10', 'pppoe', 10, 10, 2500)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_tr', 'ten_tr', 'cus_tr', 'pkg_tr', 'pppoe', 'amina', 'active')`;
    await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
      values ('ses_tr', 'ten_tr', 'amina', '10.10.10.8', '10.200.0.2', 100, 400)`;

    const first = await collectTrafficSnapshot(sql, { collectorId: "edge-1", now: collectionBucket() });
    const second = await collectTrafficSnapshot(sql, { collectorId: "edge-1", now: collectionBucket() });
    assert.equal(first.inserted, 1);
    assert.equal(second.inserted, 0);
    assert.ok(second.duplicates >= 1);

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
  } finally {
    await close();
  }
});
