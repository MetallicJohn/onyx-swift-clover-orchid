import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enrollEndpointHost,
  isApexHttpsHost,
  normalizeWgPublicHost,
  publicWgHost,
  publicWgPort,
} from "./wg-endpoint.ts";

test("apex HTTPS hosts are never WireGuard endpoints", () => {
  assert.equal(normalizeWgPublicHost("ispsolutions.co.ke"), "wg.ispsolutions.co.ke");
  assert.equal(normalizeWgPublicHost("https://www.ispsolutions.co.ke"), "wg.ispsolutions.co.ke");
  assert.equal(isApexHttpsHost("ispsolutions.co.ke"), true);
  assert.equal(isApexHttpsHost("wg.ispsolutions.co.ke"), false);
});

test("production default endpoint is wg.ispsolutions.co.ke; IPs are replaced when a hostname exists", () => {
  assert.equal(publicWgHost({ NODE_ENV: "production", DATABASE_URL: "postgres://x" }), "wg.ispsolutions.co.ke");
  assert.equal(publicWgPort({}), 51820);
  assert.equal(
    enrollEndpointHost("185.185.126.169", { WIREGUARD_PUBLIC_HOST: "wg.ispsolutions.co.ke" }),
    "wg.ispsolutions.co.ke",
  );
  assert.equal(
    enrollEndpointHost("vpn.imani.ke", { WIREGUARD_PUBLIC_HOST: "wg.ispsolutions.co.ke" }),
    "vpn.imani.ke",
  );
});

test("preview does not invent a production WireGuard hostname", () => {
  assert.equal(publicWgHost({ NODE_ENV: "development" }), "");
});
