import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearTenantOriginCache,
  expandOriginVariants,
  extraOriginsFromEnv,
  hostnameOf,
  originOf,
  requestPublicOrigin,
  resolveAuthTrustedOrigins,
  sameOriginFromRequest,
  tenantPublicOrigins,
} from "./auth-origins.ts";

test("originOf normalizes hosts, URLs, and rejects junk", () => {
  assert.equal(originOf("https://ops.imani.ke/app"), "https://ops.imani.ke");
  assert.equal(originOf("ops.imani.ke"), "https://ops.imani.ke");
  assert.equal(originOf("http://localhost:8080"), "http://localhost:8080");
  assert.equal(originOf("null"), null);
  assert.equal(originOf(""), null);
  assert.equal(originOf("ftp://files.imani.ke"), null);
});

test("hostnameOf strips ports and forwarded lists", () => {
  assert.equal(hostnameOf("ops.imani.ke:443"), "ops.imani.ke");
  assert.equal(hostnameOf("ops.imani.ke, backend.internal"), "ops.imani.ke");
  assert.equal(hostnameOf("[::1]:8080"), "::1");
});

test("www and apex are both trusted for a saved public URL", () => {
  assert.deepEqual(expandOriginVariants("https://ops.imani.ke").sort(), [
    "https://ops.imani.ke",
    "https://www.ops.imani.ke",
  ]);
  assert.deepEqual(expandOriginVariants("https://www.ops.imani.ke").sort(), [
    "https://ops.imani.ke",
    "https://www.ops.imani.ke",
  ]);
});

test("same-origin custom domain is trusted; cross-site CSRF is not", () => {
  const custom = new Request("https://ops.imani.ke/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      origin: "https://ops.imani.ke",
      host: "ops.imani.ke",
    },
  });
  assert.ok(sameOriginFromRequest(custom).includes("https://ops.imani.ke"));

  const proxied = new Request("http://127.0.0.1:8080/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      origin: "https://ops.imani.ke",
      host: "127.0.0.1:8080",
      "x-forwarded-host": "ops.imani.ke",
      "x-forwarded-proto": "https",
    },
  });
  assert.ok(sameOriginFromRequest(proxied).includes("https://ops.imani.ke"));

  const csrf = new Request("https://ops.imani.ke/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      host: "ops.imani.ke",
    },
  });
  assert.deepEqual(sameOriginFromRequest(csrf), []);
});

test("tenant public_base_url is trusted even when Host is the platform URL", async () => {
  const origins = await tenantPublicOrigins(async () => ["https://ops.imani.ke"]);
  assert.ok(origins.includes("https://ops.imani.ke"));
  assert.ok(origins.includes("https://www.ops.imani.ke"));
});

test("env extras include Vercel production and BETTER_AUTH_URL", () => {
  const origins = extraOriginsFromEnv({
    BETTER_AUTH_URL: "https://gridline.grok.me",
    VERCEL_PROJECT_PRODUCTION_URL: "ops.imani.ke",
    VERCEL_URL: "gridline-abc.vercel.app",
  });
  assert.ok(origins.includes("https://gridline.grok.me"));
  assert.ok(origins.includes("https://ops.imani.ke"));
  assert.ok(origins.includes("https://gridline-abc.vercel.app"));
});

test("resolveAuthTrustedOrigins unions same-origin, env, and tenant URLs", async () => {
  clearTenantOriginCache();
  const request = new Request("https://billing.northline.ke/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      origin: "https://billing.northline.ke",
      host: "billing.northline.ke",
    },
  });
  const origins = await resolveAuthTrustedOrigins(request, async () => ["https://portal.imani.ke"]);
  assert.ok(origins.includes("https://billing.northline.ke"));
  assert.ok(origins.includes("https://portal.imani.ke"));
});

test("password-reset links use the forwarded custom domain", () => {
  const request = new Request("http://127.0.0.1:8080/api/reset", {
    headers: {
      origin: "https://ops.imani.ke",
      host: "127.0.0.1:8080",
      "x-forwarded-host": "ops.imani.ke",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(requestPublicOrigin(request), "https://ops.imani.ke");
});
