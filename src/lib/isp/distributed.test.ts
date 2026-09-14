import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { jobHealth } from "./jobs.ts";
import { internalRadiusBaseUrl } from "./radius-rest.ts";
import { loadServiceConfig } from "./runtime-config.ts";
import { openTestDb } from "./test-db.ts";
import { collectorHealth } from "./traffic-collector.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

test("compose role files exist and single-VPS does not publish data-plane ports", () => {
  const files = [
    "deploy/vps/compose.single-vps.yml",
    "deploy/vps/compose.application.yml",
    "deploy/vps/compose.database.yml",
    "deploy/vps/compose.network-services.yml",
    "deploy/vps/compose.traffic-collector.yml",
    "deploy/vps/compose.workers.yml",
    "deploy/vps/docker-compose.yml",
    "deploy/vps/env/single-vps.env.example",
    "deploy/vps/env/application.env.example",
    "deploy/vps/env/database.env.example",
    "deploy/vps/env/network-services.env.example",
    "deploy/vps/env/workers.env.example",
    "deploy/vps/env/traffic-collector.env.example",
    "deploy/vps/worker.mjs",
    "deploy/vps/collector.mjs",
    "docs/distributed.md",
  ];
  for (const f of files) assert.equal(existsSync(join(root, f)), true, f);

  const compose = read("deploy/vps/docker-compose.yml");
  assert.match(compose, /redis:7-alpine/);
  assert.match(compose, /ROLE: worker/);
  assert.match(compose, /ROLE: collector/);
  assert.equal(compose.includes("7557:7557"), false);
  assert.equal(compose.includes("5432:5432"), false);
  assert.equal(compose.includes("6379:6379"), false);
  assert.equal(compose.includes("27017:27017"), false);

  const caddy = read("deploy/vps/Caddyfile");
  assert.match(caddy, /api\/internal/);
  const entry = read("deploy/vps/entrypoint.sh");
  assert.match(entry, /SKIP_MIGRATE/);
  assert.match(entry, /ROLE/);
});

test("application code does not fall back to docker DNS when internal URL is unset", () => {
  const prev = process.env.ISPSOLUTIONS_INTERNAL_URL;
  const prevLegacy = process.env.GRIDLINE_INTERNAL_URL;
  delete process.env.ISPSOLUTIONS_INTERNAL_URL;
  delete process.env.GRIDLINE_INTERNAL_URL;
  try {
    assert.equal(internalRadiusBaseUrl(""), "");
    assert.equal(internalRadiusBaseUrl("https://ops.example"), "https://ops.example");
  } finally {
    if (prev == null) delete process.env.ISPSOLUTIONS_INTERNAL_URL;
    else process.env.ISPSOLUTIONS_INTERNAL_URL = prev;
    if (prevLegacy == null) delete process.env.GRIDLINE_INTERNAL_URL;
    else process.env.GRIDLINE_INTERNAL_URL = prevLegacy;
  }
  const radius = read("src/lib/isp/radius-rest.ts");
  assert.doesNotMatch(radius, /return pub \|\| "http:\/\/web:3000"/);
  const acsPorts = read("src/routes/api/internal/acs-ports.ts");
  assert.doesNotMatch(acsPorts, /http:\/\/genieacs:7547/);
});

test("optional Redis and collectors are not_configured rather than false-success", async () => {
  const cfg = loadServiceConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
  assert.equal(cfg.redisUrl, "");
  assert.equal(cfg.genieacsNbiUrl, "");
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const jobs = await jobHealth(sql);
    assert.equal(jobs.queued, 0);
    assert.equal(jobs.dead, 0);
    const col = await collectorHealth(sql);
    assert.equal(col.status, "not_configured");
  } finally {
    await close();
  }
});
