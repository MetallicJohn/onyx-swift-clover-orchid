import { nid } from "../utils.ts";
import { likeNeedle } from "./customer-desk-format.ts";
import { cidrOverlaps, cidrSpan, formatIpv4, parseIpv4 } from "./ipam.ts";
import { publicOnlineStatus, recordProvisionEvent } from "./router-provisioning.ts";
import {
  listPayloadHasSecrets,
  poolUsage,
  rangeOverlaps,
  validatePoolDraft,
  type NormalizedPoolDraft,
  type PoolDraft,
  type RouterDeskCounters,
  type RouterDeskFilters,
  type RouterDeskRow,
} from "./router-desk-format.ts";

export { listPayloadHasSecrets, validatePoolDraft };
export type { PoolDraft, RouterDeskFilters, RouterDeskRow };

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const LIST_SELECT = `
  r.id, r.name, r.identity,
  coalesce(r.management_ip,'') as management_ip,
  coalesce(r.model,'') as model,
  coalesce(r.vendor,'') as vendor,
  coalesce(r.site_pop, r.location, '') as site_pop,
  coalesce(r.location,'') as location,
  r.role, r.wg_status,
  coalesce(r.provisioning_status,'pending') as provisioning_status,
  r.last_seen::text as last_seen,
  coalesce(r.enabled, true) as enabled,
  (r.archived_at is not null) as archived,
  coalesce(pc.n, 0)::int as pool_count,
  coalesce(sc.n, 0)::int as service_count,
  coalesce(cc.n, 0)::int as customer_count
`;

function countsJoin() {
  return `
    left join (
      select a.router_id, count(*)::int as n
      from router_pool_assignments a
      join ip_pools p on p.id = a.pool_id and p.archived_at is null
      group by a.router_id
    ) pc on pc.router_id = r.id
    left join (
      select router_id, count(distinct service_id)::int as n, count(distinct customer_id)::int as customers
      from (
        select sp.router_id, s.id as service_id, s.customer_id
        from service_provisioning sp
        join services s on s.id = sp.service_id and s.tenant_id = sp.tenant_id and s.deleted_at is null
        where sp.tenant_id = $1 and s.status in ('active','grace')
        union
        select a.router_id, s.id, s.customer_id
        from router_pool_assignments a
        join ip_addresses ip on ip.pool_id = a.pool_id and ip.tenant_id = a.tenant_id
        join services s on s.id = ip.service_id and s.tenant_id = a.tenant_id and s.deleted_at is null
        where a.tenant_id = $1 and s.status in ('active','grace')
      ) live
      group by router_id
    ) sc on sc.router_id = r.id
    left join (
      select router_id, count(distinct customer_id)::int as n
      from (
        select sp.router_id, s.customer_id
        from service_provisioning sp
        join services s on s.id = sp.service_id and s.tenant_id = sp.tenant_id and s.deleted_at is null
        where sp.tenant_id = $1 and s.status in ('active','grace')
        union
        select a.router_id, s.customer_id
        from router_pool_assignments a
        join ip_addresses ip on ip.pool_id = a.pool_id and ip.tenant_id = a.tenant_id
        join services s on s.id = ip.service_id and s.tenant_id = a.tenant_id and s.deleted_at is null
        where a.tenant_id = $1 and s.status in ('active','grace')
      ) live
      group by router_id
    ) cc on cc.router_id = r.id
  `;
}

