import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACS_RESERVED_PORTS,
  allocateAcsPort,
  assertAllocatablePort,
  buildAcsUrl,
  nextAcsPort,
  normalizeAcsHost,
  parsePortRange,
} from "./acs-ports.ts";
import { generateAcsCredentials } from "./acs-credentials.ts";
import { openTestDb } from "./test-db.ts";

test("port range and reserved ports reject unsafe values", () => {
  assert.deepEqual(parsePortRange(7551, 7999), { start: 7551, end: 7999 });
  assert.throws(() => parsePortRange(80, 100), /1024/);
  assert.throws(() => parsePortRange(8000, 7999), /start/);
  assert.throws(() => assertAllocatablePort(7557, { start: 7551, end: 7999 }), /reserved/);
  assert.throws(() => assertAllocatablePort(22, { start: 7551, end: 7999 }), /outside/);
  assert.ok(ACS_RESERVED_PORTS.has(7557));
  assert.equal(normalizeAcsHost("https://acs.example.com:443/path"), "acs.example.com");
  assert.equal(buildAcsUrl("10.0.0.5", 7552), "http://10.0.0.5:7552/");
});

test("automatic port allocation is unique and concurrent-safe", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_public_host', '203.0.113.10')
      on conflict (key) do update set value = '203.0.113.10'`;
    await sql`insert into tenants (id, name, slug) values
      ('ten_p1', 'One', 'one'), ('ten_p2', 'Two', 'two'), ('ten_p3', 'Three', 'three')`;
    const ports = await Promise.all([
      allocateAcsPort(sql, "ten_p1"),
      allocateAcsPort(sql, "ten_p2"),
      allocateAcsPort(sql, "ten_p3"),
    ]);
    assert.equal(new Set(ports).size, 3);
    assert.equal(await allocateAcsPort(sql, "ten_p1"), ports[0]);
    await assert.rejects(() => allocateAcsPort(sql, "ten_p2", { preferred: ports[0] }), /already assigned/);
    await assert.rejects(
      () => allocateAcsPort(sql, "ten_p1", { preferred: ports[0] + 50 }),
      /ACS_PORT_CHANGE_CONFIRM/,
    );
    const changed = await allocateAcsPort(sql, "ten_p1", { preferred: ports[0] + 50, confirmChange: true });
    assert.equal(changed, ports[0] + 50);
    const next = await nextAcsPort(sql);
    assert.ok(next >= 7551 && next <= 7999);
    const assigned = await sql<{ port: number }>`select cwmp_port as port from acs_isp_credentials where cwmp_port is not null`;
    assert.equal(assigned.some((r) => r.port === next), false);
    assert.equal(new Set(assigned.map((r) => r.port)).size, assigned.length);
  } finally {
    await close();
  }
});

test("existing tenants keep credentials when a port is backfilled", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_old', 'Old', 'oldisp')`;
    const first = await generateAcsCredentials(sql, { tenantId: "ten_old", slug: "oldisp" });
    const port = first.cwmp_port;
    await sql`update acs_isp_credentials set cwmp_port = null where tenant_id = 'ten_old'`;
    const again = await generateAcsCredentials(sql, { tenantId: "ten_old", slug: "oldisp" });
    assert.equal(again.username, first.username);
    assert.equal(again.password, first.password);
    assert.ok(again.cwmp_port);
    assert.equal(typeof again.cwmp_port, "number");
    assert.ok(port);
  } finally {
    await close();
  }
});
