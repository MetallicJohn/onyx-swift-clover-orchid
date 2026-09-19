import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  HISTORICAL_DESTRUCTIVE_ALLOWLIST,
  assertSafeToApply,
  findDestructiveOperations,
  productionProtectsData,
  scanMigrationFiles,
  stripSqlComments,
} from "./migration-safety.mjs";
import { pendingMigrations } from "./migration-plan.mjs";

test("additive SQL is allowed", () => {
  const sql = `
    create table if not exists widgets (id text primary key);
    alter table widgets add column if not exists colour text;
    create index if not exists widgets_colour_idx on widgets (colour);
    drop policy if exists tenant_isolation on widgets;
    drop index if exists widgets_old_idx;
  `;
  assert.deepEqual(findDestructiveOperations(sql, "0065_widgets.sql"), []);
});

test("DROP TABLE / TRUNCATE / DROP COLUMN are blocked", () => {
  assert.equal(findDestructiveOperations("DROP TABLE customers;").length, 1);
  assert.equal(findDestructiveOperations("truncate table invoices").length, 1);
  assert.ok(
    findDestructiveOperations("alter table customers drop column phone;").some(
      (f) => f.operation === "DROP COLUMN",
    ),
  );
  assert.ok(findDestructiveOperations("DROP DATABASE ispsolutions").length);
});

test("DELETE FROM is review, not silent", () => {
  const findings = findDestructiveOperations("delete from customers where tenant_id = t;");
  assert.equal(findings[0]?.operation, "DELETE FROM");
  assert.equal(findings[0]?.kind, "review");
});

test("comments do not trigger the scanner", () => {
  assert.deepEqual(findDestructiveOperations("-- DROP TABLE customers\ncreate table t (id int);"), []);
  assert.deepEqual(findDestructiveOperations("/* TRUNCATE invoices */ create table t (id int);"), []);
});

test("historical allowlisted files are not re-blocked", () => {
  assert.deepEqual(
    findDestructiveOperations("delete from customers;", "0023_empty_tenants_created_today.sql"),
    [],
  );
});

test("production apply throws unless explicitly allowed", () => {
  const findings = findDestructiveOperations("DROP TABLE routers;");
  assert.throws(() => assertSafeToApply(findings), /Destructive SQL blocked/);
  assert.throws(() => assertSafeToApply(findings, { allowDestructive: false }), /blocked/);
  assert.doesNotThrow(() =>
    assertSafeToApply(findDestructiveOperations("delete from t;"), { allowDestructive: true }),
  );
  assert.throws(
    () => assertSafeToApply(findings, { allowDestructive: true }),
    /DROP TABLE/,
  );
});

test("productionProtectsData follows NODE_ENV", () => {
  assert.equal(productionProtectsData({ NODE_ENV: "production" }), true);
  assert.equal(productionProtectsData({ ISPSOLUTIONS_PROTECT_DATA: "1" }), true);
  assert.equal(productionProtectsData({ NODE_ENV: "development" }), false);
});

test("every current migration is additive or historically allowlisted", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = pendingMigrations(readdirSync(dir), []).map((p) => ({
    name: p.name,
    sql: readFileSync(join(dir, p.name), "utf8"),
  }));
  const findings = scanMigrationFiles(files).filter((f) => f.kind === "blocked");
  assert.deepEqual(findings, [], findings.map((f) => `${f.migration} ${f.operation}`).join("; "));
  assert.ok(HISTORICAL_DESTRUCTIVE_ALLOWLIST.has("0023_empty_tenants_created_today.sql"));
});

test("stripSqlComments keeps the statement", () => {
  assert.match(stripSqlComments("create table t -- drop table\n (id int);"), /create table t/);
});