function mapRow(row: {
  id: string;
  name: string;
  identity: string;
  management_ip: string;
  model: string;
  vendor: string;
  site_pop: string;
  location: string;
  role: string;
  wg_status: string;
  provisioning_status: string;
  last_seen: string | null;
  enabled: boolean;
  archived: boolean;
  pool_count: number;
  service_count: number;
  customer_count: number;
}): RouterDeskRow {
  const { reachability, online } = publicOnlineStatus(row.last_seen, row.enabled === false ? "offline" : row.wg_status);
  return {
    id: row.id,
    name: row.name,
    identity: row.identity,
    management_ip: row.management_ip,
    model: row.model,
    vendor: row.vendor,
    site_pop: row.site_pop,
    location: row.location,
    role: row.role,
    wg_status: row.wg_status,
    provisioning_status: row.provisioning_status,
    reachability: row.enabled === false ? "disabled" : reachability,
    online: row.enabled !== false && online,
    enabled: row.enabled !== false,
    archived: Boolean(row.archived),
    last_seen: row.last_seen,
    pool_count: Number(row.pool_count || 0),
    service_count: Number(row.service_count || 0),
    customer_count: Number(row.customer_count || 0),
  };
}

function whereClause(tenantId: string, q: RouterDeskFilters) {
  const params: unknown[] = [tenantId];
  const parts = ["r.tenant_id = $1"];
  if (q.status === "archived") parts.push("r.archived_at is not null");
  else parts.push("r.archived_at is null");
  if (q.q) {
    params.push(likeNeedle(q.q));
    const i = params.length;
    parts.push(
      `(r.name ilike $${i} escape '#' or r.identity ilike $${i} escape '#' or coalesce(r.management_ip,'') ilike $${i} escape '#' or coalesce(r.site_pop,'') ilike $${i} escape '#' or coalesce(r.model,'') ilike $${i} escape '#' or coalesce(r.vendor,'') ilike $${i} escape '#')`,
    );
  }
  if (q.location) {
    params.push(likeNeedle(q.location));
    parts.push(`(coalesce(r.site_pop, r.location, '') ilike $${params.length} escape '#')`);
  }
  if (q.vendor) {
    params.push(likeNeedle(q.vendor));
    parts.push(`(coalesce(r.vendor,'') ilike $${params.length} escape '#' or coalesce(r.model,'') ilike $${params.length} escape '#')`);
  }
  if (q.status === "online") parts.push(`r.enabled = true and r.last_seen is not null and r.wg_status in ('connected','online')`);
  if (q.status === "offline") parts.push(`(r.enabled = false or r.last_seen is null or r.wg_status not in ('connected','online'))`);
  if (q.status === "awaiting") parts.push(`coalesce(r.provisioning_status,'') in ('pending','awaiting_bootstrap','bootstrapping')`);
  if (q.status === "disabled") parts.push(`r.enabled = false`);
  if (q.hasPools) parts.push(`coalesce(pc.n, 0) > 0`);
  if (q.hasServices) parts.push(`coalesce(sc.n, 0) > 0`);
  return { clause: parts.join(" and "), params };
}

