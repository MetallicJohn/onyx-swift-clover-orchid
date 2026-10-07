import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiPaymentDelta,
  apiPaymentPermission,
  apiPaymentWindows,
  exportApiPayments,
  exportApiPaymentsPdf,
  loadApiPayments,
  retryApiPayment,
  searchApiPaymentAccounts,
} from "./api-payments.ts";
import { assignIncomingPayments, ingestIncomingPayment, matchIncomingCustomer } from "./incoming-payments.ts";
import { canAccessAppPath } from "./rbac.ts";
import { openTestDb } from "./test-db.ts";

test("API payment windows use Nairobi calendar boundaries", () => {
  const windows = apiPaymentWindows(new Date("2026-10-02T12:00:00+03:00"));
  assert.equal(windows.today.start, "2026-10-02T00:00:00+03:00");
  assert.equal(windows.today.end, "2026-10-03T00:00:00+03:00");
  assert.equal(windows.previousDay.start, "2026-10-01T00:00:00+03:00");
  assert.equal(windows.week.start, "2026-09-28T00:00:00+03:00");
  assert.equal(windows.month.start, "2026-10-01T00:00:00+03:00");
  assert.equal(windows.previousMonth.start, "2026-09-01T00:00:00+03:00");
  assert.equal(apiPaymentDelta(112, 100), 12);
  assert.equal(apiPaymentDelta(0, 0), 0);
  assert.equal(apiPaymentDelta(10, 0), null);
});

test("API payment permissions follow billing roles", () => {
  assert.equal(apiPaymentPermission("customer_care", "view"), true);
  assert.equal(apiPaymentPermission("customer_care", "match"), true);
  assert.equal(apiPaymentPermission("customer_care", "retry"), false);
  assert.equal(apiPaymentPermission("customer_care", "export"), false);
  assert.equal(apiPaymentPermission("finance", "retry"), true);
  assert.equal(apiPaymentPermission("finance", "export"), true);
  assert.equal(apiPaymentPermission("technician", "view"), false);
  assert.equal(canAccessAppPath("technician", "/app/api-payments"), false);
  assert.equal(canAccessAppPath("finance", "/app/api-payments"), true);
});

function hit(over: Partial<Parameters<typeof ingestIncomingPayment>[2]> = {}) {
  return {
    provider: "mpesa",
    channel: "paybill",
    transId: "QWE1",
    billRef: "WRONG",
    msisdn: "254799000111",
    payerName: "John Kamau",
    amountKes: 2000,
    shortcode: "4095123",
    transTime: "2026-10-02T06:42:00+03:00",
    payload: { BillRefNumber: "WRONG" },
    ...over,
  };
}

test("matched API payment keeps the original account and posts one payment", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_api', 'Imani', 'imani')`;
    await sql`insert into customers (id, tenant_id, name, phone, account_number) values ('cus_api', 'ten_api', 'John Kamau', '0712000111', 'IMANI1024')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_api', 'ten_api', 'Home 10', 'pppoe', 10, 10, 2000)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, name, username, account_number, status, period_end)
      values ('svc_api', 'ten_api', 'cus_api', 'pkg_api', 'pppoe', 'Home Internet', 'johnk', 'IMANI1024', 'active', '2026-10-20')`;
    await sql`insert into invoices (id, tenant_id, customer_id, service_id, number, amount_kes, paid_kes, status, due_date)
      values ('inv_api', 'ten_api', 'cus_api', 'svc_api', 'INV-API', 2000, 0, 'issued', '2026-10-05')`;
    await asRole("ten_api");
    const typed = await matchIncomingCustomer(sql, "ten_api", { billRef: "imani1024", msisdn: "" });
    assert.equal(typed.serviceId, "svc_api");
    const stored = await ingestIncomingPayment(sql, { id: "ten_api", name: "Imani" }, hit({
      transId: "QWE123",
      billRef: "imani1024",
      amountKes: 2000,
      payload: { BillRefNumber: "imani1024" },
    }));
    assert.equal(stored.status, "matched");
    const [row] = await sql<{ bill_ref: string; status: string; payment_id: string }>`
      select bill_ref, status, payment_id from incoming_payments where trans_id = 'QWE123'`;
    assert.equal(row?.bill_ref, "imani1024");
    assert.equal(row?.status, "matched");
    const [inv] = await sql<{ paid_kes: number; status: string }>`select paid_kes, status from invoices where id = 'inv_api'`;
    assert.equal(inv?.paid_kes, 2000);
    assert.equal(inv?.status, "paid");
    const again = await ingestIncomingPayment(sql, { id: "ten_api", name: "Imani" }, hit({
      transId: "QWE123",
      billRef: "imani1024",
      amountKes: 2000,
    }));
    assert.equal(again.created, false);
    const pays = await sql<{ n: number }>`select count(*)::int as n from payments where tenant_id = 'ten_api' and reference = 'QWE123'`;
    assert.equal(pays[0]?.n, 1);
  } finally {
    await close();
  }
});

