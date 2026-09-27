import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateSameSite } from "../auth/same-site.ts";
import { kopoSignatureValid } from "./kopokopo.ts";
import { rateLimit, rateLimitCacheSize } from "./rate-limit.ts";
import { applySecurityHeaders } from "./security-headers.ts";

const base = {
  method: "POST",
  site: null as string | null,
  mode: null as string | null,
  dest: null as string | null,
  origin: null as string | null,
  referer: null as string | null,
  host: "ops.example",
  forwardedHost: null as string | null,
  authorization: null as string | null,
  url: "https://ops.example/app",
};

test("kopo webhook signature is the raw-body HMAC", () => {
  const body = '{"topic":"buygoods_received"}';
  const secret = "client-secret";
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  const b64 = createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(kopoSignatureValid(body, hex, secret), true);
  assert.equal(kopoSignatureValid(body, `sha256=${b64}`, secret), true);
  assert.equal(kopoSignatureValid(body, hex, "other"), false);
  assert.equal(kopoSignatureValid(body, "", secret), false);
  assert.equal(kopoSignatureValid(`${body} `, hex, secret), false);
});

test("missing Sec-Fetch-Site does not allow a cookie POST", () => {
  assert.equal(evaluateSameSite(base), "reject");
  assert.equal(evaluateSameSite({ ...base, origin: "https://evil.example" }), "reject");
  assert.equal(evaluateSameSite({ ...base, origin: "https://ops.example" }), "allow");
  assert.equal(evaluateSameSite({ ...base, referer: "https://ops.example/app/billing" }), "allow");
  assert.equal(evaluateSameSite({ ...base, authorization: "Bearer session-token" }), "allow");
  assert.equal(evaluateSameSite({ ...base, method: "GET" }), "allow");
  assert.equal(evaluateSameSite({ ...base, site: "cross-site", mode: "cors" }), "reject");
  assert.equal(
    evaluateSameSite({ ...base, method: "GET", site: "cross-site", mode: "navigate", dest: "document" }),
    "allow",
  );
});

test("idle rate-limit keys are pruned and the window still trips", async () => {
  const prefix = `gone-${Date.now()}-`;
  for (let i = 0; i < 1100; i += 1) await rateLimit(`${prefix}${i}`, 5, 0);
  assert.ok(rateLimitCacheSize() < 100);
  const key = `live-${Date.now()}`;
  assert.equal((await rateLimit(key, 2, 60_000)).ok, true);
  assert.equal((await rateLimit(key, 2, 60_000)).ok, true);
  assert.equal((await rateLimit(key, 2, 60_000)).ok, false);
});

test("responses and Caddy set security headers", () => {
  const headers = new Headers();
  applySecurityHeaders(headers);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(headers.get("Content-Security-Policy") || "", /object-src 'none'/);
  assert.equal(headers.get("X-Frame-Options"), null);
  const caddy = readFileSync(new URL("../../../deploy/vps/Caddyfile", import.meta.url), "utf8");
  assert.match(caddy, /X-Frame-Options SAMEORIGIN/);
  assert.match(caddy, /frame-ancestors 'self'/);
  assert.match(caddy, /X-Content-Type-Options nosniff/);
});