export async function queryRoutersDesk(sql: Sql, tenantId: string, raw: RouterDeskFilters) {
  const q = raw;
  const { clause, params } = whereClause(tenantId, q);
  const join = countsJoin();
  const [countRow] = await sql.query<{ n: number }>(
    `select count(*)::int as n from routers r ${join} where ${clause}`,
    params,
  );
  const total = countRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / q.pageSize));
  const page = Math.min(q.page, pages);
  const offset = (page - 1) * q.pageSize;
  const listParams = [...params, q.pageSize, offset];
  const rows = await sql.query<(Parameters<typeof mapRow>[0])>(
    `select ${LIST_SELECT}
     from routers r
     ${join}
     where ${clause}
     order by r.name asc, r.id asc
     limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams,
  );
  const [counters] = await sql.query<RouterDeskCounters>(
    `select
        count(*) filter (where archived_at is null)::int as total,
        count(*) filter (where archived_at is null and enabled = true and last_seen is not null)::int as online,
        count(*) filter (where archived_at is null and coalesce(provisioning_status,'') in ('pending','awaiting_bootstrap','bootstrapping'))::int as awaiting,
        count(*) filter (where archived_at is null and enabled = false)::int as disabled
     from routers where tenant_id = $1`,
    [tenantId],
  );
  const locations = await sql.query<{ site_pop: string }>(
    `select distinct coalesce(site_pop, location, '') as site_pop
     from routers where tenant_id = $1 and archived_at is null and coalesce(site_pop, location, '') <> ''
     order by 1`,
    [tenantId],
  );
  const vendors = await sql.query<{ vendor: string }>(
    `select distinct coalesce(nullif(vendor,''), model) as vendor
     from routers where tenant_id = $1 and archived_at is null and coalesce(nullif(vendor,''), model) <> ''
     order by 1`,
    [tenantId],
  );
  const routers = rows.map(mapRow);
  if (listPayloadHasSecrets(routers)) throw new Error("Refusing to expose secrets");
  return {
    routers,
    total,
    page,
    pages,
    pageSize: q.pageSize,
    counters: counters ?? { total: 0, online: 0, awaiting: 0, disabled: 0 },
    locations: locations.map((r) => r.site_pop),
    vendors: vendors.map((r) => r.vendor),
  };
}

export type RouterPoolRow = {
  id: string;
  name: string;
  code: string;
  cidr: string;
  gateway: string;
  first_ip: string;
  last_ip: string;
  access_type: string;
  vlan_id: number | null;
  site_pop: string;
  description: string;
  status: string;
  dns_servers: string;
  package_id: string;
  package_name: string;
  updated_at: string | null;
  total: number;
  used: number;
  available: number;
  assigned_services: number;
};

async function poolUsageCounts(sql: Sql, tenantId: string, poolId: string, firstIp: string, lastIp: string) {
  const first = firstIp ? parseIpv4(firstIp) : 0;
  const last = lastIp ? parseIpv4(lastIp) : 0;
  const total = first && last && last >= first ? last - first + 1 : 0;
  const [usedRow] = await sql.query<{ n: number }>(
    `select count(*)::int as n from ip_addresses
     where tenant_id = $1 and pool_id = $2 and status in ('assigned','reserved')`,
    [tenantId, poolId],
  );
  const [svcRow] = await sql.query<{ n: number }>(
    `select count(distinct service_id)::int as n from ip_addresses
     where tenant_id = $1 and pool_id = $2 and service_id is not null`,
    [tenantId, poolId],
  );
  const usage = poolUsage(total, usedRow?.n ?? 0);
  return { ...usage, assigned_services: svcRow?.n ?? 0 };
}

export async function listRouterPools(sql: Sql, tenantId: string, routerId: string): Promise<RouterPoolRow[]> {
  const [router] = await sql.query<{ id: string }>(
    `select id from routers where id = $1 and tenant_id = $2`,
    [routerId, tenantId],
  );
  if (!router) throw new Error("Router not found");
  const rows = await sql.query<{
    id: string;
    name: string;
    code: string;
    cidr: string;
    gateway: string;
    first_ip: string;
    last_ip: string;
    access_type: string;
    vlan_id: number | null;
    site_pop: string;
    description: string;
    status: string;
    dns_servers: string;
    package_id: string;
    package_name: string;
    updated_at: string | null;
  }>(
    `select p.id, p.name, coalesce(p.code,'') as code, p.cidr,
            coalesce(p.gateway,'') as gateway,
            coalesce(p.first_ip,'') as first_ip,
            coalesce(p.last_ip,'') as last_ip,
            coalesce(p.access_type,'') as access_type,
            p.vlan_id,
            coalesce(p.site_pop,'') as site_pop,
            coalesce(p.description,'') as description,
            coalesce(p.status,'active') as status,
            coalesce(p.dns_servers,'') as dns_servers,
            coalesce(p.package_id,'') as package_id,
            coalesce(pkg.name,'') as package_name,
            p.updated_at::text as updated_at
     from router_pool_assignments a
     join ip_pools p on p.id = a.pool_id
     left join packages pkg on pkg.id = p.package_id and pkg.tenant_id = p.tenant_id
     where a.tenant_id = $1 and a.router_id = $2 and p.archived_at is null
     order by p.name`,
    [tenantId, routerId],
  );
  const out: RouterPoolRow[] = [];
  for (const row of rows) {
    let first = row.first_ip;
    let last = row.last_ip;
    if (!first || !last) {
      const span = cidrSpan(row.cidr);
      first = first || formatIpv4(span.firstHost);
      last = last || formatIpv4(span.lastHost);
    }
    const usage = await poolUsageCounts(sql, tenantId, row.id, first, last);
    out.push({ ...row, first_ip: first, last_ip: last, ...usage });
  }
  return out;
}

async function assertNoOverlap(
  sql: Sql,
  tenantId: string,
  draft: NormalizedPoolDraft,
  excludeId?: string,
) {
  const others = await sql.query<{ id: string; name: string; cidr: string; first_ip: string; last_ip: string }>(
    `select id, name, cidr, coalesce(first_ip,'') as first_ip, coalesce(last_ip,'') as last_ip
     from ip_pools
     where tenant_id = $1 and archived_at is null and coalesce(status,'active') <> 'archived'
       and ($2 = '' or id <> $2)`,
    [tenantId, excludeId || ""],
  );
  for (const other of others) {
    if (cidrOverlaps(draft.cidr, other.cidr)) {
      throw new Error(`Pool overlaps ${other.name} (${other.cidr})`);
    }
    if (other.first_ip && other.last_ip) {
      const bFirst = parseIpv4(other.first_ip);
      const bLast = parseIpv4(other.last_ip);
      if (rangeOverlaps(draft.first_int, draft.last_int, bFirst, bLast)) {
        throw new Error(`Assignable range overlaps ${other.name}`);
      }
    }
  }
}

async function assertUniqueNameCode(sql: Sql, tenantId: string, draft: NormalizedPoolDraft, excludeId?: string) {
  const [dupName] = await sql.query<{ id: string }>(
    `select id from ip_pools
     where tenant_id = $1 and lower(name) = lower($2) and archived_at is null and ($3 = '' or id <> $3)`,
    [tenantId, draft.name, excludeId || ""],
  );
  if (dupName) throw new Error("A pool with that name already exists");
  if (draft.code) {
    const [dupCode] = await sql.query<{ id: string }>(
      `select id from ip_pools
       where tenant_id = $1 and lower(code) = lower($2) and code <> '' and archived_at is null and ($3 = '' or id <> $3)`,
      [tenantId, draft.code, excludeId || ""],
    );
    if (dupCode) throw new Error("A pool with that code already exists");
  }
}

async function assertRouter(sql: Sql, tenantId: string, routerId: string) {
  const [row] = await sql.query<{ id: string; site_pop: string }>(
    `select id, coalesce(site_pop, location, '') as site_pop from routers where id = $1 and tenant_id = $2`,
    [routerId, tenantId],
  );
  if (!row) throw new Error("Router not found");
  return row;
}

async function writeAudit(
  sql: Sql,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  details = "",
) {
  await sql.query(
    `insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [nid("aud"), tenantId, actorId, action, entityType, entityId, details],
  );
}

