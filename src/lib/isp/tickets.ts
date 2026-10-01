import { nid } from "../utils.ts";
import { likeNeedle } from "./customer-desk-format.ts";
import { last9Phone } from "./customer-portal-format.ts";
import { emit } from "./events";
import { hasPermission } from "./rbac";
import { normalizeTicketListQuery, type TicketListQuery } from "./ticket-list-format.ts";
import { canTechnicianSet, dueAt, parseTechnicianCommand, TICKET_STATUSES, type TicketStatus } from "./ticket-workflow";

export { nextTicketSearch, normalizeTicketListQuery } from "./ticket-list-format.ts";
export type { TicketListQuery } from "./ticket-list-format.ts";

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
  const title = data.title.trim();
  const assigned = data.assigned_to || "";
  await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status, assigned_to, due_at, service_id)
    values (${id}, ${tenantId}, ${data.customer_id || null}, ${title}, ${data.category}, ${data.priority},
            ${assigned ? "assigned" : "new"}, ${assigned}, ${due.toISOString()}, ${data.service_id || null})`;
  await emit(sql, {
    type: "ticket.created",
    tenantId,
    payload: {
      ticket_id: id,
      title,
      customer_id: data.customer_id || "",
      priority: data.priority,
      status: assigned ? "assigned" : "new",
      assigned_to: assigned,
    },
  });
  if (assigned) {
    await emit(sql, {
      type: "ticket.assigned",
      tenantId,
      payload: { ticket_id: id, title, customer_id: data.customer_id || "", assigned_to: assigned, status: "assigned" },
    });
  }
  return { id };
}

export async function assignTicket(sql: Sql, tenantId: string, ticketId: string, userId: string) {
  const [row] = await sql<{ title: string; customer_id: string | null }>`
    select title, customer_id from tickets where id = ${ticketId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Ticket not found");
  await sql`update tickets set assigned_to = ${userId}, status = 'assigned'
    where id = ${ticketId} and tenant_id = ${tenantId}`;
  await emit(sql, {
    type: "ticket.assigned",
    tenantId,
    payload: {
      ticket_id: ticketId,
      title: row.title,
      customer_id: row.customer_id || "",
      status: "assigned",
      assigned_to: userId,
    },
  });
}

export async function changeTicketStatus(
  sql: Sql,
  tenantId: string,
  ticketId: string,
  status: string,
  opts?: { technicianUserId?: string },
) {
  const next = status.trim();
  if (!(TICKET_STATUSES as readonly string[]).includes(next)) throw new Error("Unknown ticket status");
  const [row] = await sql<{
    status: string;
    assigned_to: string;
    customer_id: string | null;
    title: string;
    priority: string;
  }>`select status, coalesce(assigned_to,'') as assigned_to, customer_id, title, priority
     from tickets where id = ${ticketId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Ticket not found");
  const tech = opts?.technicianUserId || "";
  if (tech) {
    if (row.assigned_to && row.assigned_to !== tech) throw new Error("Not assigned to you");
    if (!canTechnicianSet(row.status, next)) throw new Error("That status change is not allowed from here");
  }
  if (row.status === next && (!tech || row.assigned_to)) return { ok: true as const, unchanged: true };
  const assigned = tech && !row.assigned_to ? tech : row.assigned_to;
  await sql`update tickets set status = ${next}, assigned_to = ${assigned}
    where id = ${ticketId} and tenant_id = ${tenantId}`;
  await emit(sql, {
    type: "ticket.status_changed",
    tenantId,
    payload: {
      ticket_id: ticketId,
      title: row.title,
      customer_id: row.customer_id || "",
      status: next,
      previous: row.status,
      assigned_to: assigned,
      priority: row.priority,
    },
  });
  return { ok: true as const, unchanged: false, status: next };
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
  await emit(sql, {
    type: "ticket.comment_added",
    tenantId,
    payload: { ticket_id: ticketId, internal, author_kind: kind },
  });
}

export async function listStaff(sql: Sql, tenantId: string) {
  return sql<{ user_id: string; role: string; name: string; email: string }>`
    select m.user_id, m.role, coalesce(u.name, m.user_id) as name, coalesce(u.email, '') as email
    from tenant_members m
    left join "user" u on u.id = m.user_id
    where m.tenant_id = ${tenantId}
    order by m.role`;
}

function last9(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

export async function applyTechnicianWhatsAppStatus(sql: Sql, tenantId: string, from: string, text: string) {
  const next = parseTechnicianCommand(text);
  if (!next) return { handled: false as const, reply: "" };
  const phone = last9(from);
  if (!phone) return { handled: false as const, reply: "" };
  const [tech] = await sql<{ user_id: string }>`
    select m.user_id
    from tenant_members m
    join operator_profiles p on p.user_id = m.user_id
    where m.tenant_id = ${tenantId} and m.role = 'technician'
      and right(regexp_replace(coalesce(p.phone,''), '\\D', '', 'g'), 9) = ${phone}
    limit 1`;
  if (!tech) return { handled: false as const, reply: "" };
  const open = await sql<{ id: string; title: string; status: string }>`
    select id, title, status from tickets
    where tenant_id = ${tenantId} and assigned_to = ${tech.user_id}
      and status not in ('resolved','closed')
    order by due_at nulls last, created_at
    limit 8`;
  if (!open.length) return { handled: true as const, reply: "You have no open ticket to update." };
  const hit = open.find((row) => canTechnicianSet(row.status, next));
  if (!hit) {
    return {
      handled: true as const,
      reply: `That ticket can't move to ${next.replaceAll("_", " ")} from ${open[0]!.status.replaceAll("_", " ")}.`,
    };
  }
  await changeTicketStatus(sql, tenantId, hit.id, next, { technicianUserId: tech.user_id });
  return { handled: true as const, reply: `Ticket "${hit.title}" is now ${labelStatus(next)}.` };
}

