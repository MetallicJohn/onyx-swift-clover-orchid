import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertPermission,
  assertTenantMatch,
  canAccessAppPath,
  hasPermission,
  permissionForAppPath,
  ROLE_GUIDE,
  STAFF_ROLES,
} from "./rbac.ts";

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

test("support access is read-only", () => {
  assert.equal(hasPermission("support", "customers.read"), true);
  assert.equal(hasPermission("support", "customers.manage"), false);
  assert.equal(hasPermission("support", "payments.manage"), false);
  assert.equal(hasPermission("support", "routers.manage"), false);
  assert.equal(hasPermission("support", "settings.manage"), false);
  assert.equal(hasPermission("support", "radius.manage"), false);
});

test("customer care can grant grace; technician cannot", () => {
  assert.equal(hasPermission("customer_care", "services.grace.grant"), true);
  assert.equal(hasPermission("customer_care", "services.grace.extend"), true);
  assert.equal(hasPermission("customer_care", "services.grace.revoke"), true);
  assert.equal(hasPermission("finance", "services.grace.grant"), true);
  assert.equal(hasPermission("technician", "services.grace.grant"), false);
  assert.equal(hasPermission("support", "services.grace.revoke"), false);
  assert.throws(() => assertPermission("technician", "services.grace.grant"), /Forbidden/);
});

test("communications send is not implied by viewing customers", () => {
  assert.equal(hasPermission("technician", "customers.read"), true);
  assert.equal(hasPermission("technician", "communications.send"), false);
  assert.equal(hasPermission("support", "communications.view"), true);
  assert.equal(hasPermission("support", "communications.send"), false);
  assert.equal(hasPermission("customer_care", "communications.send"), true);
  assert.throws(() => assertPermission("technician", "communications.send"), /Forbidden/);
});

test("app paths follow the role, not the URL", () => {
  assert.equal(canAccessAppPath("technician", "/app"), true);
  assert.equal(canAccessAppPath("technician", "/app/tickets"), true);
  assert.equal(canAccessAppPath("technician", "/app/field"), true);
  assert.equal(canAccessAppPath("technician", "/app/customers"), true);
  assert.equal(canAccessAppPath("technician", "/app/billing"), false);
  assert.equal(canAccessAppPath("technician", "/app/settings"), false);
  assert.equal(canAccessAppPath("technician", "/app/routers"), false);
  assert.equal(canAccessAppPath("finance", "/app/billing"), true);
  assert.equal(canAccessAppPath("finance", "/app/statements"), true);
  assert.equal(canAccessAppPath("finance", "/app/radius"), false);
  assert.equal(canAccessAppPath("network_engineer", "/app/routers"), true);
  assert.equal(canAccessAppPath("network_engineer", "/app/hotspot"), true);
  assert.equal(canAccessAppPath("network_engineer", "/app/billing"), false);
  assert.equal(canAccessAppPath("customer_care", "/app/customers"), true);
  assert.equal(canAccessAppPath("customer_care", "/app/import"), true);
  assert.equal(canAccessAppPath("customer_care", "/app/settings"), false);
  assert.equal(canAccessAppPath("isp_owner", "/app/settings"), true);
  assert.equal(canAccessAppPath("support", "/app/customers"), true);
  assert.equal(canAccessAppPath("support", "/app/settings"), false);
  assert.equal(canAccessAppPath("technician", "/app/notifications"), false);
  assert.equal(permissionForAppPath("/app"), null);
});

test("staff guide covers every inviteable role and excludes support", () => {
  assert.deepEqual(
    ROLE_GUIDE.map((r) => r.role),
    ["isp_owner", "isp_admin", "finance", "customer_care", "network_engineer", "technician", "support"],
  );
  assert.equal(STAFF_ROLES.some((r) => r.role === "support"), false);
  assert.equal(STAFF_ROLES.length, 6);
});

test("sensitive list and export endpoints assert a permission", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(server, /export const exportCustomersCsv[\s\S]+?assertPermission\(workspace.role, "customers.read"\)/);
  assert.match(server, /export const renameTenant[\s\S]+?assertPermission\(workspace.role, "settings.manage"\)/);
  const more = readFileSync(new URL("./server-more.ts", import.meta.url), "utf8");
  assert.match(more, /export const listTicketStaff[\s\S]+?assertPermission\(role, "tickets.read"\)/);
  assert.match(more, /export const getReports[\s\S]+?assertPermission\(role, "invoices.read"\)/);
  const ops = readFileSync(new URL("./server-ops.ts", import.meta.url), "utf8");
  assert.match(ops, /export const listRadius[\s\S]+?assertPermission\(role, "radius.manage"\)/);
  assert.match(ops, /export const listHotspot[\s\S]+?assertPermission\(role, "radius.manage"\)/);
  assert.match(ops, /export const listField[\s\S]+?assertPermission\(role, "jobs.update"\)/);
  assert.match(ops, /export const getMessaging[\s\S]+?assertPermission\(role, "settings.manage"\)/);
  const mpesa = readFileSync(new URL("./server-mpesa.ts", import.meta.url), "utf8");
  assert.match(mpesa, /export const getMpesa[\s\S]+?assertPermission\(role, "settings.manage"\)/);
  const mikrotik = readFileSync(new URL("./server-mikrotik.ts", import.meta.url), "utf8");
  assert.match(mikrotik, /export const getRouterApi[\s\S]+?assertPermission\(role, "routers.manage"\)/);
});