export async function createRouterPool(
  sql: Sql,
  opts: {
    tenantId: string;
    routerId: string;
    actorUserId: string;
    draft: PoolDraft;
  },
) {
  const router = await assertRouter(sql, opts.tenantId, opts.routerId);
  const draft = validatePoolDraft({
    ...opts.draft,
    site_pop: opts.draft.site_pop || router.site_pop,
  });
  if (draft.package_id) {
    const [pkg] = await sql.query<{ id: string }>(
      `select id from packages where id = $1 and tenant_id = $2`,
      [draft.package_id, opts.tenantId],
    );
    if (!pkg) throw new Error("Package not found");
  }
  await assertUniqueNameCode(sql, opts.tenantId, draft);
  await assertNoOverlap(sql, opts.tenantId, draft);
  const id = nid("pool");
  await sql.query("begin");
  try {
    await sql.query(
      `insert into ip_pools (
          id, tenant_id, name, cidr, next_host, code, gateway, first_ip, last_ip,
          access_type, vlan_id, site_pop, description, status, dns_servers, package_id, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())`,
      [
        id,
        opts.tenantId,
        draft.name,
        draft.cidr,
        draft.next_host,
        draft.code,
        draft.gateway,
        draft.first_ip,
        draft.last_ip,
        draft.access_type,
        draft.vlan_id,
        draft.site_pop,
        draft.description,
        draft.status === "archived" ? "active" : draft.status,
        draft.dns_servers,
        draft.package_id || null,
      ],
    );
    await sql.query(
      `insert into router_pool_assignments (id, tenant_id, router_id, pool_id)
       values ($1,$2,$3,$4)`,
      [nid("rpa"), opts.tenantId, opts.routerId, id],
    );
    await sql.query("commit");
  } catch (err) {
    await sql.query("rollback");
    throw err;
  }
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: opts.routerId,
    event: "pool_created",
    actorUserId: opts.actorUserId,
    detail: { pool_id: id, name: draft.name, cidr: draft.cidr },
  });
  await writeAudit(sql, opts.tenantId, opts.actorUserId, "ip_pool.created", "ip_pool", id, draft.cidr);
  const [created] = (await listRouterPools(sql, opts.tenantId, opts.routerId)).filter((p) => p.id === id);
  return created;
}

