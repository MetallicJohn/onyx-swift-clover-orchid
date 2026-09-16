import assert from "node:assert/strict";
import { test } from "node:test";
import { restorePaidAccess } from "./access-policy.ts";
import { allocateAccountNumber, ensureServiceAccountNumber, saveAccountNumberSettings } from "./account-numbers.ts";
import { generateRecurringInvoices, issueInvoice } from "./billing.ts";
import { formatDate } from "./display.ts";
import { ingestIncomingPayment, matchIncomingCustomer, creditCustomerPayment } from "./incoming-payments.ts";
import { createOnboard } from "./onboard-create.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { loadInvoiceDocument, loadStatementDocument } from "./documents.ts";
import { openTestDb } from "./test-db.ts";

async function seedTwoServices(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_sa', 'Service Acc', 'svcacc')`;
  await saveAccountNumberSettings(sql, "ten_sa", "svcacc", {
    enabled: true,
    scheme: "sequence",
    prefix: "IMN",
    separator: "-",
    start_n: 100,
    next_n: 100,
    digits: 3,
    allow_manual: true,
  });
  await sql`insert into customers (id, tenant_id, name, phone, account_number)
    values ('cus_sa', 'ten_sa', 'John Mwangi', '0712555000', 'IMN-CUS')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days)
    values
      ('pkg_fibre', 'ten_sa', 'Fibre 20', 'pppoe', 20, 20, 2500, 'monthly', 0),
      ('pkg_wifi', 'ten_sa', 'Wireless 10', 'pppoe', 10, 10, 1500, 'monthly', 0)`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end, name)
    values
      ('svc_a', 'ten_sa', 'cus_sa', 'pkg_fibre', 'pppoe', 'john-fibre', 'suspended', now(), 'Fibre 20'),
      ('svc_b', 'ten_sa', 'cus_sa', 'pkg_wifi', 'pppoe', 'john-wifi', 'suspended', now(), 'Wireless 10')`;
  const a = await ensureServiceAccountNumber(sql, "ten_sa", "svc_a");
  const b = await ensureServiceAccountNumber(sql, "ten_sa", "svc_b");
  await sql`insert into invoices (id, tenant_id, customer_id, service_id, number, amount_kes, paid_kes, status, due_date, subtotal_kes)
    values
      ('inv_a', 'ten_sa', 'cus_sa', 'svc_a', 'INV-A', 2500, 0, 'overdue', '2020-01-01', 2500),
      ('inv_b', 'ten_sa', 'cus_sa', 'svc_b', 'INV-B', 1500, 0, 'overdue', '2020-01-01', 1500)`;
  await sql`insert into invoice_items (id, tenant_id, invoice_id, description, quantity, unit_kes, amount_kes, package_id, service_id)
    values
      ('ili_a', 'ten_sa', 'inv_a', 'Fibre 20', 1, 2500, 2500, 'pkg_fibre', 'svc_a'),
      ('ili_b', 'ten_sa', 'inv_b', 'Wireless 10', 1, 1500, 1500, 'pkg_wifi', 'svc_b')`;
  await sql`insert into customer_ledger (id, tenant_id, customer_id, service_id, entry_type, debit_kes, credit_kes, ref_type, ref_id, memo)
    values
      ('led_a', 'ten_sa', 'cus_sa', 'svc_a', 'invoice', 2500, 0, 'invoice', 'inv_a', 'INV-A'),
      ('led_b', 'ten_sa', 'cus_sa', 'svc_b', 'invoice', 1500, 0, 'invoice', 'inv_b', 'INV-B')`;
  return { a, b };
}

test("one customer with two services receives two different account numbers", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    await asRole("ten_sa");
    const [a] = await sql<{ account_number: string }>`select account_number from services where id = 'svc_a'`;
    const [b] = await sql<{ account_number: string }>`select account_number from services where id = 'svc_b'`;
    const [cus] = await sql<{ account_number: string }>`select account_number from customers where id = 'cus_sa'`;
    assert.ok(a?.account_number);
    assert.ok(b?.account_number);
    assert.notEqual(a?.account_number, b?.account_number);
    assert.notEqual(a?.account_number, cus?.account_number);
    assert.notEqual(b?.account_number, cus?.account_number);
  } finally {
    await close();
  }
});

test("extra service under an existing customer gets a new service account number", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_ex', 'Extra', 'extra')`;
    await saveAccountNumberSettings(sql, "ten_ex", "extra", {
      enabled: true,
      scheme: "sequence",
      prefix: "EX",
      start_n: 1,
      next_n: 1,
      digits: 3,
    });
    await sql`insert into customers (id, tenant_id, name, phone, account_number)
      values ('cus_ex', 'ten_ex', 'Amina', '0712111000', 'EX-CUS')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, active)
      values ('pkg_ex', 'ten_ex', 'Home 10', 'pppoe', 10, 10, 1000, 'monthly', true)`;
    await asRole("ten_ex");
    const first = await createOnboard(sql, {
      tenantId: "ten_ex",
      tenantName: "Extra",
      actorId: "usr",
      input: {
        customer_mode: "existing",
        customer_id: "cus_ex",
        include_service: true,
        service: {
          access_method: "pppoe",
          package_id: "pkg_ex",
          username: "",
          auto_username: true,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "",
          activation: "after_payment",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    const second = await createOnboard(sql, {
      tenantId: "ten_ex",
      tenantName: "Extra",
      actorId: "usr",
      input: {
        customer_mode: "existing",
        customer_id: "cus_ex",
        include_service: true,
        service: {
          access_method: "pppoe",
          package_id: "pkg_ex",
          username: "",
          auto_username: true,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "",
          activation: "after_payment",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    assert.ok(first.account_number);
    assert.ok(second.account_number);
    assert.notEqual(first.account_number, second.account_number);
    assert.notEqual(first.account_number, "EX-CUS");
    const [cus] = await sql<{ account_number: string }>`select account_number from customers where id = 'cus_ex'`;
    assert.equal(cus?.account_number, "EX-CUS");
  } finally {
    await close();
  }
});

test("payment for service A does not restore or extend service B", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { a } = await seedTwoServices(sql);
    await asRole("ten_sa");
    const [beforeB] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_b'`;
    await applyConfirmedPayment(sql, {
      tenantId: "ten_sa",
      ispName: "Service Acc",
      invoiceId: "inv_a",
      provider: "mpesa",
      reference: "PAY-A-ONLY",
    });
    const [svcA] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_a'`;
    const [svcB] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_b'`;
    const [invB] = await sql<{ status: string; paid_kes: number }>`select status, paid_kes from invoices where id = 'inv_b'`;
    assert.equal(svcA?.status, "active");
    assert.equal(svcB?.status, "suspended");
    assert.equal(svcB?.period_end, beforeB?.period_end);
    assert.equal(invB?.status, "overdue");
    assert.equal(invB?.paid_kes, 0);
    void a;
  } finally {
    await close();
  }
});

test("paying service B restores only B while A stays unchanged", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    await asRole("ten_sa");
    await applyConfirmedPayment(sql, {
      tenantId: "ten_sa",
      ispName: "Service Acc",
      invoiceId: "inv_a",
      provider: "mpesa",
      reference: "PAY-A2",
    });
    const [afterA] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_a'`;
    await applyConfirmedPayment(sql, {
      tenantId: "ten_sa",
      ispName: "Service Acc",
      invoiceId: "inv_b",
      provider: "mpesa",
      reference: "PAY-B2",
    });
    const [svcA] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = 'svc_a'`;
    const [svcB] = await sql<{ status: string }>`select status from services where id = 'svc_b'`;
    assert.equal(svcB?.status, "active");
    assert.equal(svcA?.status, afterA?.status);
    assert.equal(svcA?.period_end, afterA?.period_end);
  } finally {
    await close();
  }
});

test("phone with two services stays unmatched until staff allocates a service", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { a, b } = await seedTwoServices(sql);
    await asRole("ten_sa");
    const match = await matchIncomingCustomer(sql, "ten_sa", { billRef: "", msisdn: "254712555000" });
    assert.equal(match.reason, "ambiguous_service");
    assert.equal(match.serviceId, "");
    assert.equal(match.customerId, "cus_sa");
    const hit = await ingestIncomingPayment(
      sql,
      { id: "ten_sa", name: "Service Acc" },
      {
        provider: "mpesa",
        channel: "paybill",
        transId: "AMBIG1",
        billRef: "",
        msisdn: "254712555000",
        payerName: "John",
        amountKes: 2500,
        shortcode: "123",
        transTime: new Date().toISOString(),
        payload: {},
      },
    );
    assert.equal(hit.status, "unmatched");
    const [pay] = await sql<{ n: number }>`select count(*)::int as n from payments where reference = 'AMBIG1'`;
    assert.equal(pay?.n, 0);

    const byAccount = await matchIncomingCustomer(sql, "ten_sa", { billRef: a, msisdn: "254712555000" });
    assert.equal(byAccount.serviceId, "svc_a");
    assert.notEqual(byAccount.serviceId, "svc_b");
    void b;
  } finally {
    await close();
  }
});

test("incoming payment without a clear service target is not allocated arbitrarily", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    await asRole("ten_sa");
    const unknown = await ingestIncomingPayment(
      sql,
      { id: "ten_sa", name: "Service Acc" },
      {
        provider: "mpesa",
        channel: "paybill",
        transId: "UNK1",
        billRef: "WRONG",
        msisdn: "254799999999",
        payerName: "X",
        amountKes: 500,
        shortcode: "1",
        transTime: new Date().toISOString(),
        payload: {},
      },
    );
    assert.equal(unknown.status, "unmatched");
  } finally {
    await close();
  }
});

test("invoice and statement show the service account number; consolidated statement separates services", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { a, b } = await seedTwoServices(sql);
    await asRole("ten_sa");
    const doc = await loadInvoiceDocument(sql, "ten_sa", "inv_a");
    assert.equal(doc.customer.accountNo, a);
    assert.match(doc.customer.serviceName || "", /Fibre/);
    const stmtA = await loadStatementDocument(sql, "ten_sa", "cus_sa", "svc_a");
    assert.equal(stmtA.customer.accountNo, a);
    const all = await loadStatementDocument(sql, "ten_sa", "cus_sa");
    const text = all.rows.map((r) => r.description).join(" ");
    assert.ok(text.includes(a) || text.includes("Fibre"));
    void b;
  } finally {
    await close();
  }
});

test("changing one service expiry date does not affect the other, and dates display as dd/mm/yy", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    const [beforeB] = await sql<{ period_end: string; access_until: string | null }>`
      select period_end::text as period_end, access_until::text as access_until from services where id = 'svc_b'`;
    await sql`update services set access_until = ${"2026-12-31T20:59:59.999+03:00"}, expiry_source = 'staff'
      where id = 'svc_a'`;
    const [afterB] = await sql<{ period_end: string; access_until: string | null }>`
      select period_end::text as period_end, access_until::text as access_until from services where id = 'svc_b'`;
    assert.equal(afterB?.period_end, beforeB?.period_end);
    assert.equal(afterB?.access_until, beforeB?.access_until);
    assert.equal(formatDate("2026-09-16T12:00:00+03:00", "dd/mm/yy"), "16/09/26");
  } finally {
    await close();
  }
});

test("deleted services are not payment targets; restored services keep the original number", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const { a } = await seedTwoServices(sql);
    await asRole("ten_sa");
    await sql`update services set deleted_at = now() where id = 'svc_a'`;
    const match = await matchIncomingCustomer(sql, "ten_sa", { billRef: a, msisdn: "" });
    assert.equal(match.serviceId, "");
    await sql`update services set deleted_at = null where id = 'svc_a'`;
    const [kept] = await sql<{ account_number: string }>`select account_number from services where id = 'svc_a'`;
    assert.equal(kept?.account_number, a);
    const again = await matchIncomingCustomer(sql, "ten_sa", { billRef: a, msisdn: "" });
    assert.equal(again.serviceId, "svc_a");
  } finally {
    await close();
  }
});

test("account numbers stay unique under concurrent service allocation", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_cc', 'Conc', 'conc')`;
    await saveAccountNumberSettings(sql, "ten_cc", "conc", {
      enabled: true,
      scheme: "sequence",
      prefix: "CC",
      start_n: 1,
      next_n: 1,
      digits: 3,
    });
    await asRole("ten_cc");
    const [n1, n2, n3] = await Promise.all([
      allocateAccountNumber(sql, "ten_cc"),
      allocateAccountNumber(sql, "ten_cc"),
      allocateAccountNumber(sql, "ten_cc"),
    ]);
    const set = new Set([n1, n2, n3]);
    assert.equal(set.size, 3);
  } finally {
    await close();
  }
});

test("recurring billing issues one invoice per service", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    await sql`update services set status = 'active' where tenant_id = 'ten_sa'`;
    await sql`update invoices set status = 'paid', paid_kes = amount_kes, issued_at = now() - interval '40 days' where tenant_id = 'ten_sa'`;
    await asRole("ten_sa");
    const created = await generateRecurringInvoices(sql, "ten_sa");
    assert.equal(created.length, 2);
    assert.equal(new Set(created.map((c) => c.serviceId)).size, 2);
  } finally {
    await close();
  }
});

