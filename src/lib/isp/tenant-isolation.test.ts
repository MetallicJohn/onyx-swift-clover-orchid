import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertTenantMatch } from "./rbac.ts";

test("queries are tenant-scoped in core list handlers", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(server, /from customers where tenant_id = \$\{/);
  assert.match(server, /from invoices where .*tenant_id/);
  assert.match(server, /from routers where tenant_id = \$\{workspace.tenantId\}/);
});

test("active tenant is membership-validated", () => {
  const src = readFileSync(new URL("./tenant-context.ts", import.meta.url), "utf8");
  assert.match(src, /Not a member of that workspace/);
  assert.doesNotMatch(src, /order by created_at asc\s+limit 1/i);
});

test("cross-tenant resource access is denied", () => {
  assert.throws(() => assertTenantMatch("tenant-a", "tenant-b"), /Not found/);
});