export async function updateRouterPool(
  sql: Sql,
  opts: {
    tenantId: string;
    routerId: string;
    poolId: string;
    actorUserId: string;
    draft: PoolDraft;
    confirmImpact?: boolean;
  },
) {
  await assertRouter(sql, opts.tenantId, opts.routerId);
  const [assigned] = await sql.query<{ pool_id: string }>(
    `select pool_id from router_pool_assignments
     where tenant_id = $1 and router_id = $2 and pool_id = $3`,
    [opts.tenantId, opts.routerId, opts.poolId],
  );
  if (!assigned) throw new Error("IP pool not found");
  const [current] = await sql.query<{
    name: string;
    cidr: string;
    gateway: string;
    first_ip: string;
    last_ip: string;
    access_type: string;
    vlan_id: number | null;
    status: string;
  }>(
    `select name, cidr, coalesce(gateway,'') as gateway, coalesce(first_ip,'') as first_ip,
            coalesce(last_ip,'') as last_ip, coalesce(access_type,'') as access_type,
            vlan_id, coalesce(status,'active') as status
     from ip_pools where id = $1 and tenant_id = $2 and archived_at is null`,
    [opts.poolId, opts.tenantId],
  );
  if (!current) throw new Error("IP pool not found");
  const draft = validatePoolDraft(opts.draft);
  const usage = await poolUsageCounts(sql, opts.tenantId, opts.poolId, current.first_ip, current.last_ip);
  const impactful =
    draft.cidr !== current.cidr ||
    draft.gateway !== current.gateway ||
    draft.first_ip !== current.first_ip ||
    draft.last_ip !== current.last_ip ||
    draft.access_type !== current.access_type ||
    (draft.vlan_id ?? null) !== (current.vlan_id ?? null);
  if (impactful && usage.used > 0 && !opts.confirmImpact) {
    throw new Error(
      `This pool has ${usage.used} assigned address${usage.used === 1 ? "" : "es"}. Confirm the change before editing CIDR, gateway, range, VLAN, or access type.`,
    );
  }
  if (impactful && usage.used > 0) {
    const outside = await sql.query<{ address: string }>(
      `select address from ip_addresses
       where tenant_id = $1 and pool_id = $2 and status in ('assigned','reserved')`,
      [opts.tenantId, opts.poolId],
    );
    const lost = outside.filter((row) => {
      const n = parseIpv4(row.address);
      return n < draft.first_int || n > draft.last_int;
    });
    if (lost.length) {
      throw new Error(
        `Cannot change the range: ${lost.length} assigned address${lost.length === 1 ? "" : "es"} would fall outside it. Reassign those services first.`,
      );
    }
  }
  await assertUniqueNameCode(sql, opts.tenantId, draft, opts.poolId);
  await assertNoOverlap(sql, opts.tenantId, draft, opts.poolId);
  await sql.query(
    `update ip_pools set
        name = $3, cidr = $4, next_host = $5, code = $6, gateway = $7, first_ip = $8, last_ip = $9,
        access_type = $10, vlan_id = $11, site_pop = $12, description = $13, status = $14,
        dns_servers = $15, package_id = $16, updated_at = now()
     where id = $1 and tenant_id = $2`,
    [
      opts.poolId,
      opts.tenantId,
      draft.name,
      draft.cidr,
      draft.next_host,
      draft.code,
      draft.gateway,
      draft.first_ip,
      draft.last_ip,
      draft.access_type,
      draft.vlan_id,
      draft.site_pop,
      draft.description,
      draft.status === "archived" ? current.status : draft.status,
      draft.dns_servers,
      draft.package_id || null,
    ],
  );
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: opts.routerId,
    event: "pool_updated",
    actorUserId: opts.actorUserId,
    detail: { pool_id: opts.poolId, name: draft.name },
  });
  await writeAudit(sql, opts.tenantId, opts.actorUserId, "ip_pool.updated", "ip_pool", opts.poolId, draft.cidr);
  const [updated] = (await listRouterPools(sql, opts.tenantId, opts.routerId)).filter((p) => p.id === opts.poolId);
  return { pool: updated, usage };
}

