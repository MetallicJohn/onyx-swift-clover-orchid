import { nid } from "../utils.ts";
import { emit } from "./events";
import { dueAt } from "./ticket-workflow";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function openTicket(
  sql: Sql,
  tenantId: string,
  data: { title: string; category: string; priority: string; customer_id?: string | null; assigned_to?: string; service_id?: string | null },
) {
  const id = nid("tkt");
  const due = dueAt(data.priority);
  await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status, assigned_to, due_at, service_id)
    values (${id}, ${tenantId}, ${data.customer_id || null}, ${data.title.trim()}, ${data.category}, ${data.priority},
            ${data.assigned_to ? "assigned" : "new"}, ${data.assigned_to || ""}, ${due.toISOString()}, ${data.service_id || null})`;
  await emit(sql, {
    type: "ticket.created",
    tenantId,
    payload: { ticket_id: id, title: data.title, customer_id: data.customer_id || "", priority: data.priority },
  });
  return { id };
}

export async function assignTicket(sql: Sql, tenantId: string, ticketId: string, userId: string) {
  await sql`update tickets set assigned_to = ${userId}, status = 'assigned'
    where id = ${ticketId} and tenant_id = ${tenantId}`;
  await emit(sql, { type: "ticket.updated", tenantId, payload: { ticket_id: ticketId, status: "assigned", assigned_to: userId } });
}

export async function commentTicket(
  sql: Sql,
  tenantId: string,
  ticketId: string,
  authorId: string,
  body: string,
  opts?: { internal?: boolean; authorKind?: "staff" | "customer" },
) {
  const text = body.trim();
  if (!text) throw new Error("Comment required");
  const internal = opts?.internal === true;
  const kind = opts?.authorKind === "customer" ? "customer" : "staff";
  await sql`insert into ticket_comments (id, tenant_id, ticket_id, author_id, body, is_internal, author_kind)
    values (${nid("tcm")}, ${tenantId}, ${ticketId}, ${authorId}, ${text}, ${internal}, ${kind})`;
}

export async function listStaff(sql: Sql, tenantId: string) {
  return sql<{ user_id: string; role: string; name: string; email: string }>`
    select m.user_id, m.role, coalesce(u.name, m.user_id) as name, coalesce(u.email, '') as email
    from tenant_members m
    left join "user" u on u.id = m.user_id
    where m.tenant_id = ${tenantId}
    order by m.role`;
}
