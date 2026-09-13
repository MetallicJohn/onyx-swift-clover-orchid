import { APP_NAME } from "../brand.ts";
import { nid } from "../utils.ts";
import { deliverEmail, formatFrom, getMessagingSettings, type EmailAttachment } from "./messaging.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type { EmailAttachment };

export async function writeInbox(
  sql: Sql,
  tenantId: string,
  customerId: string,
  subject: string,
  body: string,
  eventCode: string,
) {
  await sql`insert into customer_inbox (id, tenant_id, customer_id, subject, body, event_code)
    values (${nid("inb")}, ${tenantId}, ${customerId}, ${subject.slice(0, 200)}, ${body.slice(0, 4000)}, ${eventCode})`;
}

export async function listCustomerInbox(sql: Sql, tenantId: string, customerId: string) {
  return sql<{ id: string; subject: string; body: string; event_code: string; created_at: string; read_at: string | null }>`
    select id, subject, body, event_code, created_at::text as created_at, read_at::text as read_at
    from customer_inbox where tenant_id = ${tenantId} and customer_id = ${customerId}
    order by created_at desc limit 40`;
}

export async function listInbox(sql: Sql, tenantId: string) {
  return sql<{
    id: string;
    customer_id: string;
    subject: string;
    body: string;
    event_code: string;
    created_at: string;
    customer_name: string | null;
  }>`select i.id, i.customer_id, i.subject, i.body, i.event_code, i.created_at::text as created_at, c.name as customer_name
     from customer_inbox i left join customers c on c.id = i.customer_id
     where i.tenant_id = ${tenantId} order by i.created_at desc limit 50`;
}

export async function queueEmail(
  sql: Sql,
  tenantId: string,
  to: string,
  subject: string,
  body: string,
  opts?: { attachments?: EmailAttachment[]; customerId?: string },
) {
  const id = nid("eml");
  const settings = await getMessagingSettings(sql, tenantId);
  const from = formatFrom(settings) || `${APP_NAME} <noreply@ispsolutions.app>`;
  const delivery = await deliverEmail(settings, to, subject, body, { attachments: opts?.attachments });
  let detail = delivery.detail;
  if (opts?.attachments?.length) {
    detail = `${detail}${detail ? " · " : ""}attachment ${opts.attachments.map((a) => a.filename).join(", ")}`;
  }
  await sql`insert into email_outbox (id, tenant_id, to_addr, from_addr, subject, body, status, detail, customer_id)
    values (${id}, ${tenantId}, ${to}, ${from}, ${subject.slice(0, 200)}, ${body.slice(0, 4000)}, ${delivery.status}, ${detail}, ${opts?.customerId ?? null})`;
  return { status: delivery.status, detail };
}
