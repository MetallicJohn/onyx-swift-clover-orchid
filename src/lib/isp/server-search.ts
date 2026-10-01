import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { hasPermission } from "./rbac";
import { searchNeedle } from "./ui-shell";
import { requireWorkspace } from "./workspace";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};

export type SearchHit = {
  id: string;
  group: "Customers" | "Leads" | "Services" | "Invoices" | "Payments" | "Routers" | "Tickets";
  label: string;
  hint: string;
  href: string;
};

function money(amount: number) {
  return `KSh ${Number(amount || 0).toLocaleString("en-KE")}`;
}

export async function searchWorkspace(sql: Sql, tenantId: string, role: string, query: string): Promise<SearchHit[]> {
  const needle = searchNeedle(query);
  if (!needle) return [];
  const like = `%${needle}%`;
  const hits: SearchHit[] = [];

  if (hasPermission(role, "customers.read")) {
    const customers = await sql<{ id: string; name: string; phone: string; account_number: string }>`
      select id, name, phone, coalesce(account_number, '') as account_number
      from customers
      where tenant_id = ${tenantId} and deleted_at is null
        and (name ilike ${like} or phone ilike ${like} or account_number ilike ${like})
      order by name asc
      limit 5`;
    for (const row of customers) {
      hits.push({
        id: row.id,
        group: "Customers",
        label: row.name,
        hint: row.account_number || row.phone || "Customer",
        href: `/app/customers/${row.id}`,
      });
    }
    const invoices = await sql<{ id: string; number: string; name: string; amount_kes: number; status: string }>`
      select i.id, i.number, c.name, i.amount_kes, i.status
      from invoices i
      join customers c on c.id = i.customer_id
      where i.tenant_id = ${tenantId}
        and (i.number ilike ${like} or c.name ilike ${like})
      order by i.issued_at desc
      limit 5`;
    for (const row of invoices) {
      hits.push({
        id: row.id,
        group: "Invoices",
        label: row.number,
        hint: `${row.name} · ${money(row.amount_kes)} · ${row.status}`,
        href: `/app/billing/invoices/${row.id}`,
      });
    }
  }

  if (hasPermission(role, "payments.read")) {
    const payments = await sql<{ id: string; reference: string; name: string; amount_kes: number; status: string; provider: string }>`
      select p.id, p.reference, c.name, p.amount_kes, p.status, p.provider
      from payments p
      join customers c on c.id = p.customer_id
      where p.tenant_id = ${tenantId}
        and (p.reference ilike ${like} or c.name ilike ${like} or p.provider ilike ${like})
      order by p.paid_at desc
      limit 5`;
    for (const row of payments) {
      hits.push({
        id: row.id,
        group: "Payments",
        label: `${row.provider} ${row.reference}`.trim(),
        hint: `${row.name} · ${money(row.amount_kes)} · ${row.status}`,
        href: `/app/billing/payments/${row.id}`,
      });
    }
  }

  if (hasPermission(role, "services.read")) {
    const services = await sql<{ id: string; customer_name: string; package_name: string; status: string; access_method: string }>`
      select s.id, c.name as customer_name, coalesce(p.name, '') as package_name, s.status, s.access_method
      from services s
      join customers c on c.id = s.customer_id
      left join packages p on p.id = s.package_id
      where s.tenant_id = ${tenantId} and s.deleted_at is null
        and (
          c.name ilike ${like}
          or coalesce(s.username, '') ilike ${like}
          or coalesce(s.account_number, '') ilike ${like}
          or coalesce(p.name, '') ilike ${like}
        )
      order by c.name asc
      limit 5`;
    for (const row of services) {
      hits.push({
        id: row.id,
        group: "Services",
        label: `${row.customer_name} — ${row.package_name || row.access_method}`,
        hint: row.status,
        href: `/app/services/${row.id}`,
      });
    }
  }

  if (hasPermission(role, "leads.view")) {
    const leads = await sql<{ id: string; lead_number: string; name: string; package_name: string }>`
      select l.id, l.lead_number, l.name, coalesce(p.name, '') as package_name
      from leads l
      left join packages p on p.id = l.interested_package_id
      where l.tenant_id = ${tenantId} and l.archived_at is null
        and (l.name ilike ${like} or l.lead_number ilike ${like} or l.phone ilike ${like})
      order by l.created_at desc
      limit 5`;
    for (const row of leads) {
      hits.push({
        id: row.id,
        group: "Leads",
        label: row.lead_number || row.name,
        hint: row.package_name ? `${row.name} · ${row.package_name}` : row.name,
        href: `/app/leads/${row.id}`,
      });
    }
  }

  if (hasPermission(role, "routers.read")) {
    const routers = await sql<{ id: string; name: string; location: string }>`
      select id, name, coalesce(location, '') as location
      from routers
      where tenant_id = ${tenantId} and name ilike ${like}
      order by name asc
      limit 5`;
    for (const row of routers) {
      hits.push({
        id: row.id,
        group: "Routers",
        label: row.name,
        hint: row.location || "Router",
        href: `/app/routers/${row.id}`,
      });
    }
  }

  if (hasPermission(role, "tickets.read") || hasPermission(role, "tickets.assigned.read")) {
    const tickets = await sql<{ id: string; title: string; status: string; customer_name: string }>`
      select t.id, t.title, t.status, coalesce(c.name, '') as customer_name
      from tickets t
      left join customers c on c.id = t.customer_id
      where t.tenant_id = ${tenantId}
        and (t.title ilike ${like} or t.id ilike ${like} or coalesce(c.name, '') ilike ${like})
      order by t.created_at desc
      limit 5`;
    for (const row of tickets) {
      hits.push({
        id: row.id,
        group: "Tickets",
        label: row.title,
        hint: row.customer_name ? `${row.customer_name} · ${row.status}` : row.status,
        href: `/app/tickets/${row.id}`,
      });
    }
  }

  return hits;
}

export const commandSearchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { q?: string }) => ({ q: searchNeedle(String(data?.q || "")) }))
  .handler(async ({ context, data }): Promise<SearchHit[]> => {
    if (!data.q) return [];
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    return searchWorkspace(sql, tenantId, role, data.q);
  });
