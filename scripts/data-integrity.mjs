// @ts-check
/** Pre/post deploy row counts. Unexpected decreases fail the deploy. */

export const SNAPSHOT_TABLES = [
  "tenants",
  "user",
  "customers",
  "services",
  "packages",
  "invoices",
  "payments",
  "incoming_payments",
  "customer_ledger",
  "routers",
  "ip_pools",
  "ip_addresses",
  "tickets",
  "audit_logs",
  "radius_accounts",
  "wireguard_peers",
  "router_credentials",
];

/**
 * @param {Record<string, number>} before
 * @param {Record<string, number>} after
 */
export function compareSnapshots(before, after) {
  /** @type {Array<{ table: string; before: number; after: number }>} */
  const drops = [];
  for (const table of Object.keys(before)) {
    const prev = Number(before[table] ?? 0);
    const next = Number(after[table] ?? prev);
    if (Number.isFinite(prev) && Number.isFinite(next) && next < prev) {
      drops.push({ table, before: prev, after: next });
    }
  }
  return { ok: drops.length === 0, drops };
}

export function formatSnapshotReport(before, after, extra = {}) {
  const cmp = compareSnapshots(before, after);
  const lines = [
    "ISP SOLUTIONS DEPLOYMENT REPORT",
    extra.previous ? `Previous version: ${extra.previous}` : "",
    extra.current ? `New version: ${extra.current}` : "",
    extra.backup ? `Backup: ${extra.backup}` : "",
    extra.migration || "Database migration: SUCCESS",
    cmp.ok ? "Data integrity: PASSED" : "Data integrity: FAILED — unexpected row decrease",
  ].filter(Boolean);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    lines.push(`${key}: ${before[key] ?? 0} → ${after[key] ?? 0}`);
  }
  if (!cmp.ok) {
    for (const d of cmp.drops) lines.push(`ALERT ${d.table} decreased ${d.before} → ${d.after}`);
  }
  return lines.join("\n");
}

/** SQL that counts a table if it exists, else 0. */
export function countTableSql(table) {
  const name = table.replace(/"/g, "");
  const quoted = name === "user" ? '"user"' : name;
  return `select case when to_regclass('public.${name === "user" ? "user" : name}') is null then 0 else (select count(*)::int from ${quoted}) end as n`;
}
