import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("VPS update never destroys volumes and requires a verified backup on existing data", () => {
  const update = read("deploy/vps/update.sh");
  const backup = read("deploy/vps/backup.sh");
  const restore = read("deploy/vps/restore.sh");
  const protect = read("deploy/vps/protect.sh");
  const compose = read("deploy/vps/docker-compose.yml");
  const migrate = read("scripts/migrate.mjs");
  const uncommented = (src) =>
    src
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");

  assert.doesNotMatch(uncommented(update), /down\s+-v/);
  assert.doesNotMatch(uncommented(protect), /down\s+-v/);
  assert.match(update, /never destroy named volumes/);
  assert.match(update, /scan_pending_migrations/);
  assert.match(update, /compare_count_files/);
  assert.match(update, /database backup kept/);
  assert.match(update, /not restored/);
  assert.match(backup, /--format=custom/);
  assert.match(backup, /verify_dump_file/);
  assert.match(restore, /--i-understand-this-overwrites-live-data/);
  assert.match(protect, /DROP TABLE/);
  assert.match(compose, /pgdata:/);
  assert.match(migrate, /pg_advisory_lock/);
  assert.match(migrate, /findDestructiveOperations/);
});
