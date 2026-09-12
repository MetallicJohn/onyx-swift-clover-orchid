import assert from "node:assert/strict";
import { test } from "node:test";
import { issueInvoice } from "./billing.ts";
import {
  accountNumber,
  buildStatementRows,
  invoicePayable,
  invoiceStatusLabel,
  invoiceStatusTone,
  loadInvoiceDocument,
  loadStatementDocument,
} from "./documents.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { emailInvoice, renderInvoicePdf, renderStatementPdf } from "./pdf/index.ts";
import { openTestDb } from "./test-db.ts";

test("account numbers are derived from the tenant slug, not a hardcoded ISP", () => {
  assert.equal(accountNumber("northline-ops", "cus_abcdef123456"), "NORT-123456");
  assert.notEqual(accountNumber("imani-networks", "cus_x"), accountNumber("coast-fiber", "cus_x"));
});

test("stored account numbers win over the derived slug code", async () => {
  const { resolveAccountNumber } = await import("./document-format.ts");
  assert.equal(resolveAccountNumber("imani-networks", "cus_x", "IMN1000"), "IMN1000");
  assert.equal(resolveAccountNumber("imani-networks", "cus_abcdef123456", ""), accountNumber("imani-networks", "cus_abcdef123456"));
});

test("statement running balance, credit closing, and invoice status labels", () => {
  const { rows, summary } = buildStatementRows([
    { created_at: "2026-08-01", entry_type: "invoice", debit_kes: 2500, credit_kes: 0, memo: "INV-1" },
    { created_at: "2026-08-05", entry_type: "payment", debit_kes: 0, credit_kes: 2500, memo: "QK1" },
    { created_at: "2026-08-20", entry_type: "invoice", debit_kes: 2500, credit_kes: 0, memo: "INV-2" },
    { created_at: "2026-08-21", entry_type: "payment", debit_kes: 0, credit_kes: 4000, memo: "QK2" },
  ]);
  assert.equal(rows[0]?.balance, 2500);
  assert.equal(rows[1]?.balance, 0);
  assert.equal(summary.invoices, 5000);
  assert.equal(summary.payments, 6500);
  assert.equal(summary.closing, -1500);
  assert.equal(invoicePayable(-1500, 0).creditBalance, 1500);
  assert.equal(invoiceStatusLabel("partial"), "Partially Paid");
  assert.equal(invoiceStatusLabel("overdue"), "Overdue");
  assert.equal(invoiceStatusLabel("issued"), "Sent");
  assert.equal(invoiceStatusLabel("draft"), "Draft");
  assert.equal(invoiceStatusLabel("void"), "Void");
  assert.equal(invoiceStatusLabel("cancelled"), "Cancelled");
  assert.equal(invoiceStatusTone("Partially Paid"), "warn");
  assert.equal(invoiceStatusTone("Paid"), "ok");
});

