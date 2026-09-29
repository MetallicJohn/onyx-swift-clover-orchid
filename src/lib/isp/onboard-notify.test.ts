import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, setActiveDateFormat } from "./display.ts";
import { nairobiDate } from "./empty-tenant.ts";
import {
  buildServiceNotifyVars,
  notifyCustomerEvent,
  notifyQuietly,
  notifyServiceCreationInvoice,
  renderNotifyTemplate,
  shouldSendInvoiceSms,
} from "./notifications.ts";
import { createOnboard } from "./onboard-create.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug, support_phone) values ('ten_n', 'IMANI NETWORKS', 'imani', '0700000000')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, validity_hours, active)
    values
      ('pkg_home', 'ten_n', 'Fibre 20 Mbps', 'pppoe', 20, 20, 2000, 'monthly', 0, true),
      ('pkg_b', 'ten_n', 'Office 40', 'pppoe', 40, 40, 4000, 'monthly', 0, true)`;
  await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, till_number, stk_type)
    values ('prv_n', 'ten_n', 'mpesa', 'M-Pesa', true, true, '123456', 'paybill')`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
    values ('cus_n', 'ten_n', 'John', '0712000111', 'john@example.com', 'IMN-C-1')`;
}

test("dates display as dd/mm/yy and templates keep paybill plus service account", () => {
  setActiveDateFormat("dd/mm/yy");
  assert.equal(formatDate("2026-09-16"), "16/09/26");
  assert.equal(formatDate("2026-10-16"), "16/10/26");
  const awaiting = renderNotifyTemplate(
    "Dear {{customer_name}}, your {{service_name}} service has been created. Service account: {{service_account_number}}. Please pay Ksh {{amount_due}} via Paybill {{paybill_number}}, Account {{service_account_number}}. Your service will activate after payment. {{company_name}}",
    {
      customer_name: "John",
      service_name: "Fibre 20 Mbps",
      service_account_number: "IMN-S-000123",
      amount_due: "2,000",
      paybill_number: "123456",
      company_name: "IMANI NETWORKS",
    },
  );
  assert.match(awaiting, /Paybill 123456/);
  assert.match(awaiting, /Account IMN-S-000123/);
  assert.doesNotMatch(awaiting, /is now active/i);
  const active = renderNotifyTemplate(
    "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} is now active until {{service_expiry_date}}. Pay Ksh {{amount_due}} via Paybill {{paybill_number}}, Account {{service_account_number}}. Thank you, {{company_name}}",
    {
      customer_name: "John",
      service_name: "Fibre 20 Mbps",
      service_account_number: "IMN-S-000123",
      service_expiry_date: "16/10/26",
      amount_due: "2,000",
      paybill_number: "123456",
      company_name: "IMANI NETWORKS",
    },
  );
  assert.match(active, /is now active until 16\/10\/26/);
  assert.match(active, /Paybill 123456/);
});

test("awaiting-payment create defaults expiry to today, stays pending, and does not claim active", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_n");
    const created = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_n",
        include_service: true,
        service: {
          name: "Fibre 20 Mbps",
          access_method: "pppoe",
          package_id: "pkg_home",
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
    assert.equal(created.status, "pending");
    assert.equal(created.activation, "after_payment");
    const [svc] = await sql<{ status: string; suspend_reason: string; period_end: string }>`
      select status, suspend_reason, period_end::text as period_end from services where id = ${created.service_id}`;
    assert.equal(svc?.status, "pending");
    assert.equal(svc?.suspend_reason, "awaiting_payment");
    assert.equal(nairobiDate(svc?.period_end || ""), nairobiDate());
    const logs = await sql<{ event_code: string; body: string }>`
      select event_code, body from notification_logs where tenant_id = 'ten_n' and entity_id = ${created.service_id}`;
    assert.ok(logs.some((l) => l.event_code === "service.created.awaiting_payment"));
    assert.ok(!logs.some((l) => l.event_code === "service.created.active"));
    const sms = logs.find((l) => l.event_code === "service.created.awaiting_payment");
    assert.match(sms?.body || "", /Paybill 123456/);
    assert.match(sms?.body || "", new RegExp(created.account_number));
    assert.doesNotMatch(sms?.body || "", /is now active/i);
    const [rad] = await sql<{ enabled: boolean }>`
      select enabled from radius_accounts where service_id = ${created.service_id}`;
    assert.equal(rad?.enabled, false);
  } finally {
    await close();
  }
});

test("start as active defaults expiry to today plus 30 days and sends the active-until SMS", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_n");
    const created = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_n",
        include_service: true,
        service: {
          name: "Fibre 20 Mbps",
          access_method: "pppoe",
          package_id: "pkg_home",
          username: "",
          auto_username: true,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    assert.equal(created.status, "active");
    const [svc] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = ${created.service_id}`;
    assert.equal(svc?.status, "active");
    const end = nairobiDate(svc?.period_end || "");
    const today = nairobiDate();
    assert.ok(end > today);
    const logs = await sql<{ event_code: string; body: string }>`
      select event_code, body from notification_logs where tenant_id = 'ten_n' and entity_id = ${created.service_id}`;
    assert.ok(logs.some((l) => l.event_code === "service.created.active"));
    assert.ok(!logs.some((l) => l.event_code === "service.created.awaiting_payment"));
    const sms = logs.find((l) => l.event_code === "service.created.active");
    assert.match(sms?.body || "", /is now active until/i);
    assert.match(sms?.body || "", /Paybill 123456/);
    assert.match(sms?.body || "", new RegExp(created.account_number));
    setActiveDateFormat("dd/mm/yy");
    assert.match(sms?.body || "", /\d{2}\/\d{2}\/\d{2}/);
  } finally {
    await close();
  }
});

