import type { CustomerChurn } from "./churn.ts";
import {
  attentionItems,
  classifyRouter,
  collectedHint,
  dashboardAccess,
  greetingName,
  maskPhone,
  methodSplit,
  onlineHint,
  outstandingHint,
  parseDashboardPeriod,
  periodWindow,
  redactOps,
  safeTimeZone,
  seriesFromPayments,
  sortRouters,
  sortWork,
  subscriberHint,
  type DashboardOps,
  type DashboardPeriod,
  type WorkDraft,
} from "./dashboard-period.ts";
import type { Workspace } from "./types.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/**
 * Active subscriber: a distinct customer with a non-deleted service in `active` or `grace`.
 * Leads, terminated services, and duplicate customer rows are not counted.
 * Period comparison is the count of those subscribers whose service was created in the window
 * (there is no historical status snapshot, so a reconstructed previous stock is not invented).
 *
 * Collected: confirmed payments only. Pending, failed, and reversed rows are excluded.
 * Outstanding: remaining balance on issued, due, overdue, and partial invoices
 * (`amount_kes - paid_kes`), which is the same rule as `remainingKes`.
 *
 * Online now: distinct RADIUS usernames with an open session. Not the active-customer count.
 *
 * Work queue rank (lower first): past-SLA tickets, failed provisioning, urgent tickets,
 * high tickets, oldest overdue invoices, renewals due today, renewals due within 2 days,
 * high churn, pending installations.
 */
