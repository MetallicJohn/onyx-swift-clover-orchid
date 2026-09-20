import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("platform Settings has a Superadmin Backups tab with confirmation delete", () => {
  const settings = readFileSync(new URL("../../routes/platform/settings.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/platform/backups-panel.tsx", import.meta.url), "utf8");
  const tenant = readFileSync(new URL("../../routes/app/settings.tsx", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../../../deploy/vps/docker-compose.yml", import.meta.url), "utf8");
  const backup = readFileSync(new URL("../../../deploy/vps/backup.sh", import.meta.url), "utf8");

  assert.match(settings, /label: "Backups"/);
  assert.match(settings, /BackupsPanel/);
  assert.match(panel, /listSaasBackups/);
  assert.match(panel, /deleteSaasBackup/);
  assert.match(panel, /saveSaasBackupRetention/);
  assert.match(panel, /Delete backup/);
  assert.match(panel, /pending\.name/);
  assert.doesNotMatch(tenant, /BackupsPanel/);
  assert.doesNotMatch(tenant, /id: "backups"/);
  assert.match(compose, /\/opt\/ispsolutions\/backups/);
  assert.match(backup, /prune_old_backups/);
  assert.match(backup, /backup_keep/);
});
