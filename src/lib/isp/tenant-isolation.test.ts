import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertTenantMatch } from "./rbac.ts";

test("queries are tenant-scoped in core list handlers", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const routers = readFileSync(new URL("./router-provisioning.ts", import.meta.url), "utf8");
  assert.match(server, /from customers where tenant_id = \$\{/);
  assert.match(server, /from invoices where .*tenant_id/);
  assert.match(routers, /from routers where tenant_id = \$\{tenantId\}/);
});

test("active tenant is membership-validated", () => {
  const src = readFileSync(new URL("./tenant-context.ts", import.meta.url), "utf8");
  assert.match(src, /Not a member of that workspace/);
  assert.doesNotMatch(src, /order by created_at asc\s+limit 1/i);
});

test("cross-tenant resource access is denied", () => {
  assert.throws(() => assertTenantMatch("tenant-a", "tenant-b"), /Not found/);
});

test("platform console never accepts a client tenant without an admin check", () => {
  const src = readFileSync(new URL("./server-platform.ts", import.meta.url), "utf8");
  assert.match(src, /requirePlatformActor/);
  assert.match(src, /applyRls\(sql, \{ bypass: true \}\)/);
  assert.doesNotMatch(src, /requireTenant\(/);
});

test("Postgres requests pin one client so RLS GUCs cannot leak across the pool", () => {
  const db = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
  const start = readFileSync(new URL("../../start.ts", import.meta.url), "utf8");
  const rls = readFileSync(new URL("./rls.ts", import.meta.url), "utf8");
  const jobs = readFileSync(new URL("./jobs.ts", import.meta.url), "utf8");
  assert.match(db, /withDbSession/);
  assert.match(db, /pool\.connect\(/);
  assert.doesNotMatch(db, /pool\.query\(/);
  assert.match(start, /requestMiddleware/);
  assert.match(start, /withDbSession/);
  assert.match(rls, /set_config\('app.tenant_id'/);
  assert.match(rls, /set_config\('app.bypass_rls'/);
  assert.match(jobs, /withDbSession\(\(\) => processQueuedJobsOnSession/);
});
