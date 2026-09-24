import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedLoginNext, loginDestination, loginModeFromSearch, normalizeLoginEmail, signInErrorMessage } from "./login-next.ts";

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

test("login emails are trimmed and lowercased", () => {
  assert.equal(normalizeLoginEmail("  Jane@ISP.co.ke "), "jane@isp.co.ke");
});

test("platform bootstrap username lands on SaaS management", () => {
  assert.equal(loginDestination("", "in", "superadmin"), "/platform");
  assert.equal(normalizeLoginEmail("superadmin"), "superadmin@ispsolutions.internal");
});

test("sign-in errors tell operators to use the public HTTPS URL", () => {
  assert.match(signInErrorMessage(new Error("Invalid origin")), /HTTPS/);
  assert.equal(signInErrorMessage(new Error("Invalid email or password")), "Invalid username or password");
  assert.equal(signInErrorMessage(new Error("Invalid username or password")), "Invalid username or password");
  assert.match(signInErrorMessage(new Error("Too many requests")), /Wait a minute/);
  assert.match(signInErrorMessage(new Error("Too many sign-in attempts")), /Wait a minute/);
});