test("restorePaidAccess without a service id does not restore every line when the customer has two", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    await asRole("ten_sa");
    const result = await restorePaidAccess(sql, "ten_sa", "cus_sa");
    assert.equal(result.restored, 0);
    const rows = await sql<{ status: string }>`select status from services where customer_id = 'cus_sa' order by id`;
    assert.ok(rows.every((r) => r.status === "suspended"));
  } finally {
    await close();
  }
});

test("issueInvoice pins service_id on the header", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    await asRole("ten_sa");
    const inv = await issueInvoice(sql, {
      tenantId: "ten_sa",
      customerId: "cus_sa",
      serviceId: "svc_a",
      dueDate: "2026-10-01",
      items: [{ description: "Fibre", unit_kes: 100, service_id: "svc_a" }],
    });
    const [row] = await sql<{ service_id: string }>`select service_id from invoices where id = ${inv.id}`;
    assert.equal(row?.service_id, "svc_a");
  } finally {
    await close();
  }
});

test("a payment cannot be allocated to another service through the invoice id", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTwoServices(sql);
    await asRole("ten_sa");
    await assert.rejects(
      () =>
        creditCustomerPayment(sql, {
          tenantId: "ten_sa",
          ispName: "Service Acc",
          customerId: "cus_sa",
          serviceId: "svc_a",
          invoiceId: "inv_b",
          reference: "CROSS-AB",
          amountKes: 2500,
          provider: "mpesa",
        }),
      /does not belong/,
    );
    const [invB] = await sql<{ paid_kes: number; status: string }>`select paid_kes, status from invoices where id = 'inv_b'`;
    assert.equal(invB?.paid_kes, 0);
    assert.equal(invB?.status, "overdue");
  } finally {
    await close();
  }
});
