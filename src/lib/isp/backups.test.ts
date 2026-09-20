import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_BACKUP_DIR,
  deleteBackupFile,
  formatBackupSize,
  isBackupBasename,
  listBackupFiles,
  parseBackupKeep,
  pruneBackupFiles,
  safeBackupPath,
} from "./backups.ts";

function stampDir() {
  return mkdtempSync(join(tmpdir(), "isp-backups-"));
}

function touch(dir: string, name: string, contents: string, mtime: Date) {
  const file = join(dir, name);
  writeFileSync(file, contents);
  utimesSync(file, mtime, mtime);
  return file;
}

test("backup names reject path traversal and absolute paths", () => {
  assert.equal(isBackupBasename("ispsolutions-20260920T150000Z.dump"), true);
  assert.equal(isBackupBasename("ispsolutions-20260920T150000Z.sql.gz"), true);
  assert.equal(isBackupBasename("../etc/passwd"), false);
  assert.equal(isBackupBasename("/etc/passwd"), false);
  assert.equal(isBackupBasename("ispsolutions-x.dump/../../etc/passwd"), false);
  assert.equal(isBackupBasename(".."), false);
  assert.equal(isBackupBasename("notes.txt"), false);
  assert.equal(isBackupBasename("ispsolutions-20260920T150000Z.dump.meta"), false);
  assert.throws(() => safeBackupPath("/tmp", "/etc/passwd"), /Invalid filename/);
  assert.throws(() => safeBackupPath("/tmp", "../../etc/passwd"), /Invalid filename/);
});

test("retention values must be whole numbers from 1 to 365", () => {
  assert.equal(parseBackupKeep(7), 7);
  assert.equal(parseBackupKeep("14"), 14);
  assert.throws(() => parseBackupKeep(0), /at least 1/);
  assert.throws(() => parseBackupKeep(-3), /whole number/);
  assert.throws(() => parseBackupKeep("nope"), /whole number/);
  assert.throws(() => parseBackupKeep(7.5), /whole number/);
  assert.throws(() => parseBackupKeep(400), /at most 365/);
});

test("lists newest backups first and skips sidecars", () => {
  const dir = stampDir();
  touch(dir, "ispsolutions-20260901T000000Z.dump", "old", new Date("2026-09-01T00:00:00Z"));
  touch(dir, "ispsolutions-20260920T180000Z.dump", "new", new Date("2026-09-20T18:00:00Z"));
  writeFileSync(join(dir, "ispsolutions-20260920T180000Z.dump.meta"), "meta");
  writeFileSync(join(dir, "readme.txt"), "nope");
  const listed = listBackupFiles(dir);
  assert.equal(listed.available, true);
  assert.deepEqual(
    listed.backups.map((b) => b.name),
    ["ispsolutions-20260920T180000Z.dump", "ispsolutions-20260901T000000Z.dump"],
  );
  assert.equal(listed.backups[0]?.type, "PostgreSQL custom dump");
  assert.equal(listed.backups[0]?.path, `${DEFAULT_BACKUP_DIR}/ispsolutions-20260920T180000Z.dump`);
});

test("missing directory is an empty error state, not created", () => {
  const dir = join(stampDir(), "does-not-exist");
  const listed = listBackupFiles(dir);
  assert.equal(listed.available, false);
  assert.match(listed.error || "", /not available/);
  assert.equal(listed.backups.length, 0);
});

test("delete removes a dump and its sidecar, never a path outside the dir", () => {
  const dir = stampDir();
  writeFileSync(join(dir, "ispsolutions-20260920T180000Z.dump"), "dump");
  writeFileSync(join(dir, "ispsolutions-20260920T180000Z.dump.meta"), "meta");
  writeFileSync(join(dir, "keep-me.txt"), "stay");
  deleteBackupFile("ispsolutions-20260920T180000Z.dump", dir);
  const listed = listBackupFiles(dir);
  assert.equal(listed.backups.length, 0);
  assert.equal(listBackupFiles(dir).available, true);
  writeFileSync(join(dir, "keep-me.txt"), "stay");
  assert.throws(() => deleteBackupFile("../keep-me.txt", dir), /Invalid filename/);
  assert.throws(() => deleteBackupFile("/etc/passwd", dir), /Invalid filename/);
  assert.throws(() => deleteBackupFile("ispsolutions-missing.dump", dir), /not found/i);
});

test("symlink backups cannot be deleted", () => {
  const dir = stampDir();
  const outside = join(stampDir(), "secret");
  writeFileSync(outside, "nope");
  symlinkSync(outside, join(dir, "ispsolutions-20260920T180000Z.dump"));
  assert.throws(() => deleteBackupFile("ispsolutions-20260920T180000Z.dump", dir), /Invalid filename/);
  const listed = listBackupFiles(dir);
  assert.equal(listed.backups.length, 0);
});

test("prune keeps the newest N dumps only", () => {
  const dir = stampDir();
  touch(dir, "ispsolutions-20260901T000000Z.dump", "a", new Date("2026-09-01T00:00:00Z"));
  touch(dir, "ispsolutions-20260910T000000Z.dump", "b", new Date("2026-09-10T00:00:00Z"));
  touch(dir, "ispsolutions-20260920T000000Z.dump", "c", new Date("2026-09-20T00:00:00Z"));
  const result = pruneBackupFiles(2, dir);
  assert.deepEqual(result.pruned, ["ispsolutions-20260901T000000Z.dump"]);
  assert.deepEqual(
    listBackupFiles(dir).backups.map((b) => b.name),
    ["ispsolutions-20260920T000000Z.dump", "ispsolutions-20260910T000000Z.dump"],
  );
});

test("opening the list does not prune", () => {
  const dir = stampDir();
  touch(dir, "ispsolutions-20260901T000000Z.dump", "a", new Date("2026-09-01T00:00:00Z"));
  listBackupFiles(dir);
  assert.equal(listBackupFiles(dir).backups.length, 1);
});

test("size labels are human readable", () => {
  assert.equal(formatBackupSize(125 * 1024 * 1024), "125 MB");
  assert.match(formatBackupSize(200), /B/);
});

test("mkdir is not used when the directory is missing", () => {
  const parent = stampDir();
  const dir = join(parent, "missing");
  listBackupFiles(dir);
  pruneBackupFiles(7, dir);
  assert.equal(listBackupFiles(dir).available, false);
});
