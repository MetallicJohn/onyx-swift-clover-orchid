import { nid } from "../utils.ts";
import { formatSmsDate } from "./display.ts";
import { loadTenantDateFormat } from "./tenant-context.ts";
import { generateRecurringInvoices } from "./billing";
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
  amount_due?: string;
  due_date?: string;
  service_name?: string;
  service_account_number?: string;
  service_status?: string;
  service_expiry_date?: string;
  paybill_number?: string;
  account_instructions?: string;
  company_name?: string;
  support_contact?: string;
  grace_until?: string;
  renewal_date?: string;
  days?: string;
  payment_reference?: string;
  isp_name?: string;
  amount_received?: string;
  full_package_amount?: string;
  payment_percentage?: string;
  required_percentage?: string;
  minimum_payment_amount?: string;
  remaining_activation_amount?: string;
  validity_days?: string;
  outstanding_balance?: string;
  maximum_credit_amount?: string;
  available_credit?: string;
  current_period_amount?: string;
  receipt_number?: string;
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
    body: "Dear {{customer_name}}, we received Ksh {{amount_due}} (ref {{payment_reference}}) for account {{service_account_number}}. Thank you, {{company_name}}",
  },
  {
    event_code: "payment.received",
    channel: "in_app",
    subject: "Payment received",
    body: "We received {amount} (ref {payment_reference}) for {invoice_number}.",
  },
  {
    event_code: "payment.received",
    channel: "whatsapp",
    subject: "Payment received",
    body: "Hi {customer_name}, we received {amount} (ref {payment_reference}) for {invoice_number}. — {isp_name}",
  },
  {
    event_code: "payment.received",
    channel: "email",
    subject: "Receipt {payment_reference}",
    body: "Hi {customer_name},\n\nWe received {amount} (ref {payment_reference}) for {invoice_number}.\n\n{isp_name}",
  },
  {
    event_code: "payment.received.awaiting",
    channel: "sms",
    subject: "Payment received",
    body: "Dear {{customer_name}}, we received Ksh {{amount_due}} (ref {{payment_reference}}) for {{service_name}} account {{service_account_number}}. Your service is being activated. {{company_name}}",
  },
  {
    event_code: "customer.created",
    channel: "sms",
    subject: "Account created",
    body: "Dear {{customer_name}}, your account has been created at {{company_name}}. Support: {{support_contact}}",
  },
  {
    event_code: "service.created",
    channel: "sms",
    subject: "Service created",
    body: "Dear {{customer_name}}, your {{service_name}} service has been created. Service account: {{service_account_number}}. Status: {{service_status}}. {{company_name}}",
  },
  {
    event_code: "service.created.awaiting_payment",
    channel: "sms",
    subject: "Service awaiting payment",
    body: "Dear {{customer_name}}, your {{service_name}} service has been created. Service account: {{service_account_number}}. Please pay Ksh {{amount_due}} via Paybill {{paybill_number}}, Account {{service_account_number}}. Your service will activate after payment. {{company_name}}",
  },
  {
    event_code: "service.created.active",
    channel: "sms",
    subject: "Service active",
    body: "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} is now active until {{service_expiry_date}}. Pay Ksh {{amount_due}} via Paybill {{paybill_number}}, Account {{service_account_number}}. Thank you, {{company_name}}",
  },
  {
    event_code: "service.activated",
    channel: "sms",
    subject: "Service activated",
    body: "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} is now active until {{service_expiry_date}}. Paybill {{paybill_number}}, Account {{service_account_number}}. Thank you, {{company_name}}",
  },
  {
    event_code: "service.expired",
    channel: "sms",
    subject: "Service expired",
    body: "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} expired on {{service_expiry_date}}. Pay via Paybill {{paybill_number}}, Account {{service_account_number}} to restore. {{company_name}}",
  },
  {
    event_code: "service.restored",
    channel: "whatsapp",
    subject: "Service restored",
    body: "{customer_name}, {service_name} is back online after payment {payment_reference}. — {isp_name}",
  },
  {
    event_code: "invoice.due",
    channel: "email",
    subject: "Invoice {invoice_number} is due today",
    body: "Hello {customer_name},\n\nInvoice {invoice_number} of {amount} is due today. Pay now to avoid grace or suspension.\n\n{isp_name}",
  },
  {
    event_code: "invoice.overdue",
    channel: "email",
    subject: "Overdue invoice {invoice_number}",
    body: "Hello {customer_name},\n\nInvoice {invoice_number} ({amount}) is overdue (due {due_date}). Pay via M-Pesa to keep your connection.\n\n{isp_name}",
  },
  {
    event_code: "grace.started",
    channel: "email",
    subject: "Grace period started — {service_name}",
    body: "Hello {customer_name},\n\n{service_name} is now on grace after unpaid {invoice_number}. Pay {amount} to avoid suspension. Renewal date stays {renewal_date}.\n\n{isp_name}",
  },
  {
    event_code: "grace.granted",
    channel: "email",
    subject: "Grace period granted",
    body: "Hello {customer_name},\n\nYour service has been given a grace period until {grace_until}. Please pay before then. Your renewal date remains {renewal_date}.\n\n{isp_name}",
  },
  {
    event_code: "grace.ending",
    channel: "email",
    subject: "Grace period ending",
    body: "Hello {customer_name},\n\nYour service grace period ends on {grace_until}. Please make payment to keep your service active.\n\n{isp_name}",
  },
  {
    event_code: "grace.expired",
    channel: "email",
    subject: "Service suspended after grace",
    body: "Hello {customer_name},\n\nYour grace period has ended and your service has been suspended. Please make payment to restore your service.\n\n{isp_name}",
  },
  {
    event_code: "service.suspended",
    channel: "email",
    subject: "{service_name} suspended",
    body: "Hello {customer_name},\n\n{service_name} is suspended for non-payment of {invoice_number} ({amount}). Pay to restore instantly.\n\n{isp_name}",
  },
  {
    event_code: "service.restored",
    channel: "email",
    subject: "{service_name} restored",
    body: "Hello {customer_name},\n\n{service_name} is back online after payment {payment_reference}.\n\n{isp_name}",
  },
  {
    event_code: "grace.started",
    channel: "sms",
    subject: "Grace period",
    body: "{customer_name}, your {service_name} is now on grace after unpaid {invoice_number}. Pay {amount} to avoid suspension. Renewal date stays {renewal_date}. — {isp_name}",
  },
  {
    event_code: "grace.granted",
    channel: "sms",
    subject: "Grace period",
    body: "{customer_name}, your service has been given a grace period until {grace_until}. Please make payment before then to avoid service interruption. Your renewal date remains {renewal_date}. — {isp_name}",
  },
  {
    event_code: "grace.granted",
    channel: "in_app",
    subject: "Grace period granted",
    body: "{service_name} is on grace until {grace_until}. Renewal date remains {renewal_date}.",
  },
  {
    event_code: "grace.ending",
    channel: "sms",
    subject: "Grace period ending",
    body: "{customer_name}, your service grace period ends on {grace_until}. Please make payment to keep your service active. — {isp_name}",
  },
  {
    event_code: "grace.expired",
    channel: "sms",
    subject: "Grace period ended",
    body: "{customer_name}, your grace period has ended and your service has been suspended. Please make payment to restore your service. — {isp_name}",
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
    event_code: "payment.partial.below_minimum",
    channel: "sms",
    subject: "Partial payment received",
    body: "Dear {{customer_name}}, we received Ksh {{amount_received}} for {{service_name}} account {{service_account_number}}. Minimum payment required for activation is Ksh {{minimum_payment_amount}}. Balance required: Ksh {{remaining_activation_amount}}. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "payment.partial.received",
    channel: "sms",
    subject: "Partial payment received",
    body: "Dear {{customer_name}}, we received Ksh {{amount_received}} for {{service_name}} account {{service_account_number}} ({{payment_percentage}}% of Ksh {{full_package_amount}}). Remaining balance: Ksh {{remaining_activation_amount}}. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "payment.partial.activated",
    channel: "sms",
    subject: "Service activated",
    body: "Dear {{customer_name}}, we received Ksh {{amount_received}} for {{service_name}} account {{service_account_number}}. Your service is {{service_status}} until {{service_expiry_date}}. Validity granted: {{validity_days}} days. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "payment.partial.restored",
    channel: "sms",
    subject: "Service restored",
    body: "Dear {{customer_name}}, we received Ksh {{amount_received}} for {{service_name}} account {{service_account_number}}. Your service is {{service_status}} until {{service_expiry_date}}. Validity granted: {{validity_days}} days. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "payment.partial.remaining",
    channel: "sms",
    subject: "Remaining balance",
    body: "Dear {{customer_name}}, remaining balance on {{service_name}} account {{service_account_number}} is Ksh {{remaining_activation_amount}} of Ksh {{full_package_amount}}. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "invoice.created.business",
    channel: "sms",
    subject: "Business invoice issued",
    body: "Dear {{customer_name}}, invoice {{invoice_number}} for {{service_name}} account {{service_account_number}} is Ksh {{current_period_amount}}. Total outstanding balance: Ksh {{outstanding_balance}}. Paybill: {{paybill_number}}, Account: {{service_account_number}}. Due date: {{due_date}}. {{company_name}}",
  },
  {
    event_code: "invoice.overdue.business",
    channel: "sms",
    subject: "Business invoice overdue",
    body: "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} has an outstanding balance of Ksh {{outstanding_balance}} but remains active under approved credit terms. Available credit: Ksh {{available_credit}}. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "credit.warning",
    channel: "sms",
    subject: "Credit limit warning",
    body: "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} is approaching its credit limit. Outstanding: Ksh {{outstanding_balance}}. Credit limit: Ksh {{maximum_credit_amount}}. Available credit: Ksh {{available_credit}}. Please make payment to avoid service interruption. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "credit.limit_reached",
    channel: "sms",
    subject: "Credit limit reached",
    body: "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} has reached its approved credit limit of Ksh {{maximum_credit_amount}}. Service access has been suspended until payment is received. Paybill: {{paybill_number}}, Account: {{service_account_number}}. {{company_name}}",
  },
  {
    event_code: "payment.received.business",
    channel: "sms",
    subject: "Business payment received",
    body: "Dear {{customer_name}}, we received Ksh {{amount_received}} for {{service_name}} account {{service_account_number}}. Outstanding balance: Ksh {{outstanding_balance}}. Available credit: Ksh {{available_credit}}. Receipt: {{receipt_number}}. Thank you, {{company_name}}",
  },
  {
    event_code: "service.restored.business",
    channel: "sms",
    subject: "Business service restored",
    body: "Dear {{customer_name}}, your {{service_name}} account {{service_account_number}} has been restored after payment of Ksh {{amount_received}}. Outstanding balance: Ksh {{outstanding_balance}}. Available credit: Ksh {{available_credit}}. Thank you, {{company_name}}",
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

const DATE_KEYS: Array<keyof NotifyVars> = ["due_date", "grace_until", "renewal_date", "service_expiry_date"];

export function renderNotifyTemplate(template: string, vars: NotifyVars) {
  return template.replace(/\{\{([a-z_]+)\}\}|\{([a-z_]+)\}/g, (_, a: string, b: string) => {
    const key = (a || b) as keyof NotifyVars;
    return vars[key] ?? "";
  });
}

function withConsoleDates(vars: NotifyVars, dateFormat: string): NotifyVars {
  const next: NotifyVars = { ...vars };
  for (const key of DATE_KEYS) {
    const value = next[key];
    if (value) next[key] = formatSmsDate(value, dateFormat) || value;
  }
  return next;
}

export function moneyNotify(amountKes: number) {
  if (!Number.isFinite(amountKes) || amountKes <= 0) return "";
  return Math.round(amountKes).toLocaleString("en-KE");
}

export async function loadNetworkNotifyContext(sql: Sql, tenantId: string, ispName = "") {
  const [ten] = await sql<{ name: string; support_phone: string; support_email: string }>`
    select name, coalesce(support_phone,'') as support_phone, coalesce(support_email,'') as support_email
    from tenants where id = ${tenantId}`;
  const [pay] = await sql<{ till_number: string; stk_type: string }>`
    select coalesce(till_number,'') as till_number, coalesce(stk_type,'paybill') as stk_type
    from payment_providers
    where tenant_id = ${tenantId} and enabled = true
    order by case when coalesce(till_number,'') <> '' then 0 else 1 end,
             case when kind in ('mpesa','kopokopo') then 0 else 1 end
    limit 1`;
  const paybill = (pay?.till_number || "").trim();
  const mode = pay?.stk_type === "till" ? "Till" : "Paybill";
  const company = (ten?.name || ispName || "").trim();
  const support = (ten?.support_phone || ten?.support_email || "").trim();
  return {
    company_name: company,
    isp_name: company,
    support_contact: support,
    paybill_number: paybill,
    account_instructions: paybill ? `${mode} ${paybill}` : "the payment details issued by this network",
  };
}

export async function buildServiceNotifyVars(
  sql: Sql,
  tenantId: string,
  ispName: string,
  opts: {
    customerId: string;
    serviceId?: string | null;
    amountKes?: number;
    invoiceNumber?: string;
    paymentReference?: string;
    dueDate?: string;
  },
): Promise<NotifyVars> {
  const network = await loadNetworkNotifyContext(sql, tenantId, ispName);
  const [cus] = await sql<{ name: string }>`
    select name from customers where id = ${opts.customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  let serviceName = "";
  let account = "";
  let status = "";
  let expiry = "";
  if (opts.serviceId) {
    const [svc] = await sql<{
      name: string;
      account_number: string;
      status: string;
      access_until: string | null;
      period_end: string | null;
      package_name: string;
    }>`select coalesce(nullif(s.name,''), p.name, '') as name,
              coalesce(s.account_number,'') as account_number,
              s.status,
              s.access_until::text as access_until,
              s.period_end::text as period_end,
              p.name as package_name
       from services s
       join packages p on p.id = s.package_id
       where s.id = ${opts.serviceId} and s.tenant_id = ${tenantId} and s.deleted_at is null`;
    if (svc) {
      serviceName = svc.name || svc.package_name || "";
      account = svc.account_number;
      status = svc.status === "pending" ? "awaiting payment" : svc.status;
      expiry = svc.access_until || svc.period_end || "";
    }
  }
  const amount = moneyNotify(opts.amountKes ?? 0);
  return {
    customer_name: cus?.name || "",
    service_name: serviceName,
    service_account_number: account,
    service_status: status,
    service_expiry_date: expiry,
    amount: amount ? `KES ${amount}` : "",
    amount_due: amount,
    invoice_number: opts.invoiceNumber || "",
    payment_reference: opts.paymentReference || "",
    due_date: opts.dueDate || "",
    ...network,
  };
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

  const dateFormat = await loadTenantDateFormat(sql, opts.tenantId);
  const vars: NotifyVars = withConsoleDates(
    {
      ...opts.vars,
      isp_name: opts.vars.isp_name || opts.ispName,
      company_name: opts.vars.company_name || opts.vars.isp_name || opts.ispName,
      customer_name: opts.customerName,
    },
    dateFormat,
  );
  let sent = 0;

  for (const tpl of templates) {
    if (!channelAllowed(opts.event, tpl.channel, settings)) continue;
    const subject = renderNotifyTemplate(tpl.subject, vars);
    const body = renderNotifyTemplate(tpl.body, vars);
    const dest = destinationFor(tpl.channel, opts.phone ?? "", opts.email ?? "");
    const dup = await sql<{ id: string }>`
      select id from notification_logs
      where tenant_id = ${opts.tenantId} and event_code = ${opts.event} and entity_id = ${opts.entityId} and channel = ${tpl.channel}`;
    if (dup[0]) continue;
    let delivery = { status: "sent", detail: dest };
    if (tpl.channel === "sms" || tpl.channel === "whatsapp") {
      delivery = await deliverChannel(settings, tpl.channel, dest, body);
    } else if (tpl.channel === "email") {
      delivery = await queueEmail(sql, opts.tenantId, dest, subject, body, { customerId: opts.customerId ?? undefined });
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
    select name, phone, email from customers where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
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

export async function notifyQuietly(
  sql: Sql,
  tenantId: string,
  ispName: string,
  customerId: string,
  event: BillingEvent,
  entityId: string,
  vars: NotifyVars,
) {
  try {
    return await notifyCustomerEvent(sql, tenantId, ispName, customerId, event, entityId, vars);
  } catch {
    return 0;
  }
}

export async function runBillingCycle(sql: Sql, tenantId: string, ispName: string) {
  const created = await generateRecurringInvoices(sql, tenantId);
  for (const inv of created) {
    let business = false;
    if (inv.serviceId) {
      try {
        const { notifyBusinessInvoice } = await import("./business-credit.ts");
        business = await notifyBusinessInvoice(sql, {
          tenantId,
          ispName,
          customerId: inv.customerId,
          serviceId: inv.serviceId,
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          amountKes: inv.amount_kes,
          dueDate: inv.dueDate,
        });
      } catch {
        business = false;
      }
    }
    if (!business) {
      await notifyCustomerEvent(sql, tenantId, ispName, inv.customerId, "invoice.created", inv.id, {
        customer_name: "",
        invoice_number: inv.number,
        amount: `KES ${inv.amount_kes}`,
        due_date: inv.dueDate,
      });
    }
  }
  const { applyAccessPolicy } = await import("./access-policy.ts");
  const access = await applyAccessPolicy(sql, tenantId, ispName);
  const { dispatchPendingCampaigns } = await import("./comms.ts");
  const campaigns = await dispatchPendingCampaigns(sql, tenantId);
  return { issued: created.length, ...access, campaigns: campaigns.length };
}
