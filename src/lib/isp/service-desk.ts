import {
  displayServiceStatus,
  EMPTY_SERVICE_FILTERS,
  likeNeedle,
  networkIdentity,
  normalizeServiceDeskQuery,
  SERVICE_DESK_EXPIRING_DAYS,
  SERVICE_DESK_SORT_SQL,
  type ServiceDeskCounters,
  type ServiceDeskFilters,
  type ServiceDeskOption,
  type ServiceDeskResult,
  type ServiceDeskRow,
} from "./service-desk-format.ts";
import type { AccessMethod, ServiceStatus } from "./types.ts";

export {
  activeServiceFilterCount,
  displayServiceStatus,
  EMPTY_SERVICE_FILTERS,
  hasActiveServiceFilters,
  isAccessExpired,
  likeNeedle,
  networkIdentity,
  normalizeServiceDeskQuery,
  selectedServicesCsv,
  SERVICE_DESK_EXPIRING_DAYS,
  SERVICE_DESK_PAGE_SIZE,
  serviceDeskFilterChips,
  serviceRecordPath,
  serviceStatusLabel,
  sessionLabel,
  speedLabel,
  suspendReasonLabel,
  toServiceRow,
} from "./service-desk-format.ts";
export type {
  ServiceDeskAccess,
  ServiceDeskBilling,
  ServiceDeskCounters,
  ServiceDeskDir,
  ServiceDeskFilters,
  ServiceDeskOption,
  ServiceDeskResult,
  ServiceDeskRow,
  ServiceDeskSort,
  ServiceDeskStatusFilter,
  ServiceDisplayStatus,
} from "./service-desk-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function expiredSql(alias = "s") {
  return `(
    ${alias}.status not in ('active','grace','pending')
    and coalesce(${alias}.access_until, ${alias}.period_end) is not null
    and coalesce(${alias}.access_until, ${alias}.period_end) < now()
  )`;
}

function outstandingSql() {
  return `exists (
    select 1 from invoices i
    where i.tenant_id = s.tenant_id
      and i.status in ('due','overdue','issued','partial')
      and greatest(0, i.amount_kes - i.paid_kes) > 0
      and (
        i.service_id = s.id
        or exists (
          select 1 from invoice_items ii
          where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = s.id
        )
        or (
          i.customer_id = s.customer_id
          and (i.service_id is null or i.service_id = '')
          and not exists (
            select 1 from invoice_items ii
            where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id
              and ii.service_id is not null and ii.service_id <> ''
          )
          and (
            select count(*) from services s2
            where s2.tenant_id = s.tenant_id and s2.customer_id = s.customer_id
              and s2.deleted_at is null and s2.status <> 'terminated'
          ) = 1
        )
      )
  )`;
}

function overdueSql() {
  return `exists (
    select 1 from invoices i
    where i.tenant_id = s.tenant_id
      and i.status in ('due','overdue','issued','partial')
      and greatest(0, i.amount_kes - i.paid_kes) > 0
      and (i.status = 'overdue' or i.due_date < current_date)
      and (
        i.service_id = s.id
        or exists (
          select 1 from invoice_items ii
          where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = s.id
        )
        or (
          i.customer_id = s.customer_id
          and (i.service_id is null or i.service_id = '')
          and not exists (
            select 1 from invoice_items ii
            where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id
              and ii.service_id is not null and ii.service_id <> ''
          )
          and (
            select count(*) from services s2
            where s2.tenant_id = s.tenant_id and s2.customer_id = s.customer_id
              and s2.deleted_at is null and s2.status <> 'terminated'
          ) = 1
        )
      )
  )`;
}

