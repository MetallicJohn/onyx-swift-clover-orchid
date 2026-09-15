import {
  accountState,
  DESK_EXPIRING_DAYS,
  lineStatusFromLines,
  likeNeedle,
  normalizeDeskQuery,
  packageSummary,
  serviceStatusSummary,
  type DeskCounters,
  type DeskCustomer,
  type DeskFilters,
  type DeskResult,
  type DeskServiceLine,
} from "./customer-desk-format.ts";
import { listTags } from "./tags.ts";

export {
  accountState,
  accountStateLabel,
  activeDeskFilterCount,
  customerInitials,
  customerRecordPath,
  deskFilterChips,
  DESK_EXPIRING_DAYS,
  DESK_PAGE_SIZE,
  EMPTY_DESK_FILTERS,
  hasActiveDeskFilters,
  likeNeedle,
  lineStatusFromLines,
  lineStatusLabel,
  normalizeDeskQuery,
  normalizeProfileSearch,
  packageSummary,
  PROFILE_TABS,
  selectedCustomersCsv,
  serviceStatusSummary,
  uniqueSmsRecipients,
} from "./customer-desk-format.ts";
export type {
  AccountState,
  DeskAccess,
  DeskBilling,
  DeskCounters,
  DeskCustomer,
  DeskCustomerStatus,
  DeskFilters,
  DeskResult,
  DeskServiceLine,
  DeskServiceStatus,
  DeskTag,
  DeskTagMode,
  LineStatus,
  ProfileAction,
  ProfileSearch,
  ProfileTab,
} from "./customer-desk-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function liveServiceSql() {
  return `exists (
    select 1 from services s
    where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null
      and s.status in ('active','grace')
  )`;
}

function serviceExistsSql(extra: string) {
  return `exists (
    select 1 from services s
    where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null
      ${extra}
  )`;
}

function outstandingSql() {
  return `exists (
    select 1 from invoices i
    where i.tenant_id = c.tenant_id and i.customer_id = c.id
      and i.status in ('due','overdue','issued','partial')
      and greatest(0, i.amount_kes - i.paid_kes) > 0
  )`;
}

function overdueSql() {
  return `exists (
    select 1 from invoices i
    where i.tenant_id = c.tenant_id and i.customer_id = c.id
      and i.status in ('due','overdue','issued','partial')
      and greatest(0, i.amount_kes - i.paid_kes) > 0
      and (i.status = 'overdue' or i.due_date < current_date)
  )`;
}

export function deskWhere(tenantId: string, q: DeskFilters): { clause: string; params: unknown[] } {
  const params: unknown[] = [tenantId];
  const where = ["c.tenant_id = $1", "c.deleted_at is null"];

  if (q.q) {
    params.push(likeNeedle(q.q));
    const p = `$${params.length}`;
    where.push(`(
      c.name ilike ${p} escape '#'
      or coalesce(c.account_number,'') ilike ${p} escape '#'
      or c.phone ilike ${p} escape '#'
      or c.email ilike ${p} escape '#'
      or c.address ilike ${p} escape '#'
      or exists (
        select 1 from services s
        where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null
          and (
            s.id ilike ${p} escape '#'
            or coalesce(s.username,'') ilike ${p} escape '#'
            or coalesce(s.static_ip,'') ilike ${p} escape '#'
          )
      )
    )`);
  }

  if (q.customerStatus === "active") {
    where.push(`c.status <> 'inactive'`);
    where.push(liveServiceSql());
  } else if (q.customerStatus === "suspended") {
    where.push(`c.status <> 'inactive'`);
    where.push(`not ${liveServiceSql()}`);
    where.push(`(c.status = 'suspended' or ${serviceExistsSql("and s.status = 'suspended'")})`);
  } else if (q.customerStatus === "inactive") {
    where.push(`(
      c.status = 'inactive'
      or (
        not ${liveServiceSql()}
        and not ${serviceExistsSql("and s.status = 'suspended'")}
        and c.status <> 'suspended'
      )
    )`);
  }

  if (q.serviceStatus === "expired") {
    where.push(serviceExistsSql(`and (
      s.status = 'terminated'
      or (
        coalesce(s.access_until, s.period_end) is not null
        and coalesce(s.access_until, s.period_end) < now()
        and s.status not in ('active','grace')
      )
    )`));
  } else if (q.serviceStatus !== "all") {
    params.push(q.serviceStatus);
    where.push(serviceExistsSql(`and s.status = $${params.length}`));
  }

  if (q.access !== "all") {
    params.push(q.access);
    where.push(serviceExistsSql(`and s.access_method = $${params.length}`));
  }

  if (q.packageName) {
    params.push(q.packageName);
    where.push(`exists (
      select 1 from services s
      join packages p on p.id = s.package_id
      where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null
        and p.name = $${params.length}
    )`);
  }

  if (q.location) {
    params.push(q.location);
    where.push(`c.address = $${params.length}`);
  }

  if (q.billing === "clear") {
    where.push(`not ${outstandingSql()}`);
  } else if (q.billing === "due") {
    where.push(outstandingSql());
  } else if (q.billing === "overdue" || q.overdue) {
    where.push(overdueSql());
  }

  if (q.expiringSoon) {
    params.push(DESK_EXPIRING_DAYS);
    where.push(serviceExistsSql(`and s.status in ('active','grace')
      and coalesce(s.access_until, s.period_end) is not null
      and coalesce(s.access_until, s.period_end) >= now()
      and coalesce(s.access_until, s.period_end) <= now() + ($${params.length}::int * interval '1 day')`));
  }

  if (q.onGrace) {
    where.push(`(
      ${serviceExistsSql("and s.status = 'grace'")}
      or exists (
        select 1 from service_grace_periods g
        where g.tenant_id = c.tenant_id and g.customer_id = c.id and g.status = 'active'
      )
    )`);
  }

  if (q.tagIds.length) {
    params.push(q.tagIds);
    const p = `$${params.length}`;
    if (q.tagMode === "all") {
      params.push(q.tagIds.length);
      where.push(`(
        select count(distinct a.tag_id) from customer_tag_assignments a
        where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.tag_id = any(${p}::text[])
      ) = $${params.length}`);
    } else {
      where.push(`exists (
        select 1 from customer_tag_assignments a
        where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.tag_id = any(${p}::text[])
      )`);
    }
  }

  return { clause: where.join(" and "), params };
}