test("unmatched payment can be matched manually, failed processing does not post, and retry is idempotent", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_api2', 'Imani', 'imani2')`;
    await sql`insert into customers (id, tenant_id, name, phone, account_number) values ('cus_api2', 'ten_api2', 'John Kamau', '0722123456', 'IMANI1024')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_api2', 'ten_api2', 'Home 10', 'pppoe', 10, 10, 2000)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, name, username, account_number, status, period_end)
      values ('svc_api2', 'ten_api2', 'cus_api2', 'pkg_api2', 'pppoe', 'Home Internet', 'johnk', 'IMANI1024', 'active', '2026-10-20')`;
    await sql`insert into invoices (id, tenant_id, customer_id, service_id, number, amount_kes, paid_kes, status, due_date)
      values ('inv_api2', 'ten_api2', 'cus_api2', 'svc_api2', 'INV-2', 2000, 0, 'issued', '2026-10-05')`;
    await sql`insert into tenants (id, name, slug) values ('ten_other', 'Other', 'other')`;
    await sql`insert into incoming_payments (id, tenant_id, trans_id, amount_kes, bill_ref, status)
      values ('inp_other', 'ten_other', 'OTHER1', 9000, 'SECRET', 'unmatched')`;
    await asRole("ten_api2");
    const unknown = await ingestIncomingPayment(sql, { id: "ten_api2", name: "Imani" }, hit({ transId: "TXN928374", billRef: "0722123456" }));
    assert.equal(unknown.status, "unmatched");
    const [kept] = await sql<{ bill_ref: string }>`select bill_ref from incoming_payments where id = ${unknown.id}`;
    assert.equal(kept?.bill_ref, "0722123456");
    await assert.rejects(
      () => assignIncomingPayments(sql, {
        tenantId: "ten_api2",
        ispName: "Imani",
        userId: "usr_jane",
        ids: [unknown.id],
        customerId: "cus_missing",
      }),
      /Customer not found/,
    );
    const [failed] = await sql<{ status: string; payment_id: string | null }>`
      select status, payment_id from incoming_payments where id = ${unknown.id}`;
    assert.equal(failed?.status, "processing_failed");
    assert.equal(failed?.payment_id, null);
    const none = await sql<{ n: number }>`select count(*)::int as n from payments where reference = 'TXN928374'`;
    assert.equal(none[0]?.n, 0);

    const posted = await assignIncomingPayments(sql, {
      tenantId: "ten_api2",
      ispName: "Imani",
      userId: "usr_jane",
      ids: [unknown.id],
      customerId: "cus_api2",
      serviceId: "svc_api2",
    });
    assert.equal(posted.assigned, 1);
    const [audit] = await sql<{ details: string }>`
      select details from audit_logs where tenant_id = 'ten_api2' and action = 'api_payment.matched'`;
    assert.match(audit?.details || "", /0722123456/);
    assert.match(audit?.details || "", /IMANI1024/);
    const [still] = await sql<{ bill_ref: string; status: string }>`select bill_ref, status from incoming_payments where id = ${unknown.id}`;
    assert.equal(still?.bill_ref, "0722123456");
    assert.equal(still?.status, "assigned");

    await sql`update incoming_payments set status = 'processing_failed', payment_id = null where id = ${unknown.id}`;
    const first = await retryApiPayment(sql, { tenantId: "ten_api2", ispName: "Imani", userId: "usr_fin", id: unknown.id });
    await sql`update incoming_payments set status = 'processing_failed' where id = ${unknown.id}`;
    const second = await retryApiPayment(sql, { tenantId: "ten_api2", ispName: "Imani", userId: "usr_fin", id: unknown.id });
    assert.equal(second.duplicate, true);
    assert.equal(first.payment_id, second.payment_id);
    const pays = await sql<{ n: number }>`select count(*)::int as n from payments where tenant_id = 'ten_api2' and reference = 'TXN928374'`;
    assert.equal(pays[0]?.n, 1);

    const desk = await loadApiPayments(sql, "ten_api2", { now: new Date("2026-10-02T12:00:00+03:00"), range: "today" });
    assert.equal(desk.rows.some((r) => r.trans_id === "OTHER1"), false);
    assert.equal(desk.rows.some((r) => r.trans_id === "TXN928374"), true);
    assert.equal(desk.reconciliation.received, 2000);
    assert.equal(desk.reconciliation.processed, 2000);
    assert.equal(desk.reconciliation.nProcessed, 1);
    assert.equal(desk.methods[0]?.channel, "paybill");
    assert.equal(desk.methods[0]?.amount, 2000);
    assert.equal(desk.queuePreview.length, 0);
    assert.equal(desk.cards.today.amount, 2000);
    const found = await searchApiPaymentAccounts(sql, "ten_api2", "IMANI1024");
    assert.equal(found[0]?.customer_id, "cus_api2");
    const csv = await exportApiPayments(sql, "ten_api2", { range: "today", now: new Date("2026-10-02T12:00:00+03:00") });
    assert.match(csv.csv, /0722123456/);
    assert.match(csv.csv, /Payment Method/);
    assert.match(csv.csv, /M-Pesa PayBill/);
    assert.match(csv.csv, /Processed/);
    assert.match(csv.csv, /Home Internet/);
    assert.equal(csv.filename, "api-payments-today.csv");
    assert.equal(csv.truncated, false);
    assert.equal(csv.exported, 1);
    const pdf = await exportApiPaymentsPdf(sql, "ten_api2", { range: "today", now: new Date("2026-10-02T12:00:00+03:00") });
    assert.equal(pdf.filename, "api-payments-today.pdf");
    assert.match(pdf.pdf.subarray(0, 5).toString(), /%PDF/);
    assert.equal(pdf.truncated, false);
    assert.equal(pdf.exported, 1);
  } finally {
    await close();
  }
});

test("a provider reversal is stored and does not create a payment", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_rev', 'Imani', 'rev')`;
    await sql`insert into customers (id, tenant_id, name, phone, account_number) values ('cus_rev', 'ten_rev', 'Amina', '0711000111', 'REV100')`;
    await asRole("ten_rev");
    const stored = await ingestIncomingPayment(sql, { id: "ten_rev", name: "Imani" }, hit({
      transId: "REV1",
      billRef: "REV100",
      channel: "reversal",
      payload: { TransactionType: "Reversal", OriginalTransactionID: "QWE123" },
    }));
    assert.equal(stored.status, "reversed");
    const pays = await sql<{ n: number }>`select count(*)::int as n from payments where tenant_id = 'ten_rev'`;
    assert.equal(pays[0]?.n, 0);
    const [row] = await sql<{ reversal_of: string; bill_ref: string }>`select reversal_of, bill_ref from incoming_payments where trans_id = 'REV1'`;
    assert.equal(row?.reversal_of, "QWE123");
    assert.equal(row?.bill_ref, "REV100");
  } finally {
    await close();
  }
});
