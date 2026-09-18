import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { APP_NAME, APP_SLUG } from "../brand.ts";
import { vpsInstallCommand, vpsPublishSteps, vpsUpdateCommand } from "./vps-publish.ts";

test("operator-facing product name is ISP Solutions", () => {
  assert.equal(APP_NAME, "ISP Solutions");
  assert.equal(APP_SLUG, "ispsolutions");
  const login = readFileSync(new URL("../../routes/login.tsx", import.meta.url), "utf8");
  const root = readFileSync(new URL("../../routes/__root.tsx", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../../../migrations/0002_isp.sql", import.meta.url), "utf8");
  const radius = readFileSync(new URL("../../../migrations/0016_radius_freeradius.sql", import.meta.url), "utf8");
  assert.match(login, /APP_NAME/);
  assert.doesNotMatch(login, /Gridline/);
  assert.doesNotMatch(root, /Gridline/);
  assert.match(schema, /ISP Solutions/);
  assert.doesNotMatch(schema, /Gridline/);
  assert.match(radius, /ISP Solutions/);
  assert.doesNotMatch(radius, /Gridline/);
});

test("VPS install command clones the GitHub repo then runs the installer", () => {
  const cmd = vpsInstallCommand({
    domain: "https://ops.imani.ke/app",
    email: "ops@imani.ke",
  });
  assert.equal(
    cmd,
    "git clone https://github.com/MetallicJohn/onyx-swift-clover-orchid.git /opt/ispsolutions && sudo bash /opt/ispsolutions/deploy/vps/install.sh --domain ops.imani.ke --email ops@imani.ke",
  );
});

test("VPS updater pulls main and rebuilds without touching secrets", () => {
  assert.equal(vpsUpdateCommand(), "sudo bash /opt/ispsolutions/deploy/vps/update.sh");
  const steps = vpsPublishSteps({ domain: "ops.imani.ke", email: "ops@imani.ke" });
  assert.equal(steps.updateCommand, vpsUpdateCommand());
  assert.match(steps.notes.join("\n"), /--apply/);
  assert.match(steps.notes.join("\n"), /green CI|untested branch|AUTO_DEPLOY/);
});

test("publish pack names docker compose, health, and WireGuard", () => {
  const steps = vpsPublishSteps({ domain: "ops.imani.ke", email: "ops@imani.ke" });
  assert.equal(steps.domain, "ops.imani.ke");
  const install = readFileSync(new URL("../../../deploy/vps/install.sh", import.meta.url), "utf8");
  const update = readFileSync(new URL("../../../deploy/vps/update.sh", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../../../deploy/vps/docker-compose.yml", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../../../deploy/vps/Dockerfile", import.meta.url), "utf8");
  const timer = readFileSync(new URL("../../../deploy/vps/systemd/ispsolutions-update.timer", import.meta.url), "utf8");
  const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(install, /docker compose|update\.sh --force/);
  assert.match(install, /51820\/udp/);
  assert.match(install, /BETTER_AUTH_URL/);
  assert.match(install, /--exclude ispsolutions\.env/);
  assert.match(update, /git reset --hard/);
  assert.match(update, /ispsolutions-update\.timer/);
  assert.match(update, /backup\.sh/);
  assert.match(update, /healthcheck/);
  assert.match(update, /rolling back/);
  assert.match(update, /--from-ci|--apply/);
  assert.match(update, /ISPSOLUTIONS_AUTO_DEPLOY/);
  assert.match(update, /docker compose/);
  assert.match(timer, /OnUnitActiveSec=5min/);
  assert.match(timer, /AUTO_DEPLOY/);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /drumsergio\/genieacs/);
  assert.match(compose, /cwmp-edge/);
  assert.match(compose, /7551-7999:7551-7999/);
  assert.match(compose, /GENIEACS_EXT_DIR/);
  assert.match(compose, /genieacs-init/);
  assert.match(compose, /ACS_TLS_CERT/);
  assert.equal(compose.includes("7557:7557"), false);
  assert.equal(compose.includes("7547:7547"), false);
  const edge = readFileSync(new URL("../../../deploy/vps/cwmp-edge.mjs", import.meta.url), "utf8");
  assert.match(edge, /tls\.createServer/);
  const ext = readFileSync(new URL("../../../deploy/vps/genieacs/ext/ispsolutions.js", import.meta.url), "utf8");
  assert.match(ext, /passwordFor/);
  assert.match(ext, /serviceFor/);
  assert.match(ext, /acs-auth/);
  const init = readFileSync(new URL("../../../deploy/vps/genieacs/init-config.js", import.meta.url), "utf8");
  assert.match(init, /cwmp\.auth/);
  assert.match(init, /connectionRequestAuth/);
  assert.match(install, /7551:7999\/tcp/);
  assert.match(install, /ACS_EDGE_TOKEN/);
  assert.match(compose, /mongo:7/);
  assert.match(compose, /GIT_SHA/);
  assert.match(compose, /redis:7-alpine/);
  assert.match(compose, /ROLE: worker/);
  assert.match(compose, /ROLE: collector/);
  assert.match(dockerfile, /NITRO_PRESET=node-server/);
  assert.match(dockerfile, /ISPSOLUTIONS_GIT_SHA/);
  assert.match(compose, /1812:1812\/udp/);
  assert.match(dockerfile, /entrypoint\.sh/);
  assert.match(dockerfile, /worker\.mjs/);
  assert.match(dockerfile, /collector\.mjs/);
  assert.match(ci, /VPS_HOST/);
  assert.match(ci, /VPS_SSH_KEY/);
  assert.match(ci, /VPS_PATH/);
  assert.match(ci, /deploy\/vps\/update\.sh/);
  assert.match(ci, /--from-ci/);
  assert.match(ci, /command_timeout/);
  assert.match(ci, /github.ref == 'refs\/heads\/main'/);
  assert.match(ci, /github.event_name != 'pull_request'/);
});