export async function loadDashboardOps(
  sql: Sql,
  workspace: Workspace,
  opts?: {
    period?: DashboardPeriod | string;
    viewerName?: string;
    userId?: string;
    now?: Date;
    churn?: CustomerChurn[];
  },
): Promise<DashboardOps> {
  const period = parseDashboardPeriod(opts?.period);
  const now = opts?.now ?? new Date();
  const access = dashboardAccess(workspace.role);
  const tid = workspace.tenantId;

  const [ten] = await sql<{
    timezone: string;
    support_phone: string;
    support_email: string;
  }>`select coalesce(timezone,'Africa/Nairobi') as timezone,
            coalesce(support_phone,'') as support_phone,
            coalesce(support_email,'') as support_email
     from tenants where id = ${tid}`;
  const timezone = safeTimeZone(ten?.timezone);
  const window = periodWindow(period, now, timezone);

  const [metrics] = await sql<{
    collected: number;
    collected_prev: number;
    active_subs: number;
    active_added: number;
    online_now: number;
    outstanding: number;
    overdue_n: number;
    overdue_amt: number;
    urgent_n: number;
    past_sla: number;
    packages_n: number;
    customers_n: number;
    routers_live: number;
    methods_n: number;
    gateway_n: number;
  }>`select
      (select coalesce(sum(amount_kes),0)::int from payments
        where tenant_id = ${tid} and status = 'confirmed' and paid_at >= ${window.start} and paid_at < ${window.end}) as collected,
      (select coalesce(sum(amount_kes),0)::int from payments
        where tenant_id = ${tid} and status = 'confirmed' and paid_at >= ${window.prevStart} and paid_at < ${window.prevEnd}) as collected_prev,
      (select count(distinct customer_id)::int from services
        where tenant_id = ${tid} and deleted_at is null and status in ('active','grace')) as active_subs,
      (select count(distinct customer_id)::int from services
        where tenant_id = ${tid} and deleted_at is null and status in ('active','grace')
          and created_at >= ${window.start} and created_at < ${window.end}) as active_added,
      (select count(distinct nullif(username,''))::int from radius_sessions
        where tenant_id = ${tid} and stopped_at is null) as online_now,
      (select coalesce(sum(greatest(0, amount_kes - paid_kes)),0)::int from invoices
        where tenant_id = ${tid} and status in ('due','overdue','issued','partial')) as outstanding,
      (select count(*)::int from invoices where tenant_id = ${tid} and status = 'overdue') as overdue_n,
      (select coalesce(sum(greatest(0, amount_kes - paid_kes)),0)::int from invoices
        where tenant_id = ${tid} and status = 'overdue') as overdue_amt,
      (select count(*)::int from tickets
        where tenant_id = ${tid} and status not in ('resolved','closed') and priority in ('high','urgent')) as urgent_n,
      (select count(*)::int from tickets
        where tenant_id = ${tid} and status not in ('resolved','closed') and due_at is not null and due_at < ${now}) as past_sla,
      (select count(*)::int from packages where tenant_id = ${tid}) as packages_n,
      (select count(*)::int from customers where tenant_id = ${tid} and deleted_at is null) as customers_n,
      (select count(*)::int from routers where tenant_id = ${tid} and archived_at is null and last_seen is not null) as routers_live,
      (select count(*)::int from payment_providers where tenant_id = ${tid} and enabled = true) as methods_n,
      (select count(*)::int from payment_providers
        where tenant_id = ${tid} and enabled = true and kind in ('mpesa','kopokopo')
          and (till_number <> '' or client_id <> '')) as gateway_n`;

  const collected = metrics?.collected ?? 0;
  const collectedPrev = metrics?.collected_prev ?? 0;
  const active = metrics?.active_subs ?? 0;
  const added = metrics?.active_added ?? 0;
  const online = metrics?.online_now ?? 0;
  const outstanding = metrics?.outstanding ?? 0;

  let revenue: DashboardOps["revenue"] = null;
  if (access.payments) {
    const payRows = await sql<{ paid_at: string; amount: number; provider: string }>`
      select paid_at::text as paid_at, amount_kes as amount, provider
      from payments
      where tenant_id = ${tid} and status = 'confirmed'
        and paid_at >= ${window.prevStart} and paid_at < ${window.end}`;
    const series = seriesFromPayments(
      payRows.map((r) => ({ at: r.paid_at, amount: r.amount })),
      window,
    );
    const inWindow = payRows.filter((r) => {
      const at = new Date(r.paid_at);
      return at >= window.start && at < window.end;
    });
    revenue = {
      currentLabel: window.currentLabel,
      previousLabel: window.previousLabel,
      currentTotal: collected,
      previousTotal: collectedPrev,
      series,
      methods: methodSplit(inWindow.map((r) => ({ provider: r.provider, amount: r.amount }))),
    };
  }

  let network: DashboardOps["network"] = null;
  let networkMore = 0;
  let offlineNames: string[] = [];
  if (access.network) {
    const routers = await sql<{
      id: string;
      name: string;
      location: string;
      site_pop: string;
      wg_status: string;
      last_seen: string | null;
      cpu_pct: number;
      enabled: boolean;
      memory_pct: number | null;
    }>`select r.id, r.name, coalesce(r.location,'') as location, coalesce(r.site_pop,'') as site_pop,
             r.wg_status, r.last_seen::text as last_seen, r.cpu_pct, r.enabled,
             h.memory_pct
      from routers r
      left join lateral (
        select memory_pct from router_health_snapshots
        where router_id = r.id and tenant_id = r.tenant_id
        order by created_at desc limit 1
      ) h on true
      where r.tenant_id = ${tid} and r.archived_at is null`;
    const ranked = sortRouters(
      routers.map((r) => {
        const classified = classifyRouter(
          {
            last_seen: r.last_seen,
            wg_status: r.wg_status,
            cpu_pct: r.cpu_pct,
            memory_pct: r.memory_pct,
            enabled: r.enabled !== false,
          },
          now.getTime(),
        );
        return {
          id: r.id,
          name: r.name,
          location: r.site_pop || r.location || r.wg_status,
          state: classified.state,
          detail: classified.detail,
          href: access.routers ? `/app/routers/${r.id}` : null,
        };
      }),
    );
    offlineNames = ranked.filter((r) => r.state === "offline").map((r) => r.name);
    networkMore = Math.max(0, ranked.length - 8);
    network = ranked.slice(0, 8);
  }

  const highChurn = (opts?.churn ?? []).filter((c) => c.band === "high" || c.band === "churned");
  const attention = attentionItems({
    access,
    offlineNames,
    overdueCount: metrics?.overdue_n ?? 0,
    overdueKes: metrics?.overdue_amt ?? 0,
    urgentCount: metrics?.urgent_n ?? 0,
    pastSla: metrics?.past_sla ?? 0,
    churnCount: highChurn.length,
  });

  const queue: WorkDraft[] = [];
  const userId = opts?.userId || "";
  const today = periodWindow("today", now, timezone);
  const renewUntil = new Date(today.start.getTime() + 3 * 86_400_000);

  if (access.services) {
    const renewals = await sql<{
      id: string;
      customer_id: string;
      customer_name: string;
      phone: string;
      package_name: string;
      period_end: string;
    }>`select s.id, c.id as customer_id, c.name as customer_name, coalesce(c.phone,'') as phone,
              p.name as package_name, s.period_end::text as period_end
       from services s
       join customers c on c.id = s.customer_id
       join packages p on p.id = s.package_id
       where s.tenant_id = ${tid} and s.deleted_at is null and c.deleted_at is null
         and s.status in ('active','grace','pending')
         and s.period_end is not null
         and s.period_end >= ${today.start}
         and s.period_end < ${renewUntil}
       order by s.period_end asc
       limit 8`;
    for (const row of renewals) {
      const end = new Date(row.period_end);
      const todayEnd = new Date(today.start.getTime() + 86_400_000);
      const dueToday = end < todayEnd;
      queue.push({
        id: `renew_${row.id}`,
        kind: "renewal",
        subject: row.customer_name,
        context: `${row.package_name} · ${dueToday ? "expires today" : "expires soon"}`,
        urgency: dueToday ? "Today" : "Soon",
        action: access.comms ? "remind" : "open",
        actionLabel: access.comms ? "Remind" : "Open",
        entityId: row.id,
        customerId: row.customer_id,
        phoneMask: access.comms ? maskPhone(row.phone) : "",
        href: `/app/services/${row.id}`,
        score: dueToday ? 4000 : 4500 + Math.max(0, end.getTime() - now.getTime()) / 3_600_000,
      });
    }
  }

  if (access.invoices) {
    const overdue = await sql<{
      id: string;
      number: string;
      customer_id: string;
      customer_name: string;
      phone: string;
      due_date: string;
      amount_kes: number;
      paid_kes: number;
    }>`select i.id, i.number, c.id as customer_id, c.name as customer_name, coalesce(c.phone,'') as phone,
              i.due_date::text as due_date, i.amount_kes, i.paid_kes
       from invoices i
       join customers c on c.id = i.customer_id
       where i.tenant_id = ${tid} and i.status = 'overdue'
       order by i.due_date asc
       limit 8`;
    for (const row of overdue) {
      const days = Math.max(0, Math.floor((now.getTime() - Date.parse(row.due_date)) / 86_400_000));
      queue.push({
        id: `inv_${row.id}`,
        kind: "overdue",
        subject: row.customer_name,
        context: `${row.number} · ${days} day${days === 1 ? "" : "s"} overdue`,
        urgency: days >= 7 ? "Overdue" : "Due",
        action: access.comms ? "sms" : "open",
        actionLabel: access.comms ? "Send SMS" : "Open",
        entityId: row.id,
        customerId: row.customer_id,
        phoneMask: access.comms ? maskPhone(row.phone) : "",
        href: `/app/billing/invoices/${row.id}`,
        score: 3000 - Math.min(days, 500),
      });
    }
  }

  if (access.tickets) {
    const tickets = await sql<{
      id: string;
      title: string;
      priority: string;
      due_at: string | null;
      assigned_to: string;
      customer_id: string | null;
      customer_name: string | null;
      category: string;
    }>`select t.id, t.title, t.priority, t.due_at::text as due_at, coalesce(t.assigned_to,'') as assigned_to,
              t.customer_id, c.name as customer_name, t.category
       from tickets t
       left join customers c on c.id = t.customer_id
       where t.tenant_id = ${tid} and t.status not in ('resolved','closed')
         and (
           t.priority in ('high','urgent')
           or (t.due_at is not null and t.due_at < ${now})
           or t.category in ('install','field')
         )
       order by t.created_at asc
       limit 20`;
    for (const row of tickets) {
      if (access.assignedOnly) {
        const mine = userId && row.assigned_to === userId;
        const field = !row.assigned_to && (row.category === "install" || row.category === "field");
        if (!mine && !field) continue;
      }
      const past = row.due_at ? Date.parse(row.due_at) < now.getTime() : false;
      const ageH = past && row.due_at ? (now.getTime() - Date.parse(row.due_at)) / 3_600_000 : 0;
      let score = 2600;
      if (past) score = 1000 - Math.min(ageH, 900);
      else if (row.priority === "urgent") score = 2000;
      else if (row.priority === "high") score = 2500;
      else score = 5600;
      queue.push({
        id: `tix_${row.id}`,
        kind: "ticket",
        subject: row.customer_name || row.title,
        context: `Ticket · ${row.title}`,
        urgency: past ? "Past SLA" : row.priority === "urgent" ? "Urgent" : "Open",
        action: access.assign ? "assign" : "open",
        actionLabel: access.assign ? "Assign" : "Open",
        entityId: row.id,
        customerId: row.customer_id || "",
        phoneMask: "",
        href: `/app/tickets/${row.id}`,
        score,
      });
    }
  }

  if (access.customers) {
    for (const c of highChurn.slice(0, 5)) {
      queue.push({
        id: `churn_${c.customerId}`,
        kind: "churn",
        subject: c.name,
        context: c.reasons[0] || "High churn risk",
        urgency: "Contact",
        action: "open",
        actionLabel: "Open",
        entityId: c.customerId,
        customerId: c.customerId,
        phoneMask: "",
        href: `/app/customers/${c.customerId}`,
        score: 5000 - Math.min(c.score, 40),
      });
    }
  }

  if (access.leads) {
    const installs = await sql<{ id: string; name: string; status: string }>`
      select id, name, status from leads
      where tenant_id = ${tid} and archived_at is null and conversion_status = 'open'
        and (status in ('installation_pending','installation_scheduled') or installation_status in ('scheduled','in_progress'))
      order by coalesce(scheduled_installation_at, created_at) asc
      limit 5`;
    for (const row of installs) {
      queue.push({
        id: `lead_${row.id}`,
        kind: "install",
        subject: row.name,
        context: "Installation pending",
        urgency: "Field",
        action: "open",
        actionLabel: "Open",
        entityId: row.id,
        customerId: "",
        phoneMask: "",
        href: `/app/leads/${row.id}`,
        score: 5500,
      });
    }
  }

  if (access.services || hasJobs(access)) {
    const jobs = await sql<{ id: string; kind: string; last_error: string }>`
      select id, kind, coalesce(last_error,'') as last_error
      from job_queue
      where tenant_id = ${tid} and status = 'failed'
      order by created_at desc
      limit 4`;
    for (const row of jobs) {
      queue.push({
        id: `job_${row.id}`,
        kind: "provision",
        subject: row.kind || "Provisioning",
        context: row.last_error ? row.last_error.slice(0, 80) : "Provisioning failed",
        urgency: "Failed",
        action: "open",
        actionLabel: "Open",
        entityId: row.id,
        customerId: "",
        phoneMask: "",
        href: "/app/services",
        score: 1800,
      });
    }
  }

  const activity = await loadActivity(sql, tid, access);

  const setupItems = [
    {
      id: "profile",
      label: "Company profile",
      detail: "Add a support phone or email customers can use.",
      done: Boolean((ten?.support_phone || "").trim() || (ten?.support_email || "").trim()),
      href: "/app/settings/general",
      action: "Edit profile",
    },
    {
      id: "gateway",
      label: "Connect a payment gateway",
      detail: "Configure M-Pesa or another payment method.",
      done: (metrics?.gateway_n ?? 0) > 0,
      href: "/app/settings/payments",
      action: "Configure",
    },
    {
      id: "package",
      label: "Create your first package",
      detail: "Define the services you sell.",
      done: (metrics?.packages_n ?? 0) > 0,
      href: "/app/packages",
      action: "Add package",
    },
    {
      id: "router",
      label: "Add your first router",
      detail: "Connect a MikroTik router to begin network monitoring.",
      done: (metrics?.routers_live ?? 0) > 0,
      href: "/app/routers",
      action: "Add router",
    },
    {
      id: "customer",
      label: "Add your first customer",
      detail: "Leads are not counted until they are converted.",
      done: (metrics?.customers_n ?? 0) > 0,
      href: "/app/customers",
      action: "Add customer",
    },
    {
      id: "method",
      label: "Payment method configured",
      detail: "Enable at least one way to record or collect payments.",
      done: (metrics?.methods_n ?? 0) > 0,
      href: "/app/settings/payments",
      action: "Payment methods",
    },
  ];
  const completed = setupItems.filter((item) => item.done).length;

  const ops: DashboardOps = {
    period,
    timezone,
    generatedAt: now.toISOString(),
    viewerName: greetingName(opts?.viewerName || ""),
    access,
    attention,
    attentionClear: attention.length === 0,
    metrics: {
      collectedKes: collected,
      collectedPrevKes: collectedPrev,
      collectedHint: collectedHint(collected, collectedPrev),
      activeSubscribers: active,
      activeHint: subscriberHint(added),
      onlineNow: online,
      onlineHint: onlineHint(online, active),
      outstandingKes: outstanding,
      outstandingHint: outstandingHint(outstanding),
    },
    revenue,
    network,
    networkMore,
    workQueue: sortWork(queue),
    activity,
    setup: {
      required: completed < setupItems.length,
      completed,
      total: setupItems.length,
      items: setupItems,
    },
  };
  return redactOps(ops, access);
}

