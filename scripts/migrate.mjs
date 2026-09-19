#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Additive only. Pending files are scanned for DROP TABLE / TRUNCATE / DELETE
 * FROM / DROP COLUMN. Production refuses destructive SQL unless
 * ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS=1. One advisory lock so two web
 * replicas cannot migrate at once. Each file is one transaction recorded in
 * `_migrations`.
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";
import {
  allowDestructiveMigrations,
  assertSafeToApply,
  findDestructiveOperations,
  productionProtectsData,
} from "./migration-safety.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const LOCK_KEY = 87264019;

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    locked = true;
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations")).rows.map(
      (r) => r.name,
    );
    const pending = pendingMigrations(entries, applied);
    const allowDestructive = allowDestructiveMigrations();
    const production = productionProtectsData();
    for (const { name } of pending) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      const findings = findDestructiveOperations(text, name);
      if (findings.length) {
        console.error(`[migrate] ${name} contains ${findings.map((f) => f.operation).join(", ")}`);
        if (production || findings.some((f) => f.kind === "blocked")) {
          assertSafeToApply(findings, { allowDestructive });
        }
      }
    }

    let count = 0;
    for (const { name } of pending) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        await client.query("select set_config('app.bypass_rls', 'on', true)");
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
      } catch {
        /* connection may already be dead */
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
