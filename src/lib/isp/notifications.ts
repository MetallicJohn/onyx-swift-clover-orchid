import { nid } from "@/lib/utils";

type Sql = {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type NotifyChannel = "sms" | "whatsapp" | "email" | "in_app";

export type BillingEvent =
  | "invoice.created"
  | "invoice.due"
  | "invoice.overdue"
  | "payment.received"
  | "grace.started"
  | "service.suspended"
  | "service.restored";

export type NotifyVars = {
  customer_name: string;
  invoice_number?: string;
  amount?: string;
  due_date?: string;
  service_name?: string;
  payment_reference?: string;
  isp_name?: string;
};

const DEFAULTS: Array<{
  event_code: BillingEvent;
  channel: NotifyChannel;
  subject: string;
  body: string;
}> = [
  {
    event_code: "invoice.created",
    channel: "sms",
    subject: "Invoice issued",
    body: "Hi {customer_name}, {isp_name} issued {invoice_number} for {amount}. Due {due_date}. Pay via M-Pesa to stay online.",
  },
  {
    event_code: "invoice.created",
    channel: "email",
    subject: "Invoice {invoice_number} from {isp_name}",
    body: "Hello {customer_name},\n\nInvoice {invoice_number} for {amount} is due on {due_date}.\nPay by M-Pesa to avoid service interruption.\n\n{isp_name}",
  },
  {
    event_code: "invoice.due",
    channel: "sms",
    subject: "Invoice due today",
    body: "{customer_name}, {invoice_number} of {amount} is due today. Pay now to avoid grace/suspension. — {isp_name}",
  },
  {
    event_code: "invoice.overdue",
    channel: "sms",
    subject: "Invoice overdue",
    body: "{customer_name}, {invoice_number} ({amount}) is overdue. Pay today or service may enter grace. — {isp_name}",
  },
  {
    event_code: "invoice.overdue",
    channel: "whatsapp",
    subject: "Overdue invoice",
    body: "Hi {customer_name}, your {isp_name} invoice {invoice_number} of {amount} is overdue (due {due_date}). Pay via M-Pesa to keep your connection.",
  },
  {
    event_code: "payment.received",
    channel: "sms",
    subject: "Payment received",
    body: "Payment {payment_reference} of {amount} received. Thank you {customer_name}. Service is active. — {isp_name}",
  },
  {
    event_code: "payment.received",
    channel: "email",
    subject: "Receipt {payment_reference}",
    body: "Hi {customer_name},\n\nWe received {amount} (ref {payment_reference}) for {invoice_number}. Your service has been restored/confirmed.\n\n{isp_name}",
  },
  {
    event_code: "grace.started",
    channel: "sms",
    subject: "Grace period",
    body: "{customer_name}, your {service_name} is now on grace after unpaid {invoice_number}. Pay {amount} to avoid suspension. — {isp_name}",
  },
  {
    event_code: "service.suspended",
    channel: "sms",
    subject: "Service suspended",
    body: "{customer_name}, {service_name} is suspended for non-payment of {invoice_number} ({amount}). Pay to restore instantly. — {isp_name}",
  },
  {
    event_code: "service.restored",
    channel: "sms",
    subject: "Service restored",
    body: "{customer_name}, {service_name} is back online after payment {payment_reference}. — {isp_name}",
  },
  {
    event_code: "invoice.created",
    channel: "in_app",
    subject: "Invoice issued",
    body: "{invoice_number} for {customer_name} ({amount}) issued, due {due_date}.",
  },
  {
    event_code: "payment.received",
    channel: "in_app",
    subject: "Payment received",
    body: "{customer_name} paid {amount} via {payment_reference}.",
  },
  {
    event_code: "service.suspended",
    channel: "in_app",
    subject: "Service suspended",
    body: "{customer_name} / {service_name} suspended after unpaid {invoice_number}.",
  },
];

function render(template: string, vars: NotifyVars) {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: keyof NotifyVars) => vars[key] ?? "");
}

export async function ensureNotificationSchema(sql: Sql) {
  await sql.query(
    `create table if not exists notification_templates (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      event_code text not null,
      channel text not null,
      subject text not null default '',
      body text not null,
      enabled boolean not null default true,
      unique (tenant_id, event_code, channel)
    )`,
  );
  await sql.query(
    `create table if not exists notification_logs (
      id text primary key,
      tenant_id text not null references tenants(id) on delete cascade,
      customer_id text,
      event_code text not null,
      channel text not null,
      entity_id text not null default '',
      subject text not null default '',
      body text not null,
      destination text not null default '',
      status text not null default 'sent',
      created_at timestamptz not null default now()
    )`,
  );
  await sql.query(
    `create index if not exists notification_templates_tenant_idx on notification_templates (tenant_id)`,
  );
  await sql.query(
    `create index if not exists notification_logs_tenant_idx on notification_logs (tenant_id, created_at desc)`,
  );
  await sql.query(
    `create unique index if not exists notification_logs_dedupe_idx
      on notification_logs (tenant_id, event_code, entity_id, channel)`,
  );
}

