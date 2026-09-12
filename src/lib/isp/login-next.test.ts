import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedLoginNext, loginDestination, loginModeFromSearch } from "./login-next.ts";

test("signup always lands in the ISP console", () => {
  assert.equal(loginModeFromSearch("?mode=up"), "up");
  assert.equal(loginDestination("?mode=up&next=/platform", "up"), "/app");
});

test("superadmin login may continue to /platform only", () => {
  assert.equal(loginDestination("?next=/platform", "in"), "/platform");
  assert.equal(loginDestination("?next=/superadmin", "in"), "/platform");
  assert.equal(loginDestination("?next=/platform/tenants", "in"), "/app");
  assert.equal(loginDestination("?next=https://evil.example", "in"), "/app");
  assert.equal(loginDestination("?next=//evil.example", "in"), "/app");
  assert.equal(loginDestination("", "in"), "/app");
  assert.equal(isAllowedLoginNext("/platform"), true);
  assert.equal(isAllowedLoginNext("/superadmin"), true);
  assert.equal(isAllowedLoginNext("/app"), true);
  assert.equal(isAllowedLoginNext("/login"), false);
});