export function serviceDeskWhere(tenantId: string, q: ServiceDeskFilters): { clause: string; params: unknown[] } {
  const params: unknown[] = [tenantId];
  const where = ["s.tenant_id = $1", "s.deleted_at is null", "c.deleted_at is null", "s.access_method <> 'hotspot'"];

  if (q.q) {
    params.push(likeNeedle(q.q));
    const p = `$${params.length}`;
    where.push(`(
      s.id ilike ${p} escape '#'
      or c.name ilike ${p} escape '#'
      or coalesce(s.account_number,'') ilike ${p} escape '#'
      or coalesce(s.name,'') ilike ${p} escape '#'
      or c.phone ilike ${p} escape '#'
      or c.email ilike ${p} escape '#'
      or c.address ilike ${p} escape '#'
      or coalesce(s.username,'') ilike ${p} escape '#'
      or coalesce(s.static_ip,'') ilike ${p} escape '#'
      or coalesce(s.mac_address,'') ilike ${p} escape '#'
      or p.name ilike ${p} escape '#'
      or coalesce(sp.framed_ip,'') ilike ${p} escape '#'
      or coalesce(r.name,'') ilike ${p} escape '#'
      or exists (
        select 1 from cpe_devices d
        where d.tenant_id = s.tenant_id and d.service_id = s.id and d.serial ilike ${p} escape '#'
      )
    )`);
  }

  if (q.status === "expired") {
    where.push(expiredSql());
  } else if (q.status === "grace") {
    where.push(`(s.status = 'grace' or g.id is not null)`);
  } else if (q.status === "suspended") {
    where.push(`s.status = 'suspended'`);
    where.push(`not ${expiredSql()}`);
  } else if (q.status !== "all") {
    params.push(q.status);
    where.push(`s.status = $${params.length}`);
  }

  if (q.access !== "all") {
    params.push(q.access);
    where.push(`s.access_method = $${params.length}`);
  }

  if (q.packageName) {
    params.push(q.packageName);
    where.push(`p.name = $${params.length}`);
  }

  if (q.customerId) {
    params.push(q.customerId);
    where.push(`s.customer_id = $${params.length}`);
  }

  if (q.location) {
    params.push(q.location);
    where.push(`c.address = $${params.length}`);
  }

  if (q.routerId) {
    params.push(q.routerId);
    where.push(`sp.router_id = $${params.length}`);
  }

  if (q.poolId) {
    params.push(q.poolId);
    where.push(`exists (
      select 1 from ip_addresses a
      where a.tenant_id = s.tenant_id and a.service_id = s.id and a.pool_id = $${params.length}
    )`);
  }

  if (q.billing === "clear") {
    where.push(`not ${outstandingSql()}`);
  } else if (q.billing === "due") {
    where.push(outstandingSql());
  } else if (q.billing === "overdue" || q.overdue) {
    where.push(overdueSql());
  }

  if (q.expiringSoon) {
    params.push(SERVICE_DESK_EXPIRING_DAYS);
    where.push(`s.status in ('active','grace')
      and coalesce(s.access_until, s.period_end) is not null
      and coalesce(s.access_until, s.period_end) >= now()
      and coalesce(s.access_until, s.period_end) <= now() + ($${params.length}::int * interval '1 day')`);
  }

  if (q.onGrace) {
    where.push(`(s.status = 'grace' or g.id is not null)`);
  }

  return { clause: where.join(" and "), params };
}

const FROM_SQL = `
  from services s
  join customers c on c.id = s.customer_id
  join packages p on p.id = s.package_id
  left join service_grace_periods g
    on g.service_id = s.id and g.tenant_id = s.tenant_id and g.status = 'active'
  left join service_provisioning sp
    on sp.service_id = s.id and sp.tenant_id = s.tenant_id
  left join routers r on r.id = sp.router_id
  left join (
    select coalesce(i.service_id, ii.service_id) as service_id,
           coalesce(sum(greatest(0, i.amount_kes - i.paid_kes)),0)::int as balance_kes,
           bool_or(i.status = 'overdue' or i.due_date < current_date) as overdue
    from invoices i
    left join invoice_items ii on ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id is not null
    where i.tenant_id = $1 and i.status in ('due','overdue','issued','partial')
    group by coalesce(i.service_id, ii.service_id)
  ) bal on bal.service_id = s.id
  left join (
    select username,
           max(greatest(started_at, coalesce(stopped_at, started_at))) as last_at,
           bool_or(stopped_at is null) as online
    from radius_sessions
    where tenant_id = $1
    group by username
  ) rs on s.username is not null and s.username <> '' and rs.username = s.username
`;