export async function ensureDefaultTemplates(sql: Sql, tenantId: string) {
  await ensureNotificationSchema(sql);
  for (const t of DEFAULTS) {
    const existing = await sql<{ id: string }>`
      select id from notification_templates
      where tenant_id = ${tenantId} and event_code = ${t.event_code} and channel = ${t.channel}`;
    if (existing[0]) continue;
    await sql`insert into notification_templates (id, tenant_id, event_code, channel, subject, body, enabled)
      values (${nid("tpl")}, ${tenantId}, ${t.event_code}, ${t.channel}, ${t.subject}, ${t.body}, true)`;
  }
}

function destinationFor(channel: string, phone: string, email: string) {
  if (channel === "email") return email || "no-email";
  if (channel === "in_app") return "console";
  return phone || "no-phone";
}

export async function dispatchNotification(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    event: BillingEvent;
    entityId: string;
    customerId: string | null;
    customerName: string;
    phone?: string;
    email?: string;
    vars: NotifyVars;
  },
) {
  await ensureDefaultTemplates(sql, opts.tenantId);
  const templates = await sql<{
    id: string;
    channel: NotifyChannel;
    subject: string;
    body: string;
    enabled: boolean;
  }>`select id, channel, subject, body, enabled from notification_templates
     where tenant_id = ${opts.tenantId} and event_code = ${opts.event} and enabled = true`;

  const vars: NotifyVars = { ...opts.vars, isp_name: opts.ispName, customer_name: opts.customerName };
  let sent = 0;

  for (const tpl of templates) {
    const subject = render(tpl.subject, vars);
    const body = render(tpl.body, vars);
    const dest = destinationFor(tpl.channel, opts.phone ?? "", opts.email ?? "");
    const dup = await sql<{ id: string }>`
      select id from notification_logs
      where tenant_id = ${opts.tenantId} and event_code = ${opts.event} and entity_id = ${opts.entityId} and channel = ${tpl.channel}`;
    if (dup[0]) continue;
    await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
      values (${nid("ntf")}, ${opts.tenantId}, ${opts.customerId}, ${opts.event}, ${tpl.channel}, ${opts.entityId}, ${subject}, ${body}, ${dest}, 'sent')`;
    sent += 1;
  }
  return sent;
}

export async function notifyCustomerEvent(
  sql: Sql,
  tenantId: string,
  ispName: string,
  customerId: string,
  event: BillingEvent,
  entityId: string,
  vars: NotifyVars,
) {
  const [c] = await sql<{ name: string; phone: string; email: string }>`
    select name, phone, email from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!c) return 0;
  return dispatchNotification(sql, {
    tenantId,
    ispName,
    event,
    entityId,
    customerId,
    customerName: c.name,
    phone: c.phone,
    email: c.email,
    vars: { ...vars, customer_name: c.name },
  });
}

export async function runBillingCycle(sql: Sql, tenantId: string, ispName: string) {
  const invoices = await sql<{
    id: string;
    customer_id: string;
    number: string;
    amount_kes: number;
    status: string;
    due_date: string;
  }>`select id, customer_id, number, amount_kes, status, due_date::text as due_date
     from invoices where tenant_id = ${tenantId} and status in ('issued','due','overdue')`;

  const today = new Date().toISOString().slice(0, 10);
  let due = 0;
  let overdue = 0;
  let grace = 0;
  let suspended = 0;
  let notices = 0;

  for (const inv of invoices) {
    const vars: NotifyVars = {
      customer_name: "",
      invoice_number: inv.number,
      amount: `KES ${inv.amount_kes}`,
      due_date: inv.due_date,
    };

    if (inv.due_date === today && inv.status === "issued") {
      await sql`update invoices set status = 'due' where id = ${inv.id} and tenant_id = ${tenantId}`;
      notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "invoice.due", inv.id, vars);
      due += 1;
    }

    if (inv.due_date < today && inv.status !== "overdue") {
      await sql`update invoices set status = 'overdue' where id = ${inv.id} and tenant_id = ${tenantId}`;
      notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "invoice.overdue", inv.id, vars);
      overdue += 1;
    } else if (inv.status === "overdue") {
      notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "invoice.overdue", inv.id, vars);
    }

    if (inv.due_date >= today) continue;

    const daysPast = Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 86400000);
    const services = await sql<{
      id: string;
      status: string;
      package_id: string;
      name: string;
      grace_days: number;
    }>`select s.id, s.status, s.package_id, p.name, p.grace_days
       from services s join packages p on p.id = s.package_id
       where s.tenant_id = ${tenantId} and s.customer_id = ${inv.customer_id} and s.status in ('active','grace')`;

    for (const svc of services) {
      const svcVars: NotifyVars = { ...vars, service_name: svc.name };
      if (daysPast <= svc.grace_days && svc.status === "active") {
        await sql`update services set status = 'grace' where id = ${svc.id} and tenant_id = ${tenantId}`;
        notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "grace.started", svc.id, svcVars);
        grace += 1;
      } else if (daysPast > svc.grace_days && svc.status !== "suspended") {
        await sql`update services set status = 'suspended' where id = ${svc.id} and tenant_id = ${tenantId}`;
        notices += await notifyCustomerEvent(
          sql,
          tenantId,
          ispName,
          inv.customer_id,
          "service.suspended",
          svc.id,
          svcVars,
        );
        suspended += 1;
      }
    }
  }

  return { due, overdue, grace, suspended, notices };
}
