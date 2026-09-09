import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

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

export async function queueEmail(sql: Sql, tenantId: string, to: string, subject: string, body: string) {
  const id = nid("eml");
  let status = "queued";
  let detail = "";
  const key = process.env.RESEND_API_KEY;
  if (key && to.includes("@")) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Gridline <noreply@gridline.app>",
          to: [to],
          subject,
          text: body,
        }),
      });
      status = res.ok ? "sent" : "failed";
      detail = res.ok ? "resend" : `resend ${res.status}`;
    } catch (e) {
      status = "failed";
      detail = e instanceof Error ? e.message : "send failed";
    }
  } else {
    detail = to.includes("@") ? "queued (no RESEND_API_KEY)" : "missing email";
    status = to.includes("@") ? "queued" : "failed";
  }
  await sql`insert into email_outbox (id, tenant_id, to_addr, subject, body, status, detail)
    values (${id}, ${tenantId}, ${to}, ${subject.slice(0, 200)}, ${body.slice(0, 4000)}, ${status}, ${detail})`;
  return { status, detail };
}