test("invoice and statement PDFs use live tenant data and paginate", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, currency, support_email, support_phone, address, website, tax_pin, brand_color, bank_name, bank_account, invoice_footer)
      values ('ten_pdf', 'Coast Fiber', 'coast-fiber', 'KES', 'ops@coast.test', '0700111222', 'Nyali, Mombasa', 'https://coast.test', 'P051234567X', '#1a6b62', 'KCB', '128812', 'Pay using the account reference.')`;
    await sql`insert into customers (id, tenant_id, name, phone, email, address)
      values ('cus_pdf', 'ten_pdf', 'Amina Wanjiku of Westlands Nairobi Extra-Long Name', '0712000111', 'amina@example.com', 'Westlands, Nairobi')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_pdf', 'ten_pdf', 'Home 20', 'pppoe', 20, 10, 3500)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end)
      values ('svc_pdf', 'ten_pdf', 'cus_pdf', 'pkg_pdf', 'pppoe', 'amina', 'active', now())`;
    const first = await issueInvoice(sql, {
      tenantId: "ten_pdf",
      customerId: "cus_pdf",
      dueDate: "2026-09-20",
      items: [{ description: "Home 20 (monthly)", quantity: 1, unit_kes: 3500, package_id: "pkg_pdf", service_id: "svc_pdf" }],
    });
    await applyConfirmedPayment(sql, {
      tenantId: "ten_pdf",
      ispName: "Coast Fiber",
      invoiceId: first.id,
      provider: "mpesa",
      reference: "QKPARTIAL1",
      amountKes: 1000,
    });
    const paid = await issueInvoice(sql, {
      tenantId: "ten_pdf",
      customerId: "cus_pdf",
      dueDate: "2026-08-01",
      items: [{ description: "Home 20 (monthly)", quantity: 1, unit_kes: 3500, package_id: "pkg_pdf", service_id: "svc_pdf" }],
    });
    await applyConfirmedPayment(sql, {
      tenantId: "ten_pdf",
      ispName: "Coast Fiber",
      invoiceId: paid.id,
      provider: "mpesa",
      reference: "QKPAID1",
      amountKes: 3500,
    });
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date, subtotal_kes, paid_kes)
      values ('inv_od', 'ten_pdf', 'cus_pdf', 'INV-OVER', 3500, 'overdue', '2026-07-01', 3500, 0)`;
    await sql`insert into customer_ledger (id, tenant_id, customer_id, entry_type, debit_kes, credit_kes, memo)
      values ('led_od', 'ten_pdf', 'cus_pdf', 'invoice', 3500, 0, 'INV-OVER')`;
    for (let i = 0; i < 45; i += 1) {
      await sql`insert into customer_ledger (id, tenant_id, customer_id, entry_type, debit_kes, credit_kes, memo, created_at)
        values (${`led_x${i}`}, 'ten_pdf', 'cus_pdf', 'adjustment', 10, 0, ${`ADJ-${i}`}, ${new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString()})`;
    }

    const partialDoc = await loadInvoiceDocument(sql, "ten_pdf", first.id);
    assert.equal(partialDoc.brand.name, "Coast Fiber");
    assert.match(partialDoc.customer.accountNo, /^COAS-/);
    assert.equal(partialDoc.invoice.statusLabel, "Partially Paid");
    assert.equal(partialDoc.totals.payments, 1000);
    assert.equal(partialDoc.totals.amountDue, 2500);
    assert.ok(partialDoc.lines[0]?.packageName === "Home 20" || partialDoc.lines[0]?.description.includes("Home 20"));
    assert.ok(partialDoc.brand.paymentMethods.some((m) => m.label === "Bank transfer"));
    assert.ok(!partialDoc.brand.paymentMethods.some((m) => /m-pesa/i.test(m.label)));

    const pdf = await renderInvoicePdf(partialDoc);
    const pdfText = pdf.toString("latin1");
    assert.match(pdf.subarray(0, 5).toString(), /%PDF/);
    assert.doesNotMatch(pdfText, /IMANI NETWORKS LIMITED/i);

    await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, till_number, stk_type)
      values ('pp_m', 'ten_pdf', 'mpesa', 'M-Pesa', true, '522522', 'paybill')`;
    const withPay = await loadInvoiceDocument(sql, "ten_pdf", first.id);
    assert.ok(withPay.brand.paymentMethods.some((m) => m.label === "M-Pesa Paybill"));
    const payPdf = await renderInvoicePdf(withPay);
    assert.match(payPdf.subarray(0, 5).toString(), /%PDF/);

    const mailed = await emailInvoice(sql, "ten_pdf", first.id);
    assert.equal(mailed.status, "queued");
    assert.equal(mailed.to, "amina@example.com");
    const [out] = await sql<{ subject: string; detail: string }>`
      select subject, detail from email_outbox where tenant_id = 'ten_pdf' order by created_at desc limit 1`;
    assert.match(out?.subject ?? "", /Coast Fiber invoice/);
    assert.match(out?.detail ?? "", /attachment/);

    const paidDoc = await loadInvoiceDocument(sql, "ten_pdf", paid.id);
    assert.equal(paidDoc.invoice.statusLabel, "Paid");
    assert.equal(paidDoc.totals.amountDue, 0);
    const paidPdf = await renderInvoicePdf(paidDoc);
    assert.match(paidPdf.subarray(0, 5).toString(), /%PDF/);

    const overdue = await loadInvoiceDocument(sql, "ten_pdf", "inv_od");
    assert.equal(overdue.invoice.statusLabel, "Overdue");
    const overduePdf = await renderInvoicePdf(overdue);
    assert.match(overduePdf.subarray(0, 5).toString(), /%PDF/);

    await sql`insert into customer_ledger (id, tenant_id, customer_id, entry_type, debit_kes, credit_kes, memo)
      values ('led_cr', 'ten_pdf', 'cus_pdf', 'credit', 0, 20000, 'Goodwill')`;

    const statement = await loadStatementDocument(sql, "ten_pdf", "cus_pdf");
    assert.ok(statement.rows.length >= 45);
    assert.equal(statement.summary.closing, statement.rows[statement.rows.length - 1]?.balance);
    assert.ok(statement.summary.closing < 0);
    const stmtPdf = await renderStatementPdf(statement);
    const stmtText = stmtPdf.toString("latin1");
    assert.match(stmtPdf.subarray(0, 5).toString(), /%PDF/);
    assert.doesNotMatch(stmtText, /IMANI NETWORKS LIMITED/i);
    const pages = stmtText.match(/\/Type\s*\/Page[^s]/g) || [];
    assert.ok(pages.length >= 2, `expected multiple pages, got ${pages.length}`);

    await sql`insert into tenants (id, name, slug) values ('ten_b', 'Other', 'other')`;
    await assert.rejects(() => loadInvoiceDocument(sql, "ten_b", first.id), /Invoice not found/);
    await assert.rejects(() => loadStatementDocument(sql, "ten_b", "cus_pdf"), /Customer not found/);
  } finally {
    await close();
  }
});
