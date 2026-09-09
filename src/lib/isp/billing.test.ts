import assert from "node:assert/strict";
import { test } from "node:test";
import {
  intervalDays,
  invoiceTotals,
  needsRecurringInvoice,
  remainingKes,
  statusAfterPayment,
  taxOn,
} from "./billing.ts";
import { issueInvoice } from "./billing.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { openTestDb } from "./test-db.ts";

test("billing intervals", () => {
  assert.equal(intervalDays("daily"), 1);
  assert.equal(intervalDays("weekly"), 7);
  assert.equal(intervalDays("monthly"), 30);
});

test("does not stack invoices while one is unpaid", () => {
  assert.equal(
    needsRecurringInvoice({ hasUnpaid: true, lastIssuedAt: "2026-01-01", interval: "monthly" }),
    false,
  );
});

test("issues first invoice when none exist", () => {
  assert.equal(needsRecurringInvoice({ hasUnpaid: false, lastIssuedAt: null, interval: "monthly" }), true);
});

test("renews after the package interval", () => {
  const today = new Date("2026-09-09");
  assert.equal(
    needsRecurringInvoice({ hasUnpaid: false, lastIssuedAt: "2026-08-01", interval: "monthly", today }),
    true,
  );
  assert.equal(
    needsRecurringInvoice({ hasUnpaid: false, lastIssuedAt: "2026-09-01", interval: "monthly", today }),
    false,
  );
});

test("Kenya VAT 16% is exclusive and optional", () => {
  assert.equal(taxOn(2500, 0), 0);
  assert.equal(taxOn(2500, 16), 400);
  const withVat = invoiceTotals([{ amount_kes: 2500 }, { amount_kes: 1000 }], 16);
  assert.equal(withVat.subtotal, 3500);
  assert.equal(withVat.tax, 560);
  assert.equal(withVat.total, 4060);
});

test("remaining and payment status", () => {
  assert.equal(remainingKes(2500, 0, "issued"), 2500);
  assert.equal(remainingKes(2500, 1000, "partial"), 1500);
  assert.equal(remainingKes(2500, 2500, "paid"), 0);
  assert.equal(statusAfterPayment(2500, 1000, "issued"), "partial");
  assert.equal(statusAfterPayment(2500, 2500, "partial"), "paid");
});

test("issueInvoice writes line items and VAT; partial payment leaves a remainder", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, vat_enabled, vat_rate_pct)
      values ('ten_b', 'Bill', 'bill', true, 16)`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_b', 'ten_b', 'Bea', '0711000001')`;
    await asRole("ten_b");
    const inv = await issueInvoice(sql, {
      tenantId: "ten_b",
      customerId: "cus_b",
      dueDate: "2026-09-20",
      items: [{ description: "Home 10 (monthly)", quantity: 1, unit_kes: 2500 }],
    });
    assert.equal(inv.subtotal_kes, 2500);
    assert.equal(inv.tax_kes, 400);
    assert.equal(inv.amount_kes, 2900);
    const items = await sql<{ description: string }>`select description from invoice_items where invoice_id = ${inv.id}`;
    assert.equal(items[0]?.description, "Home 10 (monthly)");

    const part = await applyConfirmedPayment(sql, {
      tenantId: "ten_b",
      ispName: "Bill",
      invoiceId: inv.id,
      provider: "mpesa",
      reference: "PART-1",
      amountKes: 1000,
    });
    assert.equal(part.status, "partial");
    assert.equal(part.remaining_kes, 1900);
    const [row] = await sql<{ status: string; paid_kes: number }>`select status, paid_kes from invoices where id = ${inv.id}`;
    assert.equal(row?.status, "partial");
    assert.equal(row?.paid_kes, 1000);

    const rest = await applyConfirmedPayment(sql, {
      tenantId: "ten_b",
      ispName: "Bill",
      invoiceId: inv.id,
      provider: "mpesa",
      reference: "PART-2",
      amountKes: 1900,
    });
    assert.equal(rest.status, "paid");
    assert.equal(rest.remaining_kes, 0);
  } finally {
    await close();
  }
});
