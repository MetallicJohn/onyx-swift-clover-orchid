import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPermission, assertTenantMatch, hasPermission } from "./rbac.ts";

test("technician cannot manage payments or routers", () => {
  assert.equal(hasPermission("technician", "payments.manage"), false);
  assert.equal(hasPermission("technician", "routers.manage"), false);
  assert.equal(hasPermission("technician", "tickets.assigned.read"), true);
});

test("finance cannot execute router commands", () => {
  assert.equal(hasPermission("finance", "routers.manage"), false);
  assert.equal(hasPermission("finance", "payments.manage"), true);
});

test("network engineer cannot reconcile payments", () => {
  assert.equal(hasPermission("network_engineer", "payments.manage"), false);
  assert.equal(hasPermission("network_engineer", "routers.manage"), true);
});

test("assertPermission throws Forbidden", () => {
  assert.throws(() => assertPermission("technician", "payments.manage"), /Forbidden/);
});

test("tenant A cannot match tenant B", () => {
  assert.throws(() => assertTenantMatch("ten_a", "ten_b"), /Not found/);
  assert.doesNotThrow(() => assertTenantMatch("ten_a", "ten_a"));
});

test("finance can reconcile paybill hits; customer care cannot", () => {
  assert.equal(hasPermission("finance", "payments.reconcile"), true);
  assert.equal(hasPermission("customer_care", "payments.reconcile"), false);
  assert.equal(hasPermission("customer_care", "payments.read"), true);
});

test("only owners and admins can change settings including appearance", () => {
  assert.equal(hasPermission("isp_owner", "settings.manage"), true);
  assert.equal(hasPermission("isp_admin", "settings.manage"), true);
  assert.equal(hasPermission("finance", "settings.manage"), false);
  assert.equal(hasPermission("technician", "settings.manage"), false);
});