export async function listPoolAssignments(
  sql: Sql,
  tenantId: string,
  poolId: string,
) {
  return sql.query<{
    service_id: string;
    customer_id: string;
    customer_name: string;
    address: string;
    status: string;
    username: string | null;
  }>(
    `select s.id as service_id, s.customer_id, c.name as customer_name, a.address, s.status, s.username
     from ip_addresses a
     join services s on s.id = a.service_id and s.tenant_id = a.tenant_id and s.deleted_at is null
     join customers c on c.id = s.customer_id
     where a.tenant_id = $1 and a.pool_id = $2
     order by a.address`,
    [tenantId, poolId],
  );
}

export async function archiveRouterPool(
  sql: Sql,
  opts: { tenantId: string; routerId: string; poolId: string; actorUserId: string },
) {
  await assertRouter(sql, opts.tenantId, opts.routerId);
  const [assigned] = await sql.query<{ pool_id: string }>(
    `select pool_id from router_pool_assignments
     where tenant_id = $1 and router_id = $2 and pool_id = $3`,
    [opts.tenantId, opts.routerId, opts.poolId],
  );
  if (!assigned) throw new Error("IP pool not found");
  const live = await listPoolAssignments(sql, opts.tenantId, opts.poolId);
  if (live.length) {
    throw new Error(
      `Cannot remove this pool: ${live.length} service${live.length === 1 ? " is" : "s are"} still assigned. Reassign them first.`,
    );
  }
  const [usedRow] = await sql.query<{ n: number }>(
    `select count(*)::int as n from ip_addresses
     where tenant_id = $1 and pool_id = $2 and status in ('assigned','reserved')`,
    [opts.tenantId, opts.poolId],
  );
  if ((usedRow?.n ?? 0) > 0) {
    throw new Error("Cannot remove this pool while addresses are assigned. Reassign them first.");
  }
  await sql.query(
    `update ip_pools set status = 'archived', archived_at = now(), updated_at = now()
     where id = $1 and tenant_id = $2`,
    [opts.poolId, opts.tenantId],
  );
  await sql.query(
    `delete from router_pool_assignments where tenant_id = $1 and router_id = $2 and pool_id = $3`,
    [opts.tenantId, opts.routerId, opts.poolId],
  );
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: opts.routerId,
    event: "pool_archived",
    actorUserId: opts.actorUserId,
    detail: { pool_id: opts.poolId },
  });
  await writeAudit(sql, opts.tenantId, opts.actorUserId, "ip_pool.archived", "ip_pool", opts.poolId);
  return { ok: true, id: opts.poolId };
}