function labelStatus(status: TicketStatus) {
  if (status === "on_site") return "on site";
  if (status === "travelling") return "on the way";
  return status.replaceAll("_", " ");
}

const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type TicketListItem = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_account: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  assigned_to: string;
  service_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketListCounts = {
  all: number;
  open: number;
  new: number;
  waiting: number;
  resolved: number;
};

export type TicketListResult = {
  items: TicketListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: TicketListCounts;
};

export type TicketCustomerService = {
  id: string;
  label: string;
  access_method: string;
  package_name: string;
  download_mbps: number;
  username: string;
  static_ip: string;
  status: string;
};

function ticketListWhere(tenantId: string, q: ReturnType<typeof normalizeTicketListQuery>) {
  const params: unknown[] = [tenantId];
  const where = ["t.tenant_id = $1"];
  if (q.status === "open") where.push(`t.status not in ('resolved','closed')`);
  else if (q.status === "closed") where.push(`t.status in ('resolved','closed')`);
  else if (q.status !== "all") {
    params.push(q.status);
    where.push(`t.status = $${params.length}`);
  }
  if (q.priority !== "all") {
    params.push(q.priority);
    where.push(`t.priority = $${params.length}`);
  }
  if (q.category !== "all") {
    params.push(q.category);
    where.push(`t.category = $${params.length}`);
  }
  if (q.assignedTo === "unassigned") where.push(`coalesce(t.assigned_to,'') = ''`);
  else if (q.assignedTo !== "all") {
    params.push(q.assignedTo);
    where.push(`t.assigned_to = $${params.length}`);
  }
  if (q.q.length >= 2) {
    params.push(likeNeedle(q.q));
    const like = `$${params.length}`;
    const phone = last9Phone(q.q);
    params.push(phone);
    const phoneParam = `$${params.length}`;
    where.push(`(
      t.id ilike ${like} escape '#'
      or t.title ilike ${like} escape '#'
      or coalesce(c.name,'') ilike ${like} escape '#'
      or coalesce(c.phone,'') ilike ${like} escape '#'
      or coalesce(c.account_number,'') ilike ${like} escape '#'
      or exists (
        select 1 from account_number_aliases a
        where a.tenant_id = t.tenant_id
          and a.alias ilike ${like} escape '#'
          and (
            (a.entity_type = 'customer' and a.entity_id = c.id)
            or upper(a.account_number) = upper(coalesce(c.account_number,''))
          )
      )
      or (${phone.length >= 9} and right(regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g'), 9) = ${phoneParam})
    )`);
  }
  return { clause: where.join(" and "), params };
}

