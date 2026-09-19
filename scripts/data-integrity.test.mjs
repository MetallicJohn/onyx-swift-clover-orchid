import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SNAPSHOT_TABLES,
  compareSnapshots,
  countTableSql,
  formatSnapshotReport,
} from "./data-integrity.mjs";

test("equal or increased counts pass", () => {
  assert.equal(compareSnapshots({ tenants: 2, customers: 10 }, { tenants: 2, customers: 10 }).ok, true);
  assert.equal(compareSnapshots({ tenants: 2 }, { tenants: 3, customers: 1 }).ok, true);
});

test("unexpected decreases fail", () => {
  const r = compareSnapshots({ customers: 100, invoices: 40 }, { customers: 99, invoices: 40 });
  assert.equal(r.ok, false);
  assert.equal(r.drops[0]?.table, "customers");
  assert.equal(r.drops[0]?.before, 100);
  assert.equal(r.drops[0]?.after, 99);
});

test("report flags a decrease", () => {
  const text = formatSnapshotReport(
    { tenants: 2, customers: 8 },
    { tenants: 2, customers: 7 },
    { previous: "abc", current: "def", backup: "/opt/ispsolutions/backups/x.dump" },
  );
  assert.match(text, /Data integrity: FAILED/);
  assert.match(text, /customers: 8 → 7/);
  assert.match(text, /Previous version: abc/);
});

test("snapshot covers the production tables named in the data-protection directive", () => {
  for (const t of ["tenants", "customers", "services", "invoices", "payments", "routers", "audit_logs"]) {
    assert.ok(SNAPSHOT_TABLES.includes(t), t);
  }
  assert.match(countTableSql("user"), /"user"/);
  assert.match(countTableSql("customers"), /from customers/);
});
