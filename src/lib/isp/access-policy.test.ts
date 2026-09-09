import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bundleExhausted,
  extendPeriodEnd,
  periodMs,
  usedMbFromBytes,
} from "./access-policy.ts";
import { applyAccessPolicy, recordAccounting, restorePaidAccess } from "./access-policy.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { openTestDb } from "./test-db.ts";

test("period length prefers validity hours over billing interval", () => {
  assert.equal(periodMs("monthly", 0), 30 * 86400_000);
  assert.equal(periodMs("daily", 0), 86400_000);
  assert.equal(periodMs("monthly", 24), 24 * 3600_000);
});

test("paid period stacks from the later of now and current end", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  const future = extendPeriodEnd("2026-09-20T10:00:00Z", now, 86400_000);
  assert.equal(future.toISOString().slice(0, 10), "2026-09-21");
  const fromNow = extendPeriodEnd("2026-09-01T10:00:00Z", now, 86400_000);
  assert.equal(fromNow.toISOString().slice(0, 10), "2026-09-10");
});

test("bundle exhaustion is inclusive of the cap", () => {
  assert.equal(bundleExhausted(99, 100), false);
  assert.equal(bundleExhausted(100, 100), true);
  assert.equal(bundleExhausted(500, 0), false);
  assert.equal(usedMbFromBytes(1024 * 1024, 1024 * 1024), 2);
});

test("expired period suspends; payment extends and restores", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_t', 'Time', 'time')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_t', 'ten_t', 'Tia', '0711000001')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, grace_days, validity_hours)
      values ('pkg_t', 'ten_t', 'Day', 'pppoe', 10, 10, 100, 0, 24)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end)
      values ('svc_t', 'ten_t', 'cus_t', 'pkg_t', 'pppoe', 'tia', 'active', ${new Date(Date.now() - 3600_000).toISOString()})`;
    await asRole("ten_t");
    const cycle = await applyAccessPolicy(sql, "ten_t", "Time");
    assert.ok(cycle.time >= 1);
    const [suspended] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = ${"svc_t"}`;
    assert.equal(suspended?.status, "suspended");
    assert.equal(suspended?.suspend_reason, "time");

    await restorePaidAccess(sql, "ten_t", "cus_t");
    const [restored] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = ${"svc_t"}`;
    assert.equal(restored?.status, "active");
    assert.ok(new Date(restored?.period_end ?? 0).getTime() > Date.now());
  } finally {
    await close();
  }
});

test("bundle accounting suspends at the cap; payment resets usage", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_b', 'Bundle', 'bundle')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_b', 'ten_b', 'Bo', '0711000002')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, bundle_mb)
      values ('pkg_b', 'ten_b', '10MB', 'pppoe', 10, 10, 500, 2)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end)
      values ('svc_b', 'ten_b', 'cus_b', 'pkg_b', 'pppoe', 'bo', 'active', ${new Date(Date.now() + 86400_000).toISOString()})`;
    await asRole("ten_b");
    const first = await recordAccounting(sql, "ten_b", { username: "bo", bytes_in: 1024 * 1024, bytes_out: 0 });
    assert.equal(first.suspended, false);
    const over = await recordAccounting(sql, "ten_b", { username: "bo", bytes_in: 1024 * 1024, bytes_out: 1024 * 1024 });
    assert.equal(over.suspended, true);
    const [row] = await sql<{ status: string; suspend_reason: string; bundle_used_mb: number }>`
      select status, suspend_reason, bundle_used_mb from services where id = ${"svc_b"}`;
    assert.equal(row?.status, "suspended");
    assert.equal(row?.suspend_reason, "bundle");
    assert.ok((row?.bundle_used_mb ?? 0) >= 2);

    await restorePaidAccess(sql, "ten_b", "cus_b");
    const [ok] = await sql<{ status: string; bundle_used_mb: number }>`
      select status, bundle_used_mb from services where id = ${"svc_b"}`;
    assert.equal(ok?.status, "active");
    assert.equal(ok?.bundle_used_mb, 0);
  } finally {
    await close();
  }
});

test("payment restores only when no other invoice is overdue", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_h', 'Hold', 'hold')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_h', 'ten_h', 'Hal', '0711000003')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, grace_days)
      values ('pkg_h', 'ten_h', 'Home', 'pppoe', 10, 10, 1000, 0)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_h', 'ten_h', 'cus_h', 'pkg_h', 'pppoe', 'hal', 'suspended')`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values
        ('inv_h1', 'ten_h', 'cus_h', 'INV-H1', 1000, 'issued', '2020-01-01'),
        ('inv_h2', 'ten_h', 'cus_h', 'INV-H2', 1000, 'issued', '2020-02-01')`;
    await asRole("ten_h");
    await applyConfirmedPayment(sql, {
      tenantId: "ten_h",
      ispName: "Hold",
      invoiceId: "inv_h1",
      provider: "mpesa",
      reference: "PAY-H1",
    });
    const [held] = await sql<{ status: string }>`select status from services where id = ${"svc_h"}`;
    assert.equal(held?.status, "suspended");

    await applyConfirmedPayment(sql, {
      tenantId: "ten_h",
      ispName: "Hold",
      invoiceId: "inv_h2",
      provider: "mpesa",
      reference: "PAY-H2",
    });
    const [live] = await sql<{ status: string }>`select status from services where id = ${"svc_h"}`;
    assert.equal(live?.status, "active");
  } finally {
    await close();
  }
});
