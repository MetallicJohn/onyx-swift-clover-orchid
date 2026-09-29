import type { DomainEvent, Sql } from "./events";
import { emit } from "./events";
import { buildServiceNotifyVars, dispatchNotification, type NotifyVars } from "./notifications";
import { publishTicketLive } from "./ticket-stream";
import type { BillingEvent } from "./types";

const CUSTOMER_QUIET = new Set(["accepted", "waiting", "assigned", "new"]);

function summary(event: DomainEvent) {
  const title = String(event.payload.title || "Ticket");
  if (event.type === "ticket.created") return `New ticket: ${title}`;
  if (event.type === "ticket.assigned") return `Ticket assigned: ${title}`;
  if (event.type === "ticket.status_changed") return `${title} is now ${String(event.payload.status || "").replaceAll("_", " ")}`;
  if (event.type === "ticket.sla_warning") return `SLA warning: ${title}`;
  if (event.type === "ticket.comment_added") return "Ticket note added";
  return "Ticket updated";
}

async function ticketVars(sql: Sql, tenantId: string, customerId: string, title: string, status: string, technicianName = "") {
  const [tenant] = await sql<{ name: string }>`select name from tenants where id = ${tenantId}`;
  const isp = tenant?.name || "";
  const base: NotifyVars = customerId
    ? await buildServiceNotifyVars(sql, tenantId, isp, { customerId })
    : { customer_name: "", isp_name: isp, company_name: isp };
  return {
    ...base,
    ticket_title: title,
    ticket_status: status.replaceAll("_", " "),
    technician_name: technicianName,
    isp_name: base.isp_name || isp,
    company_name: base.company_name || isp,
  };
}

async function notifyCustomer(
  sql: Sql,
  tenantId: string,
  customerId: string,
  event: BillingEvent,
  entityId: string,
  title: string,
  status: string,
) {
  if (!customerId) return;
  const vars = await ticketVars(sql, tenantId, customerId, title, status);
  const [c] = await sql<{ name: string; phone: string; email: string }>`
    select name, phone, email from customers where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  if (!c) return;
  await dispatchNotification(sql, {
    tenantId,
    ispName: vars.isp_name || "",
    event,
    entityId,
    customerId,
    customerName: c.name,
    phone: c.phone,
    email: c.email,
    vars: { ...vars, customer_name: c.name },
  });
}

async function notifyTechnician(
  sql: Sql,
  tenantId: string,
  userId: string,
  event: BillingEvent,
  entityId: string,
  customerId: string,
  title: string,
  status: string,
) {
  if (!userId) return;
  const [member] = await sql<{ name: string; email: string; phone: string }>`
    select coalesce(u.name, m.user_id) as name, coalesce(u.email, '') as email, coalesce(p.phone, '') as phone
    from tenant_members m
    left join "user" u on u.id = m.user_id
    left join operator_profiles p on p.user_id = m.user_id
    where m.tenant_id = ${tenantId} and m.user_id = ${userId}`;
  if (!member) return;
  const vars = await ticketVars(sql, tenantId, customerId, title, status, member.name);
  await dispatchNotification(sql, {
    tenantId,
    ispName: vars.isp_name || "",
    event,
    entityId,
    customerId: customerId || null,
    customerName: vars.customer_name || member.name,
    phone: member.phone,
    email: member.email,
    vars,
  });
}

async function route(sql: Sql, event: DomainEvent) {
  const ticketId = String(event.payload.ticket_id || "");
  const title = String(event.payload.title || "Support ticket");
  const customerId = String(event.payload.customer_id || "");
  const status = String(event.payload.status || "");
  const assigned = String(event.payload.assigned_to || "");
  if (event.type === "ticket.created") {
    await notifyCustomer(sql, event.tenantId, customerId, "ticket_opened", ticketId, title, status || "new");
    return;
  }
  if (event.type === "ticket.assigned") {
    await notifyTechnician(sql, event.tenantId, assigned, "ticket_assigned", `${ticketId}:${assigned}`, customerId, title, "assigned");
    return;
  }
  if (event.type === "ticket.sla_warning") {
    await notifyTechnician(sql, event.tenantId, assigned, "ticket_sla_warning", ticketId, customerId, title, status);
    return;
  }
  if (event.type === "ticket.status_changed") {
    if (status === "travelling" || status === "on_site") {
      await notifyCustomer(sql, event.tenantId, customerId, "ticket_status_changed", `${ticketId}:enroute`, title, status);
    } else if (status === "resolved" || status === "closed") {
      if (!CUSTOMER_QUIET.has(status)) {
        await notifyCustomer(sql, event.tenantId, customerId, "ticket_resolved", ticketId, title, status);
      }
    }
  }
}

export async function fanoutTicketEvent(sql: Sql, event: DomainEvent) {
  try {
    await route(sql, event);
  } catch {
    /* a failed send must not block the ticket write */
  }
  publishTicketLive({
    tenantId: event.tenantId,
    type: event.type,
    ticketId: String(event.payload.ticket_id || ""),
    summary: summary(event),
  });
}

export async function scanTicketSla(sql: Sql) {
  const { applyRls } = await import("./rls");
  await applyRls(sql, { bypass: true });
  const due = await sql<{
    id: string;
    tenant_id: string;
    title: string;
    assigned_to: string;
    customer_id: string;
    status: string;
  }>`select id, tenant_id, title, coalesce(assigned_to,'') as assigned_to,
            coalesce(customer_id::text,'') as customer_id, status
     from tickets
     where status not in ('resolved','closed')
       and due_at is not null
       and due_at <= now() + interval '30 minutes'
       and due_at > now() - interval '6 hours'
       and assigned_to <> ''`;
  let warned = 0;
  for (const row of due) {
    await applyRls(sql, { tenantId: row.tenant_id });
    await emit(sql, {
      type: "ticket.sla_warning",
      tenantId: row.tenant_id,
      payload: {
        ticket_id: row.id,
        title: row.title,
        customer_id: row.customer_id,
        assigned_to: row.assigned_to,
        status: row.status,
      },
    });
    warned += 1;
  }
  return { warned };
}
