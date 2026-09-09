import { remainingKes } from "./billing.ts";
import { loadChurnScores } from "./churn.ts";
import type { DashboardData, PaymentRow, RouterRow, TicketRow, Workspace } from "./types.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export function deltaPct(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export function fillRevenueDays(
  rows: Array<{ day: string; amount: number; count: number }>,
  days = 14,
  today = new Date(),
) {
  const map = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
  const out: Array<{ day: string; amount: number; count: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const hit = map.get(day);
    out.push({ day, amount: hit?.amount ?? 0, count: hit?.count ?? 0 });
  }
  return out;
}

export async function loadDashboard(sql: Sql, workspace: Workspace): Promise<DashboardData> {
  const tid = workspace.tenantId;

  const [cust] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = ${tid}`;
  const [activeCust] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = ${tid} and status = 'active'`;
  const services = await sql<{ status: string; n: number }>`
    select status, count(*)::int as n from services where tenant_id = ${tid} group by status`;
  const statusCount = (s: string) => services.find((r) => r.status === s)?.n ?? 0;

  const [revMonth] = await sql<{ n: number }>`
    select coalesce(sum(amount_kes),0)::int as n from payments
    where tenant_id = ${tid} and status = 'confirmed' and paid_at >= date_trunc('month', now())`;
  const [revLast] = await sql<{ n: number }>`
    select coalesce(sum(amount_kes),0)::int as n from payments
    where tenant_id = ${tid} and status = 'confirmed'
      and paid_at >= date_trunc('month', now() - interval '1 month')
      and paid_at < date_trunc('month', now())`;
  const [todayPay] = await sql<{ n: number; c: number }>`
    select coalesce(sum(amount_kes),0)::int as n, count(*)::int as c from payments
    where tenant_id = ${tid} and status = 'confirmed' and paid_at::date = current_date`;
  const unpaid = await sql<{ amount_kes: number; paid_kes: number; status: string }>`
    select amount_kes, paid_kes, status from invoices
    where tenant_id = ${tid} and status in ('due','overdue','issued','partial')`;
  const outstanding = unpaid.reduce((sum, r) => sum + remainingKes(r.amount_kes, r.paid_kes, r.status), 0);

  const [tix] = await sql<{ n: number }>`select count(*)::int as n from tickets where tenant_id = ${tid} and status not in ('closed','resolved')`;
  const [ron] = await sql<{ n: number }>`select count(*)::int as n from routers where tenant_id = ${tid} and wg_status = 'connected'`;
  const [rtot] = await sql<{ n: number }>`select count(*)::int as n from routers where tenant_id = ${tid}`;
  const [cpu] = await sql<{ n: number }>`select coalesce(avg(cpu_pct),0)::int as n from routers where tenant_id = ${tid}`;
  const [notes] = await sql<{ n: number }>`select count(*)::int as n from notification_logs where tenant_id = ${tid} and created_at::date = current_date`;
  const [live] = await sql<{ n: number }>`select count(*)::int as n from radius_sessions where tenant_id = ${tid} and stopped_at is null`;
  const [connToday] = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = ${tid} and created_at::date = current_date`;
  const [connWeek] = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = ${tid} and created_at >= now() - interval '7 days'`;
  const [renewSoon] = await sql<{ n: number }>`
    select count(*)::int as n from services
    where tenant_id = ${tid} and status in ('active','grace','pending')
      and period_end is not null
      and period_end::date >= current_date
      and period_end::date <= current_date + 2`;
  const [dueSoon] = await sql<{ n: number }>`
    select count(*)::int as n from invoices
    where tenant_id = ${tid} and status in ('issued','due','overdue','partial')
      and due_date >= current_date
      and due_date <= current_date + 2`;

  const dailyRaw = await sql<{ day: string; amount: number; count: number }>`
    select paid_at::date::text as day, coalesce(sum(amount_kes),0)::int as amount, count(*)::int as count
    from payments
    where tenant_id = ${tid} and status = 'confirmed' and paid_at >= now() - interval '14 days'
    group by paid_at::date
    order by day`;

  const recentPayments = await sql<PaymentRow>`
    select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
    from payments p join customers c on c.id = p.customer_id
    where p.tenant_id = ${tid}
    order by p.paid_at desc limit 8`;

  const recentTickets = await sql<TicketRow>`
    select t.id, t.customer_id, c.name as customer_name, t.title, t.category, t.priority, t.status, t.created_at::text as created_at
    from tickets t left join customers c on c.id = t.customer_id
    where t.tenant_id = ${tid}
    order by t.created_at desc limit 5`;

  const routers = await sql<RouterRow>`
    select id, name, location, identity, role, wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours
    from routers where tenant_id = ${tid} order by name`;

  const newConnections = await sql<{
    id: string;
    customer_name: string;
    package_name: string;
    access_method: string;
    status: string;
    created_at: string;
  }>`select s.id, c.name as customer_name, p.name as package_name, s.access_method, s.status, s.created_at::text as created_at
     from services s
     join customers c on c.id = s.customer_id
     join packages p on p.id = s.package_id
     where s.tenant_id = ${tid}
     order by s.created_at desc limit 8`;

  const renewals = await sql<{
    id: string;
    customer_name: string;
    package_name: string;
    period_end: string;
    status: string;
    price_kes: number;
  }>`select s.id, c.name as customer_name, p.name as package_name, s.period_end::text as period_end, s.status, p.price_kes
     from services s
     join customers c on c.id = s.customer_id
     join packages p on p.id = s.package_id
     where s.tenant_id = ${tid}
       and s.status in ('active','grace','pending')
       and s.period_end is not null
       and s.period_end::date >= current_date
       and s.period_end::date <= current_date + 2
     order by s.period_end asc limit 8`;

  const dueInvoices = await sql<{
    id: string;
    customer_name: string;
    number: string;
    amount_kes: number;
    paid_kes: number;
    due_date: string;
  }>`select i.id, c.name as customer_name, i.number, i.amount_kes, i.paid_kes, i.due_date::text as due_date
     from invoices i join customers c on c.id = i.customer_id
     where i.tenant_id = ${tid}
       and i.status in ('issued','due','overdue','partial')
       and i.due_date <= current_date + 2
     order by i.due_date asc limit 8`;

  const churn = await loadChurnScores(sql, tid);
  const atRiskHigh = churn.filter((c) => c.band === "high" || c.band === "churned").length;
  const atRiskMedium = churn.filter((c) => c.band === "medium").length;
  const atRisk = churn
    .filter((c) => c.band !== "low")
    .slice(0, 8)
    .map((c) => ({
      id: c.customerId,
      name: c.name,
      score: c.score,
      band: c.band,
      reason: c.reasons[0] ?? "",
      balance_kes: c.balanceKes,
    }));

  return {
    workspace,
    totals: {
      customers: cust?.n ?? 0,
      active: activeCust?.n ?? 0,
      suspended: statusCount("suspended"),
      online: statusCount("active"),
      grace: statusCount("grace"),
      revenueMonth: revMonth?.n ?? 0,
      revenueLastMonth: revLast?.n ?? 0,
      outstanding,
      paymentsToday: todayPay?.n ?? 0,
      paymentsTodayCount: todayPay?.c ?? 0,
      openTickets: tix?.n ?? 0,
      routersOnline: ron?.n ?? 0,
      routersTotal: rtot?.n ?? 0,
      avgCpu: cpu?.n ?? 0,
      noticesToday: notes?.n ?? 0,
      liveSessions: live?.n ?? 0,
      connectionsToday: connToday?.n ?? 0,
      connectionsWeek: connWeek?.n ?? 0,
      renewalsToday: (renewSoon?.n ?? 0) + (dueSoon?.n ?? 0),
      atRiskHigh,
      atRiskMedium,
    },
    revenueDays: fillRevenueDays(dailyRaw),
    recentPayments,
    recentTickets,
    routers,
    atRisk,
    newConnections,
    renewals,
    dueInvoices,
  };
}
