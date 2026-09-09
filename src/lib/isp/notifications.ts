import { nid } from "../utils.ts";
import { generateRecurringInvoices, issueInvoice } from "./billing";
import { queueEmail, writeInbox } from "./inbox";
import { channelAllowed, deliverChannel, getMessagingSettings } from "./messaging";
import type { BillingEvent, NotifyChannel } from "./types";

export type { BillingEvent, NotifyChannel };

type Sql = {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

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
    channel: "in_app",
    subject: "Payment received",
    body: "We received {amount} (ref {payment_reference}) for {invoice_number}. Your service is active.",
  },
  {
    event_code: "payment.received",
    channel: "whatsapp",
    subject: "Payment received",
    body: "Hi {customer_name}, we received {amount} (ref {payment_reference}) for {invoice_number}. Your service is active. — {isp_name}",
  },
  {
    event_code: "service.restored",
    channel: "whatsapp",
    subject: "Service restored",
    body: "{customer_name}, {service_name} is back online after payment {payment_reference}. — {isp_name}",
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
    event_code: "service.suspended",
    channel: "in_app",
    subject: "Service suspended",
    body: "{customer_name} / {service_name} suspended after unpaid {invoice_number}.",
  },
];

function render(template: string, vars: NotifyVars) {
  return template.replace(/\{([a-z_]+)\}/g, (_, key: keyof NotifyVars) => vars[key] ?? "");
}

export async function ensureNotificationSchema(_sql: Sql) {
  /* schema: migrations/0003_notifications.sql */
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
  const settings = await getMessagingSettings(sql, opts.tenantId);
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
    if (!channelAllowed(opts.event, tpl.channel, settings)) continue;
    const subject = render(tpl.subject, vars);
    const body = render(tpl.body, vars);
    const dest = destinationFor(tpl.channel, opts.phone ?? "", opts.email ?? "");
    const dup = await sql<{ id: string }>`
      select id from notification_logs
      where tenant_id = ${opts.tenantId} and event_code = ${opts.event} and entity_id = ${opts.entityId} and channel = ${tpl.channel}`;
    if (dup[0]) continue;
    let delivery = { status: "sent", detail: dest };
    if (tpl.channel === "sms" || tpl.channel === "whatsapp") {
      delivery = await deliverChannel(settings, tpl.channel, dest, body);
    } else if (tpl.channel === "email") {
      delivery = await queueEmail(sql, opts.tenantId, dest, subject, body);
    } else if (tpl.channel === "in_app" && opts.customerId) {
      await writeInbox(sql, opts.tenantId, opts.customerId, subject, body, opts.event);
      delivery = { status: "sent", detail: "inbox" };
    }
    await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
      values (${nid("ntf")}, ${opts.tenantId}, ${opts.customerId}, ${opts.event}, ${tpl.channel}, ${opts.entityId}, ${subject}, ${body}, ${delivery.detail || dest}, ${delivery.status})`;
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
  const issued = await generateRecurringInvoices(sql, tenantId, async (customerId, amountKes, dueDate) => {
    const inv = await issueInvoice(sql, { tenantId, customerId, amountKes, dueDate });
    await notifyCustomerEvent(sql, tenantId, ispName, customerId, "invoice.created", inv.id, {
      customer_name: "",
      invoice_number: inv.number,
      amount: `KES ${amountKes}`,
      due_date: dueDate,
    });
  });
  const { applyAccessPolicy } = await import("./access-policy.ts");
  const access = await applyAccessPolicy(sql, tenantId, ispName);
  return { issued, ...access };
}