function hasJobs(access: ReturnType<typeof dashboardAccess>) {
  return access.services || access.assignedOnly;
}

async function loadActivity(
  sql: Sql,
  tid: string,
  access: ReturnType<typeof dashboardAccess>,
): Promise<DashboardOps["activity"]> {
  const rows: DashboardOps["activity"] = [];
  if (access.payments) {
    const pays = await sql<{ id: string; paid_at: string; amount_kes: number; name: string }>`
      select p.id, p.paid_at::text as paid_at, p.amount_kes, c.name
      from payments p join customers c on c.id = p.customer_id
      where p.tenant_id = ${tid} and p.status = 'confirmed'
      order by p.paid_at desc limit 6`;
    for (const p of pays) {
      rows.push({
        id: `pay_${p.id}`,
        at: p.paid_at,
        text: `KES ${Number(p.amount_kes).toLocaleString("en-KE")} from ${p.name}`,
        href: "/app/billing?tab=payments",
      });
    }
  }
  if (access.services) {
    const services = await sql<{ id: string; created_at: string; name: string; package_name: string }>`
      select s.id, s.created_at::text as created_at, c.name, p.name as package_name
      from services s
      join customers c on c.id = s.customer_id
      join packages p on p.id = s.package_id
      where s.tenant_id = ${tid} and s.deleted_at is null
      order by s.created_at desc limit 5`;
    for (const s of services) {
      rows.push({
        id: `svc_${s.id}`,
        at: s.created_at,
        text: `New service · ${s.name} · ${s.package_name}`,
        href: `/app/services/${s.id}`,
      });
    }
  }
  if (access.tickets) {
    const tickets = await sql<{ id: string; created_at: string; title: string }>`
      select id, created_at::text as created_at, title from tickets
      where tenant_id = ${tid}
      order by created_at desc limit 5`;
    for (const t of tickets) {
      rows.push({
        id: `act_tix_${t.id}`,
        at: t.created_at,
        text: `Ticket opened · ${t.title}`,
        href: `/app/tickets/${t.id}`,
      });
    }
  }
  if (access.customers) {
    const customers = await sql<{ id: string; created_at: string; name: string }>`
      select id, created_at::text as created_at, name from customers
      where tenant_id = ${tid} and deleted_at is null
      order by created_at desc limit 4`;
    for (const c of customers) {
      rows.push({
        id: `cus_${c.id}`,
        at: c.created_at,
        text: `Customer created · ${c.name}`,
        href: `/app/customers/${c.id}`,
      });
    }
  }
  if (access.network) {
    const alerts = await sql<{ id: string; name: string; last_seen: string | null }>`
      select id, name, last_seen::text as last_seen from routers
      where tenant_id = ${tid} and archived_at is null
        and (last_seen is null or last_seen < now() - interval '10 minutes')
      order by last_seen asc nulls first
      limit 3`;
    for (const r of alerts) {
      rows.push({
        id: `rtr_${r.id}`,
        at: r.last_seen || new Date().toISOString(),
        text: `Router alert · ${r.name}`,
        href: access.routers ? `/app/routers/${r.id}` : null,
      });
    }
  }
  return rows
    .filter((row) => row.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 8);
}
