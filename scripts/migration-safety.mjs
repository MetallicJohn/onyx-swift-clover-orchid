// @ts-check
/**
 * Production-safe migration scan. Additive SQL is allowed.
 * DROP TABLE / TRUNCATE / DROP COLUMN / DELETE FROM block production deploys
 * unless the file is on the historical allowlist (already applied once).
 */

/** Already-applied one-shots. New files must not be added here. */
export const HISTORICAL_DESTRUCTIVE_ALLOWLIST = new Set([
  "0023_empty_tenants_created_today.sql",
]);

/** @typedef {{ kind: "blocked" | "review"; operation: string; table?: string; reason: string }} Finding */

const BLOCKED = [
  { operation: "DROP DATABASE", re: /\bDROP\s+DATABASE\b/i, reason: "Destroys the entire database." },
  { operation: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/i, reason: "Removes a schema and its objects." },
  { operation: "DROP TABLE", re: /\bDROP\s+TABLE\b/i, reason: "Deletes a table and its rows." },
  { operation: "TRUNCATE", re: /\bTRUNCATE\s+(TABLE\s+)?/i, reason: "Wipes table contents." },
  {
    operation: "DROP COLUMN",
    re: /\bALTER\s+TABLE\b[\s\S]{0,400}?\bDROP\s+COLUMN\b/i,
    reason: "Removes a column and its values.",
  },
];

const REVIEW = [
  { operation: "DELETE FROM", re: /\bDELETE\s+FROM\b/i, reason: "Deletes existing rows." },
  {
    operation: "DROP CONSTRAINT",
    re: /\bALTER\s+TABLE\b[\s\S]{0,400}?\bDROP\s+CONSTRAINT\b/i,
    reason: "May reject existing application writes.",
  },
];

export function stripSqlComments(sql) {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/**
 * @param {string} sql
 * @param {string} [filename]
 * @returns {Finding[]}
 */
export function findDestructiveOperations(sql, filename = "") {
  const name = (filename.split("/").pop() || filename).trim();
  if (name && HISTORICAL_DESTRUCTIVE_ALLOWLIST.has(name)) return [];
  const body = stripSqlComments(sql);
  /** @type {Finding[]} */
  const findings = [];
  for (const rule of BLOCKED) {
    if (rule.re.test(body)) {
      findings.push({ kind: "blocked", operation: rule.operation, reason: rule.reason });
    }
  }
  for (const rule of REVIEW) {
    if (rule.re.test(body)) {
      findings.push({ kind: "review", operation: rule.operation, reason: rule.reason });
    }
  }
  return findings;
}

/**
 * @param {Finding[]} findings
 * @param {{ allowDestructive?: boolean }} [opts]
 */
export function assertSafeToApply(findings, opts = {}) {
  if (!findings.length) return;
  const blocked = findings.filter((f) => f.kind === "blocked" || !opts.allowDestructive);
  if (!blocked.length) return;
  const lines = blocked.map(
    (f) => `${f.operation}: ${f.reason}${f.table ? ` (${f.table})` : ""}`,
  );
  throw new Error(
    `Destructive SQL blocked.\n${lines.join("\n")}\nSet ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS=1 only after a verified backup and written rollback.`,
  );
}

export function productionProtectsData(env = process.env) {
  return env.NODE_ENV === "production" || env.ISPSOLUTIONS_PROTECT_DATA === "1";
}

export function allowDestructiveMigrations(env = process.env) {
  return env.ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS === "1";
}

/**
 * @param {Array<{ name: string; sql: string }>} files
 * @param {{ allowDestructive?: boolean; production?: boolean }} [opts]
 */
export function scanMigrationFiles(files, opts = {}) {
  /** @type {Array<Finding & { migration: string }>} */
  const all = [];
  for (const file of files) {
    for (const finding of findDestructiveOperations(file.sql, file.name)) {
      all.push({ ...finding, migration: file.name });
    }
  }
  if (opts.production) assertSafeToApply(all, opts);
  return all;
}

function formatReport(findings) {
  if (!findings.length) {
    return "Potential destructive operations: NONE\nMigration status: SAFE TO APPLY";
  }
  return findings
    .map(
      (f) =>
        `Migration: ${f.migration}\nOperation: ${f.operation}\nReason: ${f.reason}\nPotential impact: existing production rows/columns\nRequired approval: ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS=1`,
    )
    .join("\n\n");
}

const isMain = process.argv[1]?.endsWith("migration-safety.mjs");
if (isMain) {
  const { readdir, readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { pendingMigrations } = await import("./migration-plan.mjs");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const entries = await readdir(dir);
  const pendingOnly = process.argv.includes("--pending");
  const names = pendingOnly
    ? pendingMigrations(entries, (process.env.APPLIED_MIGRATIONS || "").split(",").filter(Boolean))
    : pendingMigrations(entries, []);
  const files = [];
  for (const { name } of names) {
    files.push({ name, sql: await readFile(join(dir, name), "utf8") });
  }
  const production = productionProtectsData();
  const findings = scanMigrationFiles(files, {
    production,
    allowDestructive: allowDestructiveMigrations(),
  });
  console.log(formatReport(findings));
  if (findings.some((f) => f.kind === "blocked" || (production && !allowDestructiveMigrations()))) {
    if (findings.length) process.exit(1);
  }
}