async function loadCounters(sql: Sql, tenantId: string): Promise<ServiceDeskCounters> {
  const [row] = await sql.query<ServiceDeskCounters>(
    `select
        count(*)::int as total,
        count(*) filter (where s.status = 'active')::int as active,
        count(*) filter (where s.status = 'pending')::int as pending,
        count(*) filter (where ${expiredSql()})::int as expired,
        count(*) filter (where s.status = 'suspended' and not ${expiredSql()})::int as suspended,
        count(*) filter (
          where s.status = 'grace' or exists (
            select 1 from service_grace_periods g
            where g.tenant_id = s.tenant_id and g.service_id = s.id and g.status = 'active'
          )
        )::int as grace
     from services s
     join customers c on c.id = s.customer_id
     where s.tenant_id = $1 and s.deleted_at is null and c.deleted_at is null
       and s.access_method <> 'hotspot'`,
    [tenantId],
  );
  return row ?? { total: 0, active: 0, pending: 0, expired: 0, suspended: 0, grace: 0 };
}

type CoreRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  account_number: string;
  customer_account_number?: string;
  location: string;
  package_id: string;
  package_name: string;
  access_method: AccessMethod;
  username: string | null;
  static_ip: string | null;
  framed_ip: string;
  mac_address: string;
  status: ServiceStatus;
  created_at: string;
  period_end: string | null;
  access_until: string | null;
  expiry_source: string;
  bundle_used_mb: number;
  bundle_mb: number;
  suspend_reason: string;
  notes: string;
  download_mbps: number;
  upload_mbps: number;
  grace_active: boolean;
  grace_expires_at: string | null;
  router_id: string;
  router_name: string;
  provision_overall: string;
  balance_kes: number;
  overdue: boolean;
  last_activity: string | null;
  session_online: boolean;
};

function mapRow(
  row: CoreRow,
  extra: { pool_id: string; pool_name: string; assigned_ip: string },
): ServiceDeskRow {
  const identity = networkIdentity(row) || "—";
  return {
    ...row,
    display_status: displayServiceStatus(row),
    pool_id: extra.pool_id,
    pool_name: extra.pool_name,
    assigned_ip: extra.assigned_ip,
    identity,
  };
}