test("payment for an awaiting service activates it and does not touch a second line", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_n");
    const first = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_n",
        include_service: true,
        service: {
          access_method: "pppoe",
          package_id: "pkg_home",
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
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_n",
        include_service: true,
        service: {
          access_method: "pppoe",
          package_id: "pkg_b",
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
    const [beforeB] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = ${second.service_id}`;
    await applyConfirmedPayment(sql, {
      tenantId: "ten_n",
      ispName: "IMANI NETWORKS",
      invoiceId: first.invoice_id!,
      provider: "mpesa",
      reference: "PAY-AWAIT-1",
    });
    const [liveA] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = ${first.service_id}`;
    const [liveB] = await sql<{ status: string; period_end: string }>`
      select status, period_end::text as period_end from services where id = ${second.service_id}`;
    assert.equal(liveA?.status, "active");
    assert.equal(liveA?.suspend_reason, "");
    assert.equal(liveB?.status, "pending");
    assert.equal(liveB?.period_end, beforeB?.period_end);

    const payLogs = await sql<{ event_code: string; n: number }>`
      select event_code, count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and event_code in ('payment.received','payment.received.awaiting','service.activated','service.restored')
      group by event_code`;
    const count = (code: string) => payLogs.find((r) => r.event_code === code)?.n ?? 0;
    assert.equal(count("payment.received.awaiting"), 1);
    assert.equal(count("service.activated"), 1);
    assert.equal(count("payment.received"), 0);
    assert.equal(count("service.restored"), 0);

    await assert.rejects(
      () =>
        applyConfirmedPayment(sql, {
          tenantId: "ten_n",
          ispName: "IMANI NETWORKS",
          invoiceId: first.invoice_id!,
          provider: "mpesa",
          reference: "PAY-AWAIT-1",
        }),
      /Duplicate payment reference/,
    );
    const afterDup = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and event_code in ('payment.received.awaiting','service.activated')`;
    assert.equal(afterDup[0]?.n, 2);
  } finally {
    await close();
  }
});

test("payment on an already-active service does not send activation SMS", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_n");
    const created = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_n",
        include_service: true,
        service: {
          access_method: "pppoe",
          package_id: "pkg_home",
          username: "",
          auto_username: true,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
        },
      },
    });
    assert.ok(created.invoice_id);
    await applyConfirmedPayment(sql, {
      tenantId: "ten_n",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-ACTIVE-1",
    });
    const [live] = await sql<{ status: string }>`select status from services where id = ${created.service_id}`;
    assert.equal(live?.status, "active");
    const logs = await sql<{ event_code: string }>`
      select event_code from notification_logs
      where tenant_id = 'ten_n' and event_code in ('payment.received','payment.received.awaiting','service.activated','service.restored')`;
    assert.ok(logs.some((l) => l.event_code === "payment.received"));
    assert.ok(!logs.some((l) => l.event_code === "service.activated"));
    assert.ok(!logs.some((l) => l.event_code === "payment.received.awaiting"));
  } finally {
    await close();
  }
});

test("missing paybill is safe and failed SMS does not reverse create", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`update payment_providers set till_number = '' where tenant_id = 'ten_n'`;
    await asRole("ten_n");
    const created = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      canActivateNow: false,
      input: {
        customer_mode: "new",
        include_service: true,
        customer: {
          name: "Mercy Achieng",
          phone: "0712555111",
          email: "",
          address: "",
          type: "individual",
          tag_ids: [],
          account_number: "",
          notes: "",
          portal_password: "",
        },
        service: {
          access_method: "pppoe",
          package_id: "pkg_home",
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
    assert.ok(created.customer_id);
    assert.ok(created.service_id);
    const vars = await buildServiceNotifyVars(sql, "ten_n", "IMANI NETWORKS", {
      customerId: created.customer_id,
      serviceId: created.service_id,
      amountKes: 2000,
    });
    assert.equal(vars.paybill_number, "");
    assert.ok(vars.account_instructions);
    await notifyQuietly(sql, "ten_n", "IMANI NETWORKS", created.customer_id, "service.created.awaiting_payment", `${created.service_id}-retry`, vars);
    const [still] = await sql<{ id: string; status: string }>`select id, status from services where id = ${created.service_id}`;
    assert.equal(still?.status, "pending");

    await assert.rejects(
      () =>
        createOnboard(sql, {
          tenantId: "ten_n",
          tenantName: "IMANI NETWORKS",
          actorId: "usr_staff",
          canActivateNow: false,
          input: {
            customer_mode: "existing",
            customer_id: "cus_n",
            include_service: true,
            service: {
              access_method: "pppoe",
              package_id: "pkg_home",
              username: "",
              auto_username: true,
              static_ip: "",
              pool_id: "",
              router_id: "",
              mac_address: "",
              cpe_id: "",
              expiry_ymd: "",
              activation: "active",
              notes: "",
              hotspot_mode: "account",
            },
          },
        }),
      /authorised staff/,
    );
  } finally {
    await close();
  }
});

test("partial payment does not activate an awaiting service or send an active SMS", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_n");
    const created = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: {
        customer_mode: "existing",
        customer_id: "cus_n",
        include_service: true,
        service: {
          access_method: "pppoe",
          package_id: "pkg_home",
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
    await applyConfirmedPayment(sql, {
      tenantId: "ten_n",
      ispName: "IMANI NETWORKS",
      invoiceId: created.invoice_id!,
      provider: "mpesa",
      reference: "PAY-PARTIAL-1",
      amountKes: 1,
    });
    const [live] = await sql<{ status: string; suspend_reason: string }>`
      select status, suspend_reason from services where id = ${created.service_id}`;
    assert.equal(live?.status, "pending");
    assert.equal(live?.suspend_reason, "awaiting_payment");
    const logs = await sql<{ event_code: string }>`
      select event_code from notification_logs
      where tenant_id = 'ten_n' and event_code in ('service.activated','payment.received.awaiting')`;
    assert.ok(!logs.some((l) => l.event_code === "service.activated"));
  } finally {
    await close();
  }
});

test("service-creation invoice SMS is only for business customers", () => {
  assert.equal(shouldSendInvoiceSms({ type: "individual" }), false);
  assert.equal(shouldSendInvoiceSms({ type: "business" }), true);
  assert.equal(shouldSendInvoiceSms({ type: "residential" }), false);
  assert.equal(shouldSendInvoiceSms({ type: "" }), false);
  assert.equal(shouldSendInvoiceSms(null), false);
  assert.equal(shouldSendInvoiceSms(undefined), false);
});

test("individual service creation sends the service SMS only; business still gets the invoice SMS", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`insert into customers (id, tenant_id, name, phone, email, account_number, type)
      values ('cus_biz', 'ten_n', 'Acme Ltd', '0712000222', 'acme@example.com', 'IMN-C-2', 'business')`;
    await asRole("ten_n");
    const service = {
      access_method: "pppoe" as const,
      package_id: "pkg_home",
      username: "",
      auto_username: true,
      static_ip: "",
      pool_id: "",
      router_id: "",
      mac_address: "",
      cpe_id: "",
      expiry_ymd: "",
      activation: "after_payment" as const,
      notes: "",
      hotspot_mode: "account" as const,
    };
    const home = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: { customer_mode: "existing", customer_id: "cus_n", include_service: true, service },
    });
    const biz = await createOnboard(sql, {
      tenantId: "ten_n",
      tenantName: "IMANI NETWORKS",
      actorId: "usr_staff",
      input: { customer_mode: "existing", customer_id: "cus_biz", include_service: true, service },
    });
    assert.ok(home.invoice_id);
    assert.ok(biz.invoice_id);
    assert.ok(home.service_id);
    assert.ok(biz.service_id);
    const invoices = await sql<{ id: string; customer_id: string; amount_kes: number }>`
      select id, customer_id, amount_kes from invoices where tenant_id = 'ten_n' and id in (${home.invoice_id}, ${biz.invoice_id})`;
    assert.equal(invoices.length, 2);
    assert.ok(invoices.every((row) => row.amount_kes === 2000));

    const homeService = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and event_code = 'service.created.awaiting_payment' and entity_id = ${home.service_id} and channel = 'sms'`;
    const homeInvoice = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and customer_id = 'cus_n' and event_code = 'invoice.created'`;
    const skipped = await sql<{ status: string; subject: string; destination: string; body: string }>`
      select status, subject, destination, body from notification_logs
      where tenant_id = 'ten_n' and customer_id = 'cus_n' and event_code = 'invoice.sms.skipped' and entity_id = ${home.invoice_id}`;
    assert.equal(homeService[0]?.n, 1);
    assert.equal(homeInvoice[0]?.n, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]?.status, "skipped");
    assert.equal(skipped[0]?.destination, "");
    assert.match(skipped[0]?.subject || "", /not sent/i);
    assert.match(skipped[0]?.body || "", /individual customer/);
    const [audit] = await sql<{ details: string }>`
      select details from audit_logs
      where tenant_id = 'ten_n' and action = 'invoice.sms.skipped' and entity_id = ${home.service_id}`;
    assert.equal(audit?.details, "Not sent — individual customer");

    const bizService = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and event_code = 'service.created.awaiting_payment' and entity_id = ${biz.service_id} and channel = 'sms'`;
    const bizInvoiceSms = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and customer_id = 'cus_biz' and event_code = 'invoice.created' and channel = 'sms'`;
    const bizSkip = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and customer_id = 'cus_biz' and event_code = 'invoice.sms.skipped'`;
    assert.equal(bizService[0]?.n, 1);
    assert.equal(bizInvoiceSms[0]?.n, 1);
    assert.equal(bizSkip[0]?.n, 0);

    const vars = await buildServiceNotifyVars(sql, "ten_n", "IMANI NETWORKS", {
      customerId: home.customer_id,
      serviceId: home.service_id,
      amountKes: 2000,
    });
    await notifyQuietly(sql, "ten_n", "IMANI NETWORKS", home.customer_id, "service.created.awaiting_payment", home.service_id, vars);
    await notifyServiceCreationInvoice(sql, {
      tenantId: "ten_n",
      ispName: "IMANI NETWORKS",
      customerId: home.customer_id,
      invoiceId: home.invoice_id,
      serviceId: home.service_id,
      actorId: "usr_staff",
      vars: { customer_name: "", invoice_number: "INV", amount: "KES 2000", due_date: "2026-09-29" },
    });
    await notifyQuietly(sql, "ten_n", "IMANI NETWORKS", biz.customer_id, "invoice.created", biz.invoice_id, {
      customer_name: "",
      invoice_number: "INV",
      amount: "KES 2000",
      due_date: "2026-09-29",
    });
    const homeServiceAgain = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and event_code = 'service.created.awaiting_payment' and entity_id = ${home.service_id} and channel = 'sms'`;
    const skippedAgain = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and event_code = 'invoice.sms.skipped' and entity_id = ${home.invoice_id}`;
    const bizInvoiceAgain = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_n' and customer_id = 'cus_biz' and event_code = 'invoice.created' and channel = 'sms'`;
    assert.equal(homeServiceAgain[0]?.n, 1);
    assert.equal(skippedAgain[0]?.n, 1);
    assert.equal(bizInvoiceAgain[0]?.n, 1);

    const due = await notifyCustomerEvent(sql, "ten_n", "IMANI NETWORKS", home.customer_id, "invoice.due", home.invoice_id, {
      customer_name: "",
      invoice_number: "INV",
      amount: "KES 2000",
      due_date: "2026-09-29",
    });
    assert.ok(due >= 1);
    const manual = await notifyCustomerEvent(sql, "ten_n", "IMANI NETWORKS", home.customer_id, "invoice.created", home.invoice_id, {
      customer_name: "",
      invoice_number: "INV",
      amount: "KES 2000",
      due_date: "2026-09-29",
    });
    assert.ok(manual >= 1);
    const manualAgain = await notifyCustomerEvent(sql, "ten_n", "IMANI NETWORKS", home.customer_id, "invoice.created", home.invoice_id, {
      customer_name: "",
      invoice_number: "INV",
      amount: "KES 2000",
      due_date: "2026-09-29",
    });
    assert.equal(manualAgain, 0);
  } finally {
    await close();
  }
});
