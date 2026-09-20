import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDb } from "./test-db.ts";

const TABLES = ["router_enrollments", "router_credentials", "router_health_snapshots"] as const;

test("router management-plane tables have FORCE RLS and cannot leak across tenants", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const policies = await sql<{ tablename: string; enabled: boolean; forced: boolean }>`
      select c.relname as tablename, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in (${TABLES[0]}, ${TABLES[1]}, ${TABLES[2]})`;
    assert.equal(policies.length, 3);
    for (const row of policies) {
      assert.equal(row.enabled, true, row.tablename);
      assert.equal(row.forced, true, row.tablename);
    }

    await sql`insert into tenants (id, name, slug) values ('ten_ra', 'Alpha Net', 'alpha-net'), ('ten_rb', 'Beta Net', 'beta-net')`;
    await sql`insert into routers (id, tenant_id, name) values ('rtr_a', 'ten_ra', 'A'), ('rtr_b', 'ten_rb', 'B')`;
    await sql`insert into router_credentials (id, tenant_id, router_id, kind, secret_sealed)
      values ('cred_a', 'ten_ra', 'rtr_a', 'api', 'sealed-a'), ('cred_b', 'ten_rb', 'rtr_b', 'api', 'sealed-b')`;
    await sql`insert into router_enrollments (id, tenant_id, router_id, state)
      values ('enr_a', 'ten_ra', 'rtr_a', 'ACTIVE'), ('enr_b', 'ten_rb', 'rtr_b', 'ACTIVE')`;
    await sql`insert into router_health_snapshots (id, tenant_id, router_id, api)
      values ('hlt_a', 'ten_ra', 'rtr_a', 'ok'), ('hlt_b', 'ten_rb', 'rtr_b', 'ok')`;

    await asRole("ten_ra");
    assert.deepEqual(
      (await sql<{ id: string }>`select id from router_credentials order by id`).map((r) => r.id),
      ["cred_a"],
    );
    assert.equal((await sql<{ id: string }>`select id from router_credentials where tenant_id = ${"ten_rb"}`).length, 0);
    assert.deepEqual(
      (await sql<{ id: string }>`select id from router_enrollments order by id`).map((r) => r.id),
      ["enr_a"],
    );
    assert.deepEqual(
      (await sql<{ id: string }>`select id from router_health_snapshots order by id`).map((r) => r.id),
      ["hlt_a"],
    );

    await asRole("ten_rb");
    assert.deepEqual(
      (await sql<{ id: string }>`select id from router_credentials order by id`).map((r) => r.id),
      ["cred_b"],
    );
  } finally {
    await close();
  }
});
