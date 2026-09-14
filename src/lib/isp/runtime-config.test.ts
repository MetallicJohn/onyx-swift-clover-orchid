import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConfigError,
  assertNotLoopbackHost,
  loadServiceConfig,
  parseDatabaseSslMode,
  parseHttpUrl,
  parseIntEnv,
  postgresPoolOptions,
} from "./runtime-config.ts";

test("production rejects missing secret and localhost endpoints", () => {
  assert.throws(
    () => loadServiceConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ConfigError,
  );
  assert.throws(
    () =>
      loadServiceConfig({
        NODE_ENV: "production",
        APP_SECRET: "x".repeat(32),
        GENIEACS_NBI_URL: "http://localhost:7557",
      } as NodeJS.ProcessEnv),
    /localhost/,
  );
  assert.throws(
    () =>
      loadServiceConfig({
        NODE_ENV: "production",
        APP_SECRET: "x".repeat(32),
        REDIS_URL: "redis://127.0.0.1:6379",
      } as NodeJS.ProcessEnv),
    /localhost/,
  );
  assert.throws(() => assertNotLoopbackHost("http://127.0.0.1:6379", "REDIS", true), ConfigError);
});

test("preview allows empty endpoints and never invents docker DNS", () => {
  const cfg = loadServiceConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
  assert.equal(cfg.env, "preview");
  assert.equal(cfg.genieacsNbiUrl, "");
  assert.equal(cfg.redisUrl, "");
  assert.equal(cfg.radiusHost, "");
  assert.equal(cfg.internalUrl, "");
});

test("remote URLs and pool options are accepted", () => {
  const cfg = loadServiceConfig({
    NODE_ENV: "production",
    APP_SECRET: "secret-secret-secret-secret-1234",
    DATABASE_URL: "postgres://ispsolutions:x@10.200.0.20:5432/ispsolutions",
    DATABASE_POOL_MAX: "20",
    DATABASE_SSL_MODE: "require",
    GENIEACS_NBI_URL: "http://10.200.0.30:7557",
    REDIS_URL: "redis://:pass@10.200.0.10:6379/0",
    RADIUS_HOST: "10.200.0.30",
    ISPSOLUTIONS_INTERNAL_URL: "http://10.200.0.10:3000",
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.genieacsNbiUrl, "http://10.200.0.30:7557");
  assert.equal(cfg.radiusHost, "10.200.0.30");
  assert.equal(cfg.databasePoolMax, 20);
  const pool = postgresPoolOptions(cfg);
  assert.equal(pool.max, 20);
  assert.equal(pool.ssl?.rejectUnauthorized, false);
  assert.equal(parseDatabaseSslMode("verify-full"), "verify-full");
  assert.equal(parseDatabaseSslMode("disable"), "disable");
  assert.equal(parseIntEnv("4", 2, 1, 8), 4);
  assert.equal(parseHttpUrl("https://ops.example/", "APP_URL"), "https://ops.example");
});
