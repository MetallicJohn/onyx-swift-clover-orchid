import assert from "node:assert/strict";
import { test } from "node:test";
import { accountNumber } from "./document-format.ts";
import {
  assignIncomingPayments,
  ingestIncomingPayment,
  isC2bBody,
  listIncomingPayments,
  parseC2bBody,
} from "./incoming-payments.ts";
import { processMpesaCallback } from "./webhooks.ts";
import { openTestDb } from "./test-db.ts";

test("C2B parse distinguishes paybill from STK", () => {
  assert.equal(isC2bBody({ TransID: "ABC", TransAmount: "500" }), true);
  assert.equal(isC2bBody({ Body: { stkCallback: { CheckoutRequestID: "ws" } } }), false);
  const hit = parseC2bBody({
    TransactionType: "Pay Bill",
    TransID: "TJ7ABC123",
    TransTime: "20260910004511",
    TransAmount: "2500",
    BusinessShortCode: "4095123",
    BillRefNumber: "IMAN-123456",
    MSISDN: "254712000111",
    FirstName: "Amina",
  });
  assert.equal(hit?.channel, "paybill");
  assert.equal(hit?.amountKes, 2500);
  assert.equal(hit?.transId, "TJ7ABC123");
});

async function seedPay(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_in', 'Imani', 'imani')`;
  await sql`insert into customers (id, tenant_id, name, phone) values ('cus_in', 'ten_in', 'Amina Otieno', '0712000111')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
    values ('pkg_in', 'ten_in', 'Home', 'pppoe', 10, 10, 2500)`;
  await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, paid_kes, status, due_date)
    values ('inv_in', 'ten_in', 'cus_in', 'INV-100', 2500, 0, 'issued', '2026-09-30')`;
}

test("paybill hit with matching account credits the invoice; unknown ref stays unmatched and can be assigned", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedPay(sql);
    const acc = accountNumber("imani", "cus_in");
    const matched = await processMpesaCallback(sql, "imani", {
      TransactionType: "Pay Bill",
      TransID: "RCPT001",
      TransAmount: "2500",
      BillRefNumber: acc,
      MSISDN: "254700000000",
      FirstName: "Amina",
      TransTime: "20260910010000",
    });
    assert.equal(matched.ResultDesc, "matched");
    const [inv] = await sql<{ paid_kes: number; status: string }>`select paid_kes, status from invoices where id = 'inv_in'`;
    assert.equal(inv?.paid_kes, 2500);
    assert.equal(inv?.status, "paid");

    const unknown = await processMpesaCallback(sql, "imani", {
      TransactionType: "Pay Bill",
      TransID: "RCPT002",
      TransAmount: "800",
      BillRefNumber: "WRONG",
      MSISDN: "254799999999",
      FirstName: "Unknown",
      TransTime: "20260910010100",
    });
    assert.equal(unknown.ResultDesc, "unmatched");
    const desk = await listIncomingPayments(sql, "ten_in");
    assert.equal(desk.unmatched, 1);
    const row = desk.rows.find((r) => r.trans_id === "RCPT002");
    assert.ok(row);
    const assigned = await assignIncomingPayments(sql, {
      tenantId: "ten_in",
      ispName: "Imani",
      userId: "user_1",
      ids: [row!.id],
      customerId: "cus_in",
    });
    assert.equal(assigned.assigned, 1);
    const after = await listIncomingPayments(sql, "ten_in");
    assert.equal(after.unmatched, 0);
    const [pay] = await sql<{ amount_kes: number }>`select amount_kes from payments where reference = 'RCPT002'`;
    assert.equal(pay?.amount_kes, 800);
  } finally {
    await close();
  }
});

test("duplicate TransID is idempotent", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedPay(sql);
    const hit = {
      provider: "mpesa",
      channel: "paybill",
      transId: "DUP1",
      billRef: "WRONG",
      msisdn: "2547",
      payerName: "X",
      amountKes: 100,
      shortcode: "1",
      transTime: new Date().toISOString(),
      payload: {},
    };
    const a = await ingestIncomingPayment(sql, { id: "ten_in", name: "Imani" }, hit);
    const b = await ingestIncomingPayment(sql, { id: "ten_in", name: "Imani" }, hit);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
  } finally {
    await close();
  }
});

test("STK amount mismatch parks unmatched and does not credit", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedPay(sql);
    await sql`insert into payment_intents (id, tenant_id, invoice_id, customer_id, provider, amount_kes, checkout_id, status)
      values ('pi_mis', 'ten_in', 'inv_in', 'cus_in', 'mpesa', 2500, 'ws_mis', 'pending')`;
    const result = await processMpesaCallback(sql, "imani", {
      Body: {
        stkCallback: {
          CheckoutRequestID: "ws_mis",
          ResultCode: 0,
          ResultDesc: "Success",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 100 },
              { Name: "MpesaReceiptNumber", Value: "QJKMIS" },
              { Name: "PhoneNumber", Value: "254712000111" },
            ],
          },
        },
      },
    });
    assert.equal(result.ResultDesc, "reconciliation_required");
    const pays = await sql<{ id: string }>`select id from payments where tenant_id = 'ten_in'`;
    assert.equal(pays.length, 0);
    const desk = await listIncomingPayments(sql, "ten_in");
    assert.equal(desk.unmatched, 1);
    assert.equal(desk.rows[0]?.trans_id, "QJKMIS");
    const [inv] = await sql<{ paid_kes: number }>`select paid_kes from invoices where id = 'inv_in'`;
    assert.equal(inv?.paid_kes, 0);
  } finally {
    await close();
  }
});
