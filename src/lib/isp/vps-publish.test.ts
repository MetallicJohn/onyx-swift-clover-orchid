import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { vpsInstallCommand, vpsPublishSteps, vpsUpdateCommand } from "./vps-publish.ts";

test("VPS install command clones the GitHub repo then runs the installer", () => {
  const cmd = vpsInstallCommand({
    domain: "https://ops.imani.ke/app",
    email: "ops@imani.ke",
  });
  assert.equal(
    cmd,
    "git clone https://github.com/MetallicJohn/onyx-swift-clover-orchid.git /opt/gridline && sudo bash /opt/gridline/deploy/vps/install.sh --domain ops.imani.ke --email ops@imani.ke",
  );
});

test("VPS updater pulls main and rebuilds without touching secrets", () => {
  assert.equal(vpsUpdateCommand(), "sudo bash /opt/gridline/deploy/vps/update.sh");
  const steps = vpsPublishSteps({ domain: "ops.imani.ke", email: "ops@imani.ke" });
  assert.equal(steps.updateCommand, vpsUpdateCommand());
  assert.match(steps.notes.join("\n"), /auto-publish|few minutes/);
});

test("publish pack names docker compose, health, and WireGuard", () => {
  const steps = vpsPublishSteps({ domain: "ops.imani.ke", email: "ops@imani.ke" });
  assert.equal(steps.domain, "ops.imani.ke");
  const install = readFileSync(new URL("../../../deploy/vps/install.sh", import.meta.url), "utf8");
  const update = readFileSync(new URL("../../../deploy/vps/update.sh", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../../../deploy/vps/docker-compose.yml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../../../deploy/vps/Dockerfile", import.meta.url), "utf8");
  const timer = readFileSync(new URL("../../../deploy/vps/systemd/gridline-update.timer", import.meta.url), "utf8");
  const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(install, /docker compose|update\.sh --force/);
  assert.match(install, /51820\/udp/);
  assert.match(install, /BETTER_AUTH_URL/);
  assert.match(install, /--exclude gridline\.env/);
  assert.match(update, /git reset --hard/);
  assert.match(update, /gridline-update\.timer/);
  assert.match(update, /docker compose/);
  assert.match(timer, /OnUnitActiveSec=5min/);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /drumsergio\/genieacs/);
  assert.match(compose, /mongo:7/);
  assert.match(compose, /GIT_SHA/);
  assert.match(dockerfile, /NITRO_PRESET=node-server/);
  assert.match(dockerfile, /GRIDLINE_GIT_SHA/);
  assert.match(compose, /1812:1812\/udp/);
  assert.match(dockerfile, /entrypoint\.sh/);
  assert.match(ci, /VPS_HOST/);
  assert.match(ci, /deploy\/vps\/update\.sh/);
});