export async function setPoolEnabled(
  sql: Sql,
  opts: { tenantId: string; routerId: string; poolId: string; actorUserId: string; enabled: boolean },
) {
  await assertRouter(sql, opts.tenantId, opts.routerId);
  const [row] = await sql.query<{ id: string }>(
    `select p.id from ip_pools p
     join router_pool_assignments a on a.pool_id = p.id and a.tenant_id = p.tenant_id
     where p.id = $1 and p.tenant_id = $2 and a.router_id = $3 and p.archived_at is null`,
    [opts.poolId, opts.tenantId, opts.routerId],
  );
  if (!row) throw new Error("IP pool not found");
  await sql.query(
    `update ip_pools set status = $3, updated_at = now() where id = $1 and tenant_id = $2`,
    [opts.poolId, opts.tenantId, opts.enabled ? "active" : "disabled"],
  );
  await writeAudit(
    sql,
    opts.tenantId,
    opts.actorUserId,
    opts.enabled ? "ip_pool.enabled" : "ip_pool.disabled",
    "ip_pool",
    opts.poolId,
  );
  return { ok: true, id: opts.poolId, status: opts.enabled ? "active" : "disabled" };
}

export async function setRouterEnabled(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId: string; enabled: boolean },
) {
  const router = await assertRouter(sql, opts.tenantId, opts.routerId);
  await sql.query(`update routers set enabled = $3 where id = $1 and tenant_id = $2`, [
    opts.routerId,
    opts.tenantId,
    opts.enabled,
  ]);
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: opts.enabled ? "enabled" : "disabled",
    actorUserId: opts.actorUserId,
  });
  await writeAudit(
    sql,
    opts.tenantId,
    opts.actorUserId,
    opts.enabled ? "router.enabled" : "router.disabled",
    "router",
    opts.routerId,
  );
  return { ok: true, id: opts.routerId, enabled: opts.enabled };
}

export async function archiveRouter(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId: string },
) {
  const router = await assertRouter(sql, opts.tenantId, opts.routerId);
  await sql.query(
    `update routers set archived_at = now(), enabled = false where id = $1 and tenant_id = $2`,
    [opts.routerId, opts.tenantId],
  );
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: "archived",
    actorUserId: opts.actorUserId,
  });
  await writeAudit(sql, opts.tenantId, opts.actorUserId, "router.archived", "router", opts.routerId);
  return { ok: true, id: opts.routerId };
}

export async function testRouterConnection(sql: Sql, tenantId: string, routerId: string) {
  const [row] = await sql.query<{
    id: string;
    name: string;
    wg_status: string;
    last_seen: string | null;
    provisioning_status: string;
    enabled: boolean;
  }>(
    `select id, name, wg_status, last_seen::text as last_seen,
            coalesce(provisioning_status,'pending') as provisioning_status,
            coalesce(enabled, true) as enabled
     from routers where id = $1 and tenant_id = $2`,
    [routerId, tenantId],
  );
  if (!row) throw new Error("Router not found");
  const { reachability, online } = publicOnlineStatus(row.last_seen, row.enabled === false ? "offline" : row.wg_status);
  return {
    id: row.id,
    name: row.name,
    online: row.enabled !== false && online,
    reachability: row.enabled === false ? "disabled" : reachability,
    last_seen: row.last_seen,
    provisioning_status: row.provisioning_status,
    source: row.last_seen ? "agent_heartbeat" : "none",
  };
}