export async function queryServicesDesk(
  sql: Sql,
  tenantId: string,
  raw?: Partial<ServiceDeskFilters> | Record<string, unknown> | null,
): Promise<ServiceDeskResult> {
  const q = normalizeServiceDeskQuery(raw);
  const { clause, params } = serviceDeskWhere(tenantId, q);
  const [countRow] = await sql.query<{ n: number }>(`select count(*)::int as n ${FROM_SQL} where ${clause}`, params);
  const total = countRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / q.pageSize) || 1);
  const page = Math.min(q.page, pages);
  const sortExpr = SERVICE_DESK_SORT_SQL[q.sort] || SERVICE_DESK_SORT_SQL.created;
  const dir = q.dir === "asc" ? "asc" : "desc";
  const listParams = [...params, q.pageSize, (page - 1) * q.pageSize];
  const cores = await sql.query<CoreRow>(
    `select s.id, s.customer_id, c.name as customer_name, c.phone as customer_phone,
            coalesce(c.email,'') as customer_email,
            coalesce(s.account_number,'') as account_number,
            coalesce(c.account_number,'') as customer_account_number,
            coalesce(nullif(s.name,''), p.name) as name,
            coalesce(c.address,'') as location,
            s.package_id, p.name as package_name, s.access_method,
            s.username, s.static_ip, coalesce(sp.framed_ip,'') as framed_ip,
            coalesce(s.mac_address,'') as mac_address, s.status,
            s.created_at::text as created_at,
            s.period_end::text as period_end, s.access_until::text as access_until,
            coalesce(s.expiry_source,'billing') as expiry_source,
            s.bundle_used_mb, p.bundle_mb, s.suspend_reason,
            coalesce(s.notes,'') as notes,
            p.download_mbps, p.upload_mbps,
            (g.id is not null) as grace_active, g.expires_at::text as grace_expires_at,
            coalesce(sp.router_id,'') as router_id, coalesce(r.name,'') as router_name,
            coalesce(sp.overall,'') as provision_overall,
            coalesce(bal.balance_kes,0)::int as balance_kes,
            coalesce(bal.overdue,false) as overdue,
            rs.last_at::text as last_activity,
            coalesce(rs.online,false) as session_online
     ${FROM_SQL}
     where ${clause}
     order by ${sortExpr} ${dir} nulls last, s.id desc
     limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams,
  );

  const ids = cores.map((s) => s.id);
  const ipRows = ids.length
    ? await sql.query<{ service_id: string; pool_id: string; pool_name: string; address: string }>(
        `select a.service_id, coalesce(a.pool_id,'') as pool_id,
                coalesce(pool.name,'') as pool_name, a.address
         from ip_addresses a
         left join ip_pools pool on pool.id = a.pool_id
         where a.tenant_id = $1 and a.service_id = any($2::text[])
         order by a.created_at desc`,
        [tenantId, ids],
      )
    : [];
  const ipBy = new Map<string, { pool_id: string; pool_name: string; assigned_ip: string }>();
  for (const ip of ipRows) {
    if (!ipBy.has(ip.service_id)) {
      ipBy.set(ip.service_id, { pool_id: ip.pool_id, pool_name: ip.pool_name, assigned_ip: ip.address });
    }
  }

  const [counters, packages, packageOptions, locations, routers, pools, customers] = await Promise.all([
    loadCounters(sql, tenantId),
    sql.query<{ name: string }>(
      `select distinct p.name
       from packages p
       join services s on s.package_id = p.id and s.tenant_id = p.tenant_id and s.deleted_at is null
       where p.tenant_id = $1 and p.access_method <> 'hotspot' and s.access_method <> 'hotspot'
       order by p.name`,
      [tenantId],
    ),
    sql.query<{ id: string; name: string; access_method: string }>(
      `select id, name, access_method from packages
       where tenant_id = $1 and active = true and access_method <> 'hotspot'
       order by name`,
      [tenantId],
    ),
    sql.query<{ address: string }>(
      `select distinct c.address
       from services s
       join customers c on c.id = s.customer_id
       where s.tenant_id = $1 and s.deleted_at is null and c.deleted_at is null and c.address <> ''
         and s.access_method <> 'hotspot'
       order by c.address`,
      [tenantId],
    ),
    sql.query<ServiceDeskOption>(
      `select distinct r.id, r.name
       from service_provisioning sp
       join routers r on r.id = sp.router_id
       join services s on s.id = sp.service_id and s.deleted_at is null
       where sp.tenant_id = $1
       order by r.name`,
      [tenantId],
    ),
    sql.query<ServiceDeskOption>(
      `select distinct pool.id, pool.name
       from ip_addresses a
       join ip_pools pool on pool.id = a.pool_id
       join services s on s.id = a.service_id and s.deleted_at is null
       where a.tenant_id = $1
       order by pool.name`,
      [tenantId],
    ),
    sql.query<ServiceDeskOption>(
      `select id, name from customers
       where tenant_id = $1 and deleted_at is null
       order by name`,
      [tenantId],
    ),
  ]);

  return {
    services: cores.map((row) =>
      mapRow(row, ipBy.get(row.id) ?? { pool_id: "", pool_name: "", assigned_ip: "" }),
    ),
    total,
    page,
    pageSize: q.pageSize,
    pages,
    counters,
    packages: packages.map((p) => p.name),
    packageOptions,
    locations: locations.map((l) => l.address),
    routers,
    pools,
    customers,
  };
}

export { EMPTY_SERVICE_FILTERS as EMPTY_DESK_FILTERS };