export async function queryTicketList(sql: Sql, tenantId: string, raw?: Partial<TicketListQuery> | null): Promise<TicketListResult> {
  const q = normalizeTicketListQuery(raw);
  const { clause, params } = ticketListWhere(tenantId, q);
  const [counts] = await sql.query<{
    all_count: number;
    open_count: number;
    new_count: number;
    waiting_count: number;
    resolved_count: number;
  }>(
    `select count(*)::int as all_count,
            count(*) filter (where status not in ('resolved','closed'))::int as open_count,
            count(*) filter (where status = 'new')::int as new_count,
            count(*) filter (where status = 'waiting')::int as waiting_count,
            count(*) filter (where status = 'resolved')::int as resolved_count
     from tickets where tenant_id = $1`,
    [tenantId],
  );
  const [countRow] = await sql.query<{ n: number }>(
    `select count(*)::int as n
     from tickets t
     left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
     where ${clause}`,
    params,
  );
  const total = countRow?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / q.pageSize) || 1);
  const page = Math.min(q.page, totalPages);
  const listParams = [...params, q.pageSize, (page - 1) * q.pageSize];
  const items = await sql.query<TicketListItem>(
    `select t.id, t.customer_id, c.name as customer_name,
            coalesce(c.phone,'') as customer_phone,
            coalesce(c.account_number,'') as customer_account,
            t.title, t.category, t.priority, t.status,
            coalesce(t.assigned_to,'') as assigned_to,
            t.service_id,
            t.created_at::text as created_at,
            greatest(
              t.created_at,
              coalesce((select max(cm.created_at) from ticket_comments cm where cm.ticket_id = t.id and cm.tenant_id = t.tenant_id), t.created_at)
            )::text as updated_at
     from tickets t
     left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
     where ${clause}
     order by t.created_at desc, t.id desc
     limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams,
  );
  return {
    items,
    page,
    pageSize: q.pageSize,
    total,
    totalPages,
    counts: {
      all: counts?.all_count ?? 0,
      open: counts?.open_count ?? 0,
      new: counts?.new_count ?? 0,
      waiting: counts?.waiting_count ?? 0,
      resolved: counts?.resolved_count ?? 0,
    },
  };
}

export async function listTicketCustomerServices(sql: Sql, tenantId: string, customerId: string) {
  const id = customerId.trim();
  if (!id) return [];
  const [cus] = await sql<{ id: string }>`
    select id from customers where id = ${id} and tenant_id = ${tenantId} and deleted_at is null`;
  if (!cus) return [];
  return sql<TicketCustomerService>`
    select s.id,
           coalesce(nullif(s.name,''), p.name, 'Service') as label,
           s.access_method,
           coalesce(p.name,'') as package_name,
           coalesce(p.download_mbps,0)::int as download_mbps,
           coalesce(s.username,'') as username,
           coalesce(s.static_ip,'') as static_ip,
           s.status
    from services s
    left join packages p on p.id = s.package_id and p.tenant_id = s.tenant_id
    where s.tenant_id = ${tenantId} and s.customer_id = ${id} and s.deleted_at is null
    order by s.created_at, s.id`;
}

export async function openStaffTicket(
  sql: Sql,
  tenantId: string,
  data: { title: string; category: string; priority: string; customer_id?: string | null; service_id?: string | null; assigned_to?: string | null },
) {
  const title = data.title.trim();
  if (!title) throw new Error("Title is required");
  const customerId = String(data.customer_id || "").trim();
  if (!customerId) throw new Error("Choose a customer");
  const [cus] = await sql<{ id: string }>`
    select id from customers where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  if (!cus) throw new Error("Customer not found");
  const serviceId = String(data.service_id || "").trim();
  if (serviceId) {
    const [svc] = await sql<{ id: string }>`
      select id from services
      where id = ${serviceId} and tenant_id = ${tenantId} and customer_id = ${customerId} and deleted_at is null`;
    if (!svc) throw new Error("That service does not belong to this customer");
  }
  const assigned = String(data.assigned_to || "").trim();
  if (assigned) {
    const [member] = await sql<{ user_id: string }>`
      select user_id from tenant_members where tenant_id = ${tenantId} and user_id = ${assigned}`;
    if (!member) throw new Error("Assignee is not on this network");
  }
  const priority = (TICKET_PRIORITIES as readonly string[]).includes(data.priority) ? data.priority : "normal";
  const category = data.category.trim().slice(0, 40) || "network";
  return openTicket(sql, tenantId, {
    title: title.slice(0, 180),
    category,
    priority,
    customer_id: customerId,
    service_id: serviceId || null,
    assigned_to: assigned,
  });
}

