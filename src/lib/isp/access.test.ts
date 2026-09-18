import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { provisionServiceAccess, seedOpsForTenant } from "./access.ts";
import { openTestDb } from "./test-db.ts";

test("tenant seed does not re-queue agent commands for existing services", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_seed', 'Seed', 'seed')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_seed', 'ten_seed', 'Amina', '0712001001')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_seed', 'ten_seed', 'Home 10', 'pppoe', 10, 10, 2500)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_seed', 'ten_seed', 'cus_seed', 'pkg_seed', 'pppoe', 'amina', 'active')`;
    await sql`insert into routers (id, tenant_id, name) values ('rtr_seed', 'ten_seed', 'edge-01')`;

    await seedOpsForTenant(sql, "ten_seed");
    const [before] = await sql<{ n: number }>`select count(*)::int as n from agent_commands where tenant_id = 'ten_seed'`;
    assert.equal(before?.n, 0);

    await provisionServiceAccess(sql, "ten_seed", "svc_seed");
    const [queued] = await sql<{ n: number }>`select count(*)::int as n from agent_commands where tenant_id = 'ten_seed'`;
    assert.ok((queued?.n ?? 0) >= 1, "real service change still queues the agent");

    await seedOpsForTenant(sql, "ten_seed");
    await seedOpsForTenant(sql, "ten_seed");
    const [after] = await sql<{ n: number }>`select count(*)::int as n from agent_commands where tenant_id = 'ten_seed'`;
    assert.equal(after?.n, queued?.n);

    const [providers] = await sql<{ n: number }>`select count(*)::int as n from payment_providers where tenant_id = 'ten_seed'`;
    assert.equal(providers?.n, 4);
  } finally {
    await close();
  }
});

test("routers desk paints the list without waiting on queue, hub, or first-router detail", () => {
  const access = readFileSync(new URL("./access.ts", import.meta.url), "utf8");
  const seed = access.slice(access.indexOf("export async function seedOpsForTenant"));
  assert.doesNotMatch(seed, /provisionServiceAccess/);

  const page = readFileSync(new URL("../../routes/app/routers.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../../components/isp/router-desk-ui.tsx", import.meta.url), "utf8");
  assert.match(ui, /Loading routers/);
  assert.match(page, /queryRoutersDeskFn/);
  assert.doesNotMatch(page, /getWireGuardHub/);
  assert.doesNotMatch(page, /listAgentQueue/);
  assert.doesNotMatch(page, /getRouterDetailFn/);
  assert.doesNotMatch(page, /RouterMonitor/);
});
