#!/usr/bin/env node
/**
 * Apply every file in migrations/ to a clean database.
 * Uses DATABASE_URL when set (CI Postgres), otherwise embedded PGLite.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pendingMigrations } from "./migration-plan.mjs";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function applyAll(exec) {
  const entries = await readdir(migrationsDir);
  const files = pendingMigrations(entries, []);
  if (files.length === 0) throw new Error("no migrations found");
  for (const { name } of files) {
    const text = await readFile(join(migrationsDir, name), "utf8");
    await exec("select set_config('app.bypass_rls', 'on', false)");
    await exec(text);
    console.log(`[verify-migrations] applied ${name}`);
  }
  return files.length;
}

async function withPostgres(url) {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: url });
  await client.connect();
  try {
    const n = await applyAll((text) => client.query(text));
    const tables = await client.query(
      "select count(*)::int as n from information_schema.tables where table_schema='public'",
    );
    console.log(`[verify-migrations] postgres ok — ${n} files, ${tables.rows[0].n} tables`);
  } finally {
    await client.end();
  }
}

async function withPglite() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.waitReady;
  const n = await applyAll((text) => db.exec(text));
  const tables = await db.query(
    "select count(*)::int as n from information_schema.tables where table_schema='public'",
  );
  console.log(`[verify-migrations] pglite ok — ${n} files, ${tables.rows[0].n} tables`);
}

const url = process.env.DATABASE_URL?.trim();
(url ? withPostgres(url) : withPglite()).catch((err) => {
  console.error("[verify-migrations] failed:", err?.message || err);
  process.exit(1);
});