export const TICKET_PRIORITY_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "normal", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Critical" },
] as const;

export type TicketBulkOp = "assign" | "priority" | "status" | "close";

/** Status changes are the only bulk action a technician may run, and only on their own tickets. */
export function ticketBulkAllowed(role: string, op: TicketBulkOp) {
  if (op === "status" && role === "technician") return hasPermission(role, "jobs.update");
  return hasPermission(role, "tickets.manage");
}

export type TicketBulkFailure = { id: string; error: string };

export type TicketBulkResult = {
  updated: string[];
  failed: TicketBulkFailure[];
};

export function summarizeTicketBulk(result: Pick<TicketBulkResult, "updated" | "failed">) {
  const ok = result.updated.length;
  const bad = result.failed.length;
  const okLine = `${ok} ticket${ok === 1 ? "" : "s"} updated successfully`;
  if (!bad) return okLine;
  const badLine = `${bad} ticket${bad === 1 ? "" : "s"} could not be updated`;
  return `${okLine}. ${badLine}`;
}

export async function getTicketRow(sql: Sql, tenantId: string, ticketId: string) {
  const id = String(ticketId || "").trim();
  if (!id) return null;
  const [row] = await sql<TicketListItem>`
    select t.id, t.customer_id, c.name as customer_name,
           coalesce(c.phone,'') as customer_phone,
           coalesce(c.account_number,'') as customer_account,
           t.title, t.category, t.priority, t.status,
           coalesce(t.assigned_to,'') as assigned_to,
           t.service_id,
           t.created_at::text as created_at,
           greatest(
             t.created_at,
             coalesce((select max(cm.created_at) from ticket_comments cm where cm.ticket_id = t.id and cm.tenant_id = t.tenant_id), t.created_at)
           )::text as updated_at
    from tickets t
    left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
    where t.id = ${id} and t.tenant_id = ${tenantId}`;
  return row || null;
}

export async function bulkUpdateTickets(
  sql: Sql,
  tenantId: string,
  actorId: string,
  ids: string[],
  op: TicketBulkOp,
  value: string,
  opts?: { technicianUserId?: string },
): Promise<TicketBulkResult> {
  const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!unique.length) throw new Error("Select at least one ticket");
  if (unique.length > 100) throw new Error("Select at most 100 tickets");
  const tech = opts?.technicianUserId || "";
  const assignTo = op === "assign" ? value.trim() : "";
  const priority = op === "priority" ? value.trim() : "";
  const status = op === "close" ? "closed" : op === "status" ? value.trim() : "";
  if (op === "assign") {
    if (!assignTo) throw new Error("Choose someone to assign");
    const [member] = await sql<{ user_id: string }>`
      select user_id from tenant_members where tenant_id = ${tenantId} and user_id = ${assignTo}`;
    if (!member) throw new Error("Assignee is not on this network");
  }
  if (op === "priority" && !(TICKET_PRIORITIES as readonly string[]).includes(priority)) {
    throw new Error("Unknown priority");
  }
  if ((op === "status" || op === "close") && !(TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Unknown ticket status");
  }
  const updated: string[] = [];
  const failed: TicketBulkFailure[] = [];
  for (const id of unique) {
    try {
      if (op === "assign") {
        await assignTicket(sql, tenantId, id, assignTo);
      } else if (op === "priority") {
        const [row] = await sql<{ id: string; assigned_to: string }>`
          select id, coalesce(assigned_to,'') as assigned_to from tickets where id = ${id} and tenant_id = ${tenantId}`;
        if (!row) throw new Error("Ticket not found");
        if (tech && row.assigned_to && row.assigned_to !== tech) throw new Error("Not assigned to you");
        await sql`update tickets set priority = ${priority} where id = ${id} and tenant_id = ${tenantId}`;
      } else {
        await changeTicketStatus(sql, tenantId, id, status, { technicianUserId: tech });
      }
      await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
        values (${nid("aud")}, ${tenantId}, ${actorId}, ${`ticket.bulk_${op}`}, 'ticket', ${id}, ${JSON.stringify({ op, value: assignTo || priority || status })})`;
      updated.push(id);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "Could not update this ticket" });
    }
  }
  return { updated, failed };
}