function effectiveEnd(line: { period_end: string | null; access_until: string | null }) {
  return line.access_until || line.period_end;
}

async function loadDeskCounters(sql: Sql, tenantId: string): Promise<DeskCounters> {
  const [row] = await sql.query<DeskCounters>(
    `select
        count(*)::int as total,
        count(*) filter (
          where c.status <> 'inactive'
            and exists (
              select 1 from services s
              where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null
                and s.status in ('active','grace')
            )
        )::int as active,
        count(*) filter (
          where c.status <> 'inactive'
            and not exists (
              select 1 from services s
              where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null
                and s.status in ('active','grace')
            )
            and (
              c.status = 'suspended'
              or exists (
                select 1 from services s
                where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null
                  and s.status = 'suspended'
              )
            )
        )::int as suspended,
        count(*) filter (
          where exists (
            select 1 from invoices i
            where i.tenant_id = c.tenant_id and i.customer_id = c.id
              and i.status in ('due','overdue','issued','partial')
              and greatest(0, i.amount_kes - i.paid_kes) > 0
              and (i.status = 'overdue' or i.due_date < current_date)
          )
        )::int as overdue
     from customers c
     where c.tenant_id = $1 and c.deleted_at is null`,
    [tenantId],
  );
  return row ?? { total: 0, active: 0, suspended: 0, overdue: 0 };
}

async function hydratePage(
  sql: Sql,
  tenantId: string,
  cores: Array<
    Omit<
      DeskCustomer,
      | "service_count"
      | "balance_kes"
      | "overdue"
      | "on_grace"
      | "account_state"
      | "line_status"
      | "service_status_summary"
      | "package_summary"
      | "package_names"
      | "access_methods"
      | "next_expiry"
      | "last_activity"
      | "tags"
      | "live_service_ids"
      | "suspended_service_ids"
    >
  >,
): Promise<DeskCustomer[]> {
  if (!cores.length) return [];
  const ids = cores.map((c) => c.id);

  const services = await sql.query<DeskServiceLine & { customer_id: string; grace_active: boolean }>(
    `select s.customer_id, s.id, s.access_method, s.status, s.username, s.static_ip, p.name as package_name,
            s.period_end::text as period_end, s.access_until::text as access_until,
            exists (
              select 1 from service_grace_periods g
              where g.tenant_id = s.tenant_id and g.service_id = s.id and g.status = 'active'
            ) as grace_active
     from services s
     join packages p on p.id = s.package_id
     where s.tenant_id = $1 and s.customer_id = any($2::text[]) and s.deleted_at is null
     order by s.created_at desc`,
    [tenantId, ids],
  );

  const balances = await sql.query<{ customer_id: string; balance_kes: number }>(
    `select customer_id, coalesce(sum(greatest(0, amount_kes - paid_kes)),0)::int as balance_kes
     from invoices
     where tenant_id = $1 and customer_id = any($2::text[])
       and status in ('due','overdue','issued','partial')
     group by customer_id`,
    [tenantId, ids],
  );

  const overdueRows = await sql.query<{ customer_id: string }>(
    `select distinct customer_id
     from invoices
     where tenant_id = $1 and customer_id = any($2::text[])
       and status in ('due','overdue','issued','partial')
       and greatest(0, amount_kes - paid_kes) > 0
       and (status = 'overdue' or due_date < current_date)`,
    [tenantId, ids],
  );

  const activity = await sql.query<{ customer_id: string; last_activity: string }>(
    `select customer_id, max(at)::text as last_activity
     from (
       select customer_id, paid_at as at
       from payments
       where tenant_id = $1 and customer_id = any($2::text[]) and status = 'confirmed'
       union all
       select customer_id, created_at as at
       from tickets
       where tenant_id = $1 and customer_id = any($2::text[])
       union all
       select s.customer_id, greatest(rs.started_at, coalesce(rs.stopped_at, rs.started_at)) as at
       from services s
       join radius_sessions rs on rs.tenant_id = s.tenant_id and rs.username = s.username
       where s.tenant_id = $1 and s.customer_id = any($2::text[])
         and s.deleted_at is null and s.username is not null and s.username <> ''
     ) x
     group by customer_id`,
    [tenantId, ids],
  );

  const tagRows = await sql.query<{ customer_id: string; id: string; name: string; enabled: boolean }>(
    `select a.customer_id, t.id, t.name, t.enabled
     from customer_tag_assignments a
     join customer_tags t on t.id = a.tag_id
     where a.tenant_id = $1 and a.customer_id = any($2::text[])
     order by t.name`,
    [tenantId, ids],
  );

  const byCustomer = new Map<string, typeof services>();
  for (const s of services) {
    const list = byCustomer.get(s.customer_id) ?? [];
    list.push(s);
    byCustomer.set(s.customer_id, list);
  }
  const balBy = new Map(balances.map((b) => [b.customer_id, b.balance_kes]));
  const overdueSet = new Set(overdueRows.map((r) => r.customer_id));
  const actBy = new Map(activity.map((a) => [a.customer_id, a.last_activity]));
  const tagsBy = new Map<string, { id: string; name: string; enabled: boolean }[]>();
  for (const t of tagRows) {
    const list = tagsBy.get(t.customer_id) ?? [];
    list.push({ id: t.id, name: t.name, enabled: t.enabled });
    tagsBy.set(t.customer_id, list);
  }

  return cores.map((c) => {
    const lines = byCustomer.get(c.id) ?? [];
    const live = lines.filter((s) => s.status === "active" || s.status === "grace");
    const suspended = lines.filter((s) => s.status === "suspended");
    const next =
      live
        .map((s) => effectiveEnd(s))
        .filter((iso): iso is string => Boolean(iso))
        .sort()[0] ?? null;
    const names = [...new Set(lines.map((s) => s.package_name).filter(Boolean))];
    const methods = [...new Set(lines.map((s) => s.access_method).filter(Boolean))];
    return {
      ...c,
      service_count: lines.length,
      balance_kes: balBy.get(c.id) ?? 0,
      overdue: overdueSet.has(c.id),
      on_grace: lines.some((s) => s.status === "grace" || s.grace_active),
      account_state: accountState({ customerStatus: c.status, live: live.length, suspended: suspended.length }),
      line_status: lineStatusFromLines(lines),
      service_status_summary: serviceStatusSummary(lines),
      package_summary: packageSummary(names),
      package_names: names,
      access_methods: methods,
      next_expiry: next,
      last_activity: actBy.get(c.id) ?? null,
      tags: tagsBy.get(c.id) ?? [],
      live_service_ids: live.map((s) => s.id),
      suspended_service_ids: suspended.map((s) => s.id),
    };
  });
}

export async function queryCustomersDesk(
  sql: Sql,
  tenantId: string,
  raw?: Partial<DeskFilters> | Record<string, unknown> | null,
): Promise<DeskResult> {
  const q = normalizeDeskQuery(raw);
  const { clause, params } = deskWhere(tenantId, q);
  const [countRow] = await sql.query<{ n: number }>(`select count(*)::int as n from customers c where ${clause}`, params);
  const total = countRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / q.pageSize) || 1);
  const page = Math.min(q.page, pages);
  const listParams = [...params, q.pageSize, (page - 1) * q.pageSize];
  const cores = await sql.query<{
    id: string;
    type: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    status: string;
    account_number: string;
    notes: string;
    created_at: string;
  }>(
    `select c.id, c.type, c.name, c.phone, c.email, c.address, c.status,
            coalesce(c.account_number,'') as account_number, coalesce(c.notes,'') as notes,
            c.created_at::text as created_at
     from customers c
     where ${clause}
     order by c.created_at desc, c.id desc
     limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams,
  );

  const [customers, counters, packages, locations, tags] = await Promise.all([
    hydratePage(sql, tenantId, cores),
    loadDeskCounters(sql, tenantId),
    sql.query<{ name: string }>(
      `select distinct p.name
       from packages p
       join services s on s.package_id = p.id and s.tenant_id = p.tenant_id and s.deleted_at is null
       where p.tenant_id = $1
       order by p.name`,
      [tenantId],
    ),
    sql.query<{ address: string }>(
      `select distinct address from customers
       where tenant_id = $1 and deleted_at is null and address <> ''
       order by address`,
      [tenantId],
    ),
    listTags(sql, tenantId),
  ]);

  return {
    customers,
    total,
    page,
    pageSize: q.pageSize,
    pages,
    counters,
    packages: packages.map((p) => p.name),
    locations: locations.map((l) => l.address),
    tags,
  };
}
