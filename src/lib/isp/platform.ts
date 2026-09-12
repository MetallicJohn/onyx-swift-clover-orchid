import { createHash } from "node:crypto";
import { nid } from "../utils.ts";
import { isPlatformAdmin, loadAuthUser } from "./accounts";
import {
  listPlans,
  type PlanInput,
  upsertPlan as writePlan,
  setPlanStatus,
} from "./plans";
import {
  activatePlan,
  cancelSubscription,
  ensureSubscription,
  evaluateSubscription,
  listSaasInvoices,
  type PlanCode,
} from "./saas";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function requirePlatformActor(sql: Sql, userId: string) {
  if (!(await isPlatformAdmin(sql, userId))) throw new Error("Forbidden");
  const user = await loadAuthUser(sql, userId);
  return { userId, email: user?.email || "", name: user?.name || "" };
}

export async function writePlatformAudit(
  sql: Sql,
  opts: {
    actorUserId: string;
    actorEmail?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    tenantId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  let email = opts.actorEmail || "";
  if (!email) {
    const user = await loadAuthUser(sql, opts.actorUserId);
    email = user?.email || "";
  }
  await sql`insert into platform_audit_log
    (id, actor_user_id, actor_email, action, entity_type, entity_id, tenant_id, metadata)
    values (
      ${nid("paud")}, ${opts.actorUserId}, ${email}, ${opts.action}, ${opts.entityType || ""},
      ${opts.entityId || ""}, ${opts.tenantId || null}, ${JSON.stringify(opts.metadata || {})}
    )`;
}

export async function getPlatformSettings(sql: Sql) {
  const rows = await sql<{ key: string; value: string }>`select key, value from platform_settings`;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    grace_days: Number(map.grace_days || 3),
    past_due_days: Number(map.past_due_days || 7),
    trial_days: Number(map.trial_days || 14),
    support_access_enabled: map.support_access_enabled === "true",
    support_access_minutes: Number(map.support_access_minutes || 30),
    sales_email: (map.sales_email || "").trim(),
    support_email: (map.support_email || "").trim(),
    contact_phone: (map.contact_phone || "").trim(),
    acs_public_host: (map.acs_public_host || "").trim(),
    acs_dns_host: (map.acs_dns_host || "").trim(),
    acs_port_start: Number(map.acs_port_start || 7551),
    acs_port_end: Number(map.acs_port_end || 7999),
  };
}

export async function savePlatformSettings(
  sql: Sql,
  actorUserId: string,
  patch: Partial<{
    grace_days: number;
    past_due_days: number;
    trial_days: number;
    support_access_enabled: boolean;
    support_access_minutes: number;
    sales_email: string;
    support_email: string;
    contact_phone: string;
    acs_public_host: string;
    acs_dns_host: string;
    acs_port_start: number;
    acs_port_end: number;
  }>,
) {
  await requirePlatformActor(sql, actorUserId);
  const entries: [string, string][] = [];
  if (patch.grace_days != null) entries.push(["grace_days", String(Math.max(0, Math.round(patch.grace_days)))]);
  if (patch.past_due_days != null) entries.push(["past_due_days", String(Math.max(0, Math.round(patch.past_due_days)))]);
  if (patch.trial_days != null) entries.push(["trial_days", String(Math.max(1, Math.round(patch.trial_days)))]);
  if (patch.support_access_enabled != null)
    entries.push(["support_access_enabled", patch.support_access_enabled ? "true" : "false"]);
  if (patch.support_access_minutes != null)
    entries.push(["support_access_minutes", String(Math.max(5, Math.round(patch.support_access_minutes)))]);
  if (patch.sales_email != null) entries.push(["sales_email", patch.sales_email.trim().slice(0, 120)]);
  if (patch.support_email != null) entries.push(["support_email", patch.support_email.trim().slice(0, 120)]);
  if (patch.contact_phone != null) entries.push(["contact_phone", patch.contact_phone.trim().slice(0, 32)]);
  if (patch.acs_public_host != null) {
    const { normalizeAcsHost } = await import("./acs-ports");
    entries.push(["acs_public_host", normalizeAcsHost(patch.acs_public_host)]);
  }
  if (patch.acs_dns_host != null) {
    const { normalizeAcsHost } = await import("./acs-ports");
    entries.push(["acs_dns_host", patch.acs_dns_host.trim() ? normalizeAcsHost(patch.acs_dns_host) : ""]);
  }
  if (patch.acs_port_start != null || patch.acs_port_end != null) {
    const current = await getPlatformSettings(sql);
    const { parsePortRange } = await import("./acs-ports");
    const range = parsePortRange(
      patch.acs_port_start ?? current.acs_port_start,
      patch.acs_port_end ?? current.acs_port_end,
    );
    entries.push(["acs_port_start", String(range.start)]);
    entries.push(["acs_port_end", String(range.end)]);
  }
  for (const [key, value] of entries) {
    await sql`insert into platform_settings (key, value, updated_at) values (${key}, ${value}, now())
      on conflict (key) do update set value = ${value}, updated_at = now()`;
  }
  await writePlatformAudit(sql, {
    actorUserId,
    action: "settings.updated",
    entityType: "platform_settings",
    metadata: patch,
  });
  return getPlatformSettings(sql);
}

const HEARTBEAT_MS = 10 * 60_000;

function nodeHealth(lastSeen: string | null, cpu: number | null, ram: number | null, disk: number | null) {
  if (!lastSeen) return "offline" as const;
  const t = Date.parse(lastSeen);
  if (Number.isNaN(t) || Date.now() - t > HEARTBEAT_MS) return "offline" as const;
  const hot = [cpu, ram, disk].filter((n): n is number => n != null);
  if (hot.some((n) => n >= 90)) return "critical" as const;
  if (hot.some((n) => n >= 75)) return "warning" as const;
  return "healthy" as const;
}

export type TenantListRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  plan: string;
  plan_name: string;
  subscription_status: string;
  period_end: string | null;
  trial: boolean;
  customers: number;
  routers: number;
  services_active: number;
  members: number;
  last_activity: string | null;
  node_health: "healthy" | "warning" | "critical" | "offline" | "none";
};

export async function listPlatformTenantsPage(
  sql: Sql,
  actorUserId: string,
  opts: { q?: string; status?: string; plan?: string; page?: number; pageSize?: number } = {},
) {
  await requirePlatformActor(sql, actorUserId);
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
  const q = (opts.q || "").trim();
  const like = q ? `%${q.toLowerCase()}%` : "";
  const status = opts.status || "";
  const plan = opts.plan || "";
  const params: unknown[] = [];
  const where: string[] = ["1=1"];
  if (like) {
    params.push(like);
    where.push(
      `(lower(t.name) like $${params.length} or lower(t.slug) like $${params.length} or lower(t.id) like $${params.length})`,
    );
  }
  if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }
  if (plan) {
    params.push(plan);
    where.push(`coalesce(s.plan, 'trial') = $${params.length}`);
  }
  const whereSql = where.join(" and ");
  const countParams = [...params];
  const [{ n }] = await sql.query<{ n: number }>(
    `select count(*)::int as n
     from tenants t
     left join tenant_subscriptions s on s.tenant_id = t.id
     where ${whereSql}`,
    countParams,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await sql.query<{
    id: string;
    name: string;
    slug: string;
    status: string;
    created_at: string;
    plan: string;
    subscription_status: string;
    period_end: string | null;
    customers: number;
    routers: number;
    services_active: number;
    members: number;
    last_activity: string | null;
    cpu_pct: number | null;
    last_seen: string | null;
  }>(
    `select t.id, t.name, t.slug, t.status, t.created_at::text as created_at,
            coalesce(s.plan, 'trial') as plan,
            coalesce(s.status, 'trial') as subscription_status,
            s.period_end::text as period_end,
            (select count(*)::int from customers c where c.tenant_id = t.id) as customers,
            (select count(*)::int from routers r where r.tenant_id = t.id) as routers,
            (select count(*)::int from services sv where sv.tenant_id = t.id and sv.status = 'active') as services_active,
            (select count(*)::int from tenant_members m where m.tenant_id = t.id) as members,
            coalesce(
              (select max(r.last_seen) from routers r where r.tenant_id = t.id),
              t.created_at
            )::text as last_activity,
            (select avg(r.cpu_pct) from routers r where r.tenant_id = t.id and r.last_seen is not null) as cpu_pct,
            (select max(r.last_seen)::text from routers r where r.tenant_id = t.id) as last_seen
     from tenants t
     left join tenant_subscriptions s on s.tenant_id = t.id
     where ${whereSql}
     order by t.created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const plans = await listPlans(sql, true);
  const names = new Map(plans.map((p) => [p.code, p.name]));
  const tenants: TenantListRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    created_at: r.created_at,
    plan: r.plan,
    plan_name: names.get(r.plan) || r.plan,
    subscription_status: r.subscription_status,
    period_end: r.period_end,
    trial: r.plan === "trial" || r.subscription_status === "trial",
    customers: r.customers,
    routers: r.routers,
    services_active: r.services_active,
    members: r.members,
    last_activity: r.last_activity,
    node_health: r.routers === 0 && !r.last_seen ? "none" : nodeHealth(r.last_seen, r.cpu_pct, null, null),
  }));
  return { tenants, total: n ?? 0, page, pageSize };
}

export async function loadTenantDetail(sql: Sql, actorUserId: string, tenantId: string) {
  await requirePlatformActor(sql, actorUserId);
  const [ten] = await sql<{
    id: string;
    name: string;
    slug: string;
    status: string;
    currency: string;
    timezone: string;
    support_email: string;
    support_phone: string;
    created_at: string;
    suspended_reason: string;
    suspended_at: string | null;
  }>`select id, name, slug, status, currency, timezone, support_email, support_phone,
            created_at::text as created_at, suspended_reason, suspended_at::text as suspended_at
     from tenants where id = ${tenantId}`;
  if (!ten) throw new Error("ISP not found");
  await evaluateSubscription(sql, tenantId);
  const sub = await ensureSubscription(sql, tenantId);
  const plan = (await listPlans(sql, true)).find((p) => p.code === sub.plan);
  const [counts] = await sql<{
    customers: number;
    services: number;
    services_active: number;
    routers: number;
    members: number;
    tickets_open: number;
  }>`select
      (select count(*)::int from customers where tenant_id = ${tenantId}) as customers,
      (select count(*)::int from services where tenant_id = ${tenantId}) as services,
      (select count(*)::int from services where tenant_id = ${tenantId} and status = 'active') as services_active,
      (select count(*)::int from routers where tenant_id = ${tenantId}) as routers,
      (select count(*)::int from tenant_members where tenant_id = ${tenantId}) as members,
      (select count(*)::int from tickets where tenant_id = ${tenantId} and status not in ('resolved','closed')) as tickets_open`;
  const [sessions] = await sql<{ n: number }>`
    select count(*)::int as n from radius_sessions
    where tenant_id = ${tenantId} and stopped_at is null`.catch(async () => [{ n: 0 }]);
  const operators = await sql<{
    user_id: string;
    name: string;
    email: string;
    role: string;
    created_at: string;
  }>`select m.user_id, u.name, u.email, m.role, m.created_at::text as created_at
     from tenant_members m join "user" u on u.id = m.user_id
     where m.tenant_id = ${tenantId}
     order by case m.role when 'isp_owner' then 0 else 1 end, u.name`;
  const routers = await sql<{
    id: string;
    name: string;
    wg_status: string;
    last_seen: string | null;
    cpu_pct: number;
    uptime_hours: number;
    agent_version: string;
  }>`select id, name, wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours, coalesce(agent_version,'') as agent_version
     from routers where tenant_id = ${tenantId} order by name`;
  const nodes = await sql<{
    id: string;
    name: string;
    last_seen: string | null;
    cpu_pct: number | null;
    ram_pct: number | null;
    disk_pct: number | null;
    load_1: number | null;
    net_rx_bytes: number | null;
    net_tx_bytes: number | null;
    uptime_seconds: number | null;
    postgres_ok: boolean | null;
    redis_ok: boolean | null;
    genieacs_ok: boolean | null;
  }>`select id, name, last_seen::text as last_seen, cpu_pct, ram_pct, disk_pct, load_1::float as load_1,
            net_rx_bytes, net_tx_bytes, uptime_seconds, postgres_ok, redis_ok, genieacs_ok
     from infra_nodes where tenant_id = ${tenantId} order by name`;
  const invoices = await listSaasInvoices(sql, tenantId);
  const payments = await sql<{
    id: string;
    amount_kes: number;
    provider: string;
    reference: string;
    status: string;
    paid_at: string;
  }>`select id, amount_kes, provider, reference, status, paid_at::text as paid_at
     from saas_payments where tenant_id = ${tenantId} order by paid_at desc limit 20`;
  const outstanding = invoices.filter((i) => ["issued", "due", "overdue"].includes(i.status));
  const revenue = payments.filter((p) => p.status === "confirmed").reduce((s, p) => s + p.amount_kes, 0);
  const activity = await sql<{
    id: string;
    actor_email: string;
    action: string;
    entity_type: string;
    created_at: string;
  }>`select id, actor_email, action, entity_type, created_at::text as created_at
     from platform_audit_log where tenant_id = ${tenantId} order by created_at desc limit 20`;
  const { loadAcsCredentials } = await import("./acs-credentials");
  const acs = await loadAcsCredentials(sql, tenantId);
  const online = routers.filter((r) => nodeHealth(r.last_seen, r.cpu_pct, null, null) !== "offline");
  const cpuVals = routers.filter((r) => r.last_seen).map((r) => r.cpu_pct);
  return {
    tenant: ten,
    subscription: {
      ...sub,
      plan_name: plan?.name || sub.plan,
      price_kes: sub.billing_cycle === "annual" ? plan?.annual_kes ?? sub.monthly_kes * 12 : sub.monthly_kes,
    },
    usage: {
      customers: counts?.customers ?? 0,
      customers_max: sub.max_customers,
      services: counts?.services ?? 0,
      services_active: counts?.services_active ?? 0,
      services_max: sub.max_services,
      routers: counts?.routers ?? 0,
      routers_max: sub.max_routers,
      members: counts?.members ?? 0,
      members_max: sub.max_admins,
      sessions: sessions?.n ?? 0,
      tickets_open: counts?.tickets_open ?? 0,
    },
    operators,
    acs: acs
      ? {
          enabled: acs.enabled,
          cwmp_url: acs.cwmp_url,
          cwmp_port: acs.cwmp_port,
          public_host: acs.public_host,
          username: acs.username,
          last_verified_at: acs.last_verified_at,
          last_verify_ok: acs.last_verify_ok,
        }
      : null,
    routers: routers.map((r) => ({
      ...r,
      health: nodeHealth(r.last_seen, r.cpu_pct, null, null),
      ram_pct: null as number | null,
      disk_pct: null as number | null,
      telemetry: r.last_seen ? "router" : "unavailable",
    })),
    nodes: nodes.map((n) => ({
      ...n,
      health: nodeHealth(n.last_seen, n.cpu_pct, n.ram_pct, n.disk_pct),
    })),
    infrastructure: {
      online: online.length,
      total: routers.length,
      cpu: cpuVals.length ? Math.round(cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length) : null,
      ram: null as number | null,
      disk: null as number | null,
      bandwidth: null as number | null,
    },
    financial: {
      invoices,
      payments,
      outstanding_kes: outstanding.reduce((s, i) => s + i.amount_kes, 0),
      revenue_kes: revenue,
    },
    activity,
  };
}

export async function updateTenantProfile(
  sql: Sql,
  actorUserId: string,
  tenantId: string,
  patch: { name?: string; support_email?: string; support_phone?: string; timezone?: string },
) {
  await requirePlatformActor(sql, actorUserId);
  const [ten] = await sql<{ id: string; name: string }>`select id, name from tenants where id = ${tenantId}`;
  if (!ten) throw new Error("ISP not found");
  const name = (patch.name ?? ten.name).trim();
  if (!name) throw new Error("ISP name is required");
  await sql`update tenants set
      name = ${name},
      support_email = ${patch.support_email ?? ""},
      support_phone = ${patch.support_phone ?? ""},
      timezone = ${patch.timezone || "Africa/Nairobi"}
    where id = ${tenantId}`;
  await writePlatformAudit(sql, {
    actorUserId,
    action: "tenant.updated",
    entityType: "tenant",
    entityId: tenantId,
    tenantId,
    metadata: { name },
  });
  return loadTenantDetail(sql, actorUserId, tenantId);
}

export async function suspendTenant(sql: Sql, actorUserId: string, tenantId: string, reason: string) {
  await requirePlatformActor(sql, actorUserId);
  const why = reason.trim();
  if (!why) throw new Error("A reason is required to suspend an ISP");
  const [ten] = await sql<{ id: string; name: string }>`select id, name from tenants where id = ${tenantId}`;
  if (!ten) throw new Error("ISP not found");
  await sql`update tenants set status = 'suspended', suspended_reason = ${why}, suspended_at = now() where id = ${tenantId}`;
  await sql`update tenant_subscriptions set status = 'suspended' where tenant_id = ${tenantId}`;
  await writePlatformAudit(sql, {
    actorUserId,
    action: "tenant.suspended",
    entityType: "tenant",
    entityId: tenantId,
    tenantId,
    metadata: { reason: why },
  });
  return loadTenantDetail(sql, actorUserId, tenantId);
}

export async function reactivateTenant(sql: Sql, actorUserId: string, tenantId: string) {
  await requirePlatformActor(sql, actorUserId);
  const [ten] = await sql<{ id: string }>`select id from tenants where id = ${tenantId}`;
  if (!ten) throw new Error("ISP not found");
  const sub = await ensureSubscription(sql, tenantId);
  const nextStatus = sub.plan === "trial" || sub.monthly_kes === 0 ? "trial" : "active";
  const live = sub.period_end && Date.parse(sub.period_end) > Date.now();
  const subStatus = live ? nextStatus : sub.status === "cancelled" ? "cancelled" : nextStatus;
  await sql`update tenants set status = ${subStatus === "cancelled" ? "suspended" : nextStatus},
      suspended_reason = '', suspended_at = null where id = ${tenantId}`;
  if (sub.status !== "cancelled") {
    await sql`update tenant_subscriptions set status = ${subStatus}, cancelled_at = null where tenant_id = ${tenantId}`;
  }
  await writePlatformAudit(sql, {
    actorUserId,
    action: "tenant.reactivated",
    entityType: "tenant",
    entityId: tenantId,
    tenantId,
  });
  return loadTenantDetail(sql, actorUserId, tenantId);
}

export async function assignTenantPlan(
  sql: Sql,
  actorUserId: string,
  opts: { tenantId: string; plan: PlanCode; cycle?: "monthly" | "annual"; extend_days?: number },
) {
  await requirePlatformActor(sql, actorUserId);
  const before = await ensureSubscription(sql, opts.tenantId);
  const next = await activatePlan(sql, opts.tenantId, opts.plan, opts.cycle || "monthly");
  if (opts.extend_days && opts.extend_days > 0) {
    const base = next.period_end ? new Date(next.period_end) : new Date();
    const end = new Date(base.getTime() + opts.extend_days * 86400_000);
    await sql`update tenant_subscriptions set period_end = ${end.toISOString()} where tenant_id = ${opts.tenantId}`;
  }
  await writePlatformAudit(sql, {
    actorUserId,
    action: "plan.assigned",
    entityType: "subscription",
    entityId: next.id,
    tenantId: opts.tenantId,
    metadata: { from: before.plan, to: opts.plan, cycle: opts.cycle || "monthly", extend_days: opts.extend_days || 0 },
  });
  return loadTenantDetail(sql, actorUserId, opts.tenantId);
}

export async function extendTrial(sql: Sql, actorUserId: string, tenantId: string, days: number) {
  await requirePlatformActor(sql, actorUserId);
  const n = Math.max(1, Math.round(days));
  const sub = await ensureSubscription(sql, tenantId);
  const base = sub.period_end && Date.parse(sub.period_end) > Date.now() ? new Date(sub.period_end) : new Date();
  const end = new Date(base.getTime() + n * 86400_000);
  await sql`update tenant_subscriptions set plan = 'trial', status = 'trial', period_end = ${end.toISOString()},
      trial_ends_at = ${end.toISOString()}, cancelled_at = null where tenant_id = ${tenantId}`;
  await sql`update tenants set status = 'trial', suspended_reason = '', suspended_at = null where id = ${tenantId}`;
  await writePlatformAudit(sql, {
    actorUserId,
    action: "trial.extended",
    entityType: "subscription",
    entityId: sub.id,
    tenantId,
    metadata: { days: n },
  });
  return loadTenantDetail(sql, actorUserId, tenantId);
}

export async function cancelTenantSubscription(sql: Sql, actorUserId: string, tenantId: string) {
  await requirePlatformActor(sql, actorUserId);
  const next = await cancelSubscription(sql, tenantId);
  await writePlatformAudit(sql, {
    actorUserId,
    action: "subscription.cancelled",
    entityType: "subscription",
    entityId: next.id,
    tenantId,
  });
  return loadTenantDetail(sql, actorUserId, tenantId);
}

export async function saveCatalogPlan(sql: Sql, actorUserId: string, input: PlanInput) {
  await requirePlatformActor(sql, actorUserId);
  const saved = await writePlan(sql, input);
  await writePlatformAudit(sql, {
    actorUserId,
    action: input.code ? "plan.updated" : "plan.created",
    entityType: "saas_plan",
    entityId: saved.code,
    metadata: { name: saved.name, monthly_kes: saved.monthly_kes },
  });
  return saved;
}

export async function archiveCatalogPlan(sql: Sql, actorUserId: string, code: string, status: "active" | "archived") {
  await requirePlatformActor(sql, actorUserId);
  const saved = await setPlanStatus(sql, code, status);
  await writePlatformAudit(sql, {
    actorUserId,
    action: status === "archived" ? "plan.archived" : "plan.restored",
    entityType: "saas_plan",
    entityId: code,
  });
  return saved;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function loadPlatformOverview(sql: Sql, actorUserId: string) {
  await requirePlatformActor(sql, actorUserId);
  const today = startOfDay();
  const month = startOfMonth();
  const todayIso = today.toISOString();
  const monthIso = month.toISOString();
  const [tenants] = await sql<{
    total: number;
    active: number;
    trial: number;
    suspended: number;
    new_month: number;
  }>`select
      count(*)::int as total,
      count(*) filter (where status = 'active')::int as active,
      count(*) filter (where status = 'trial')::int as trial,
      count(*) filter (where status = 'suspended')::int as suspended,
      count(*) filter (where created_at >= ${monthIso})::int as new_month
     from tenants`;
  const [rev] = await sql<{
    today: number;
    month: number;
    outstanding: number;
    failed: number;
  }>`select
      coalesce((select sum(amount_kes)::int from saas_payments where status = 'confirmed' and paid_at >= ${todayIso}),0) as today,
      coalesce((select sum(amount_kes)::int from saas_payments where status = 'confirmed' and paid_at >= ${monthIso}),0) as month,
      coalesce((select sum(amount_kes)::int from saas_invoices where status in ('issued','due','overdue')),0) as outstanding,
      coalesce((select count(*)::int from saas_payment_intents where status = 'failed'),0)
        + coalesce((select count(*)::int from saas_invoices where status = 'overdue'),0) as failed`;
  const [mrr] = await sql<{ mrr: number; annual_count: number }>`
    select coalesce(sum(monthly_kes),0)::int as mrr,
           count(*) filter (where billing_cycle = 'annual')::int as annual_count
    from tenant_subscriptions
    where status in ('active','grace','past_due')`;
  const [renew] = await sql<{ n: number }>`
    select count(*)::int as n from tenant_subscriptions
    where status in ('active','grace') and period_end is not null
      and period_end <= now() + interval '14 days'`;
  const byPlan = await sql<{ plan: string; n: number }>`
    select coalesce(s.plan,'trial') as plan, count(*)::int as n
    from tenants t left join tenant_subscriptions s on s.tenant_id = t.id
    group by coalesce(s.plan,'trial') order by n desc`;
  const [trials] = await sql<{ expiring: number }>`
    select count(*)::int as expiring from tenant_subscriptions
    where (plan = 'trial' or status = 'trial') and period_end is not null
      and period_end <= now() + interval '7 days' and period_end >= now()`;
  const changes = await sql<{ action: string; n: number }>`
    select action, count(*)::int as n from platform_audit_log
    where created_at >= ${monthIso} and action in ('plan.assigned','subscription.cancelled','trial.extended')
    group by action`;
  const [churn] = await sql<{ n: number }>`
    select count(*)::int as n from tenant_subscriptions
    where (status = 'cancelled' or status = 'expired') and coalesce(cancelled_at, period_end) >= ${monthIso}`;
  const routers = await sql<{ last_seen: string | null; cpu_pct: number; wg_status: string }>`
    select last_seen::text as last_seen, cpu_pct, wg_status from routers`;
  const nodes = await sql<{
    last_seen: string | null;
    cpu_pct: number | null;
    ram_pct: number | null;
    disk_pct: number | null;
  }>`select last_seen::text as last_seen, cpu_pct, ram_pct, disk_pct from infra_nodes`;
  const routerHealth = routers.map((r) => nodeHealth(r.last_seen, r.cpu_pct, null, null));
  const nodeHealths = nodes.map((n) => nodeHealth(n.last_seen, n.cpu_pct, n.ram_pct, n.disk_pct));
  const allNodes = [...routerHealth, ...nodeHealths];
  const liveCpu = [
    ...routers.filter((r) => nodeHealth(r.last_seen, r.cpu_pct, null, null) !== "offline").map((r) => r.cpu_pct),
    ...nodes.filter((n) => n.cpu_pct != null && nodeHealth(n.last_seen, n.cpu_pct, n.ram_pct, n.disk_pct) !== "offline").map((n) => n.cpu_pct as number),
  ];
  const liveRam = nodes
    .filter((n) => n.ram_pct != null && nodeHealth(n.last_seen, n.cpu_pct, n.ram_pct, n.disk_pct) !== "offline")
    .map((n) => n.ram_pct as number);
  const liveDisk = nodes
    .filter((n) => n.disk_pct != null && nodeHealth(n.last_seen, n.cpu_pct, n.ram_pct, n.disk_pct) !== "offline")
    .map((n) => n.disk_pct as number);
  const growth = await sql<{ day: string; n: number }>`
    select created_at::date::text as day, count(*)::int as n
    from tenants
    where created_at >= now() - interval '30 days'
    group by created_at::date
    order by day`;
  const revenueDaily = await sql<{ day: string; amount: number }>`
    select paid_at::date::text as day, sum(amount_kes)::int as amount
    from saas_payments
    where status = 'confirmed' and paid_at >= now() - interval '30 days'
    group by paid_at::date
    order by day`;
  const changeMap = Object.fromEntries(changes.map((c) => [c.action, c.n]));
  const mrrKes = mrr?.mrr ?? 0;
  const online = allNodes.filter((h) => h === "healthy" || h === "warning" || h === "critical").length;
  const offline = allNodes.filter((h) => h === "offline").length;
  const system =
    allNodes.length === 0
      ? "unknown"
      : offline === allNodes.length
        ? "offline"
        : allNodes.some((h) => h === "critical")
          ? "critical"
          : allNodes.some((h) => h === "warning")
            ? "warning"
            : "healthy";
  return {
    tenants: {
      total: tenants?.total ?? 0,
      active: tenants?.active ?? 0,
      trial: tenants?.trial ?? 0,
      suspended: tenants?.suspended ?? 0,
      new_month: tenants?.new_month ?? 0,
    },
    revenue: {
      today: rev?.today ?? 0,
      month: rev?.month ?? 0,
      mrr: mrrKes,
      arr: mrrKes * 12,
      outstanding: rev?.outstanding ?? 0,
      failed: rev?.failed ?? 0,
      upcoming_renewals: renew?.n ?? 0,
    },
    infrastructure: {
      total: routers.length + nodes.length,
      online,
      offline,
      cpu: liveCpu.length ? Math.round(liveCpu.reduce((a, b) => a + b, 0) / liveCpu.length) : null,
      ram: liveRam.length ? Math.round(liveRam.reduce((a, b) => a + b, 0) / liveRam.length) : null,
      disk: liveDisk.length ? Math.round(liveDisk.reduce((a, b) => a + b, 0) / liveDisk.length) : null,
      bandwidth: null as number | null,
      health: system,
    },
    subscriptions: {
      by_plan: byPlan,
      trial: tenants?.trial ?? 0,
      expiring_trials: trials?.expiring ?? 0,
      upgrades: changeMap["plan.assigned"] ?? 0,
      downgrades: 0,
      churn: churn?.n ?? 0,
    },
    series: { growth, revenue: revenueDaily },
  };
}

export async function loadPlatformReports(
  sql: Sql,
  actorUserId: string,
  opts: { from?: string; to?: string; plan?: string } = {},
) {
  await requirePlatformActor(sql, actorUserId);
  const to = opts.to || new Date().toISOString().slice(0, 10);
  const from = opts.from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${to}T23:59:59.999Z`;
  const tenants = await sql<{ id: string; name: string; status: string; created_at: string; plan: string }>`
    select t.id, t.name, t.status, t.created_at::text as created_at, coalesce(s.plan,'trial') as plan
    from tenants t left join tenant_subscriptions s on s.tenant_id = t.id
    where t.created_at >= ${fromIso} and t.created_at <= ${toIso}
    order by t.created_at desc`;
  const byStatus = await sql<{ status: string; n: number }>`
    select status, count(*)::int as n from tenants group by status`;
  const byPlan = await sql<{ plan: string; n: number; mrr: number }>`
    select coalesce(plan,'trial') as plan, count(*)::int as n, coalesce(sum(monthly_kes),0)::int as mrr
    from tenant_subscriptions group by plan order by mrr desc`;
  const payments = await sql<{
    id: string;
    tenant_id: string;
    amount_kes: number;
    provider: string;
    reference: string;
    paid_at: string;
  }>`select p.id, p.tenant_id, p.amount_kes, p.provider, p.reference, p.paid_at::text as paid_at
     from saas_payments p
     where p.status = 'confirmed' and p.paid_at >= ${fromIso} and p.paid_at <= ${toIso}
     order by p.paid_at desc`;
  const invoices = await sql<{ status: string; n: number; amount: number }>`
    select status, count(*)::int as n, coalesce(sum(amount_kes),0)::int as amount
    from saas_invoices
    where issued_at >= ${fromIso} and issued_at <= ${toIso}
    group by status`;
  const daily = await sql<{ day: string; amount: number; n: number }>`
    select paid_at::date::text as day, sum(amount_kes)::int as amount, count(*)::int as n
    from saas_payments
    where status = 'confirmed' and paid_at >= ${fromIso} and paid_at <= ${toIso}
    group by paid_at::date order by day`;
  const infra = await sql<{ wg_status: string; n: number }>`
    select wg_status, count(*)::int as n from routers group by wg_status`;
  const activity = await sql<{ action: string; n: number }>`
    select action, count(*)::int as n from platform_audit_log
    where created_at >= ${fromIso} and created_at <= ${toIso}
    group by action order by n desc`;
  const [users] = await sql<{ n: number }>`
    select count(*)::int as n from "user" where "createdAt" >= ${fromIso} and "createdAt" <= ${toIso}`;
  return {
    from,
    to,
    tenants: {
      new: tenants,
      by_status: byStatus,
    },
    subscriptions: { by_plan: byPlan },
    financial: {
      payments,
      invoices,
      daily,
      paid_kes: payments.reduce((s, p) => s + p.amount_kes, 0),
    },
    infrastructure: infra,
    activity,
    new_users: users?.n ?? 0,
  };
}

export function reportsToCsv(report: Awaited<ReturnType<typeof loadPlatformReports>>) {
  const lines = ["day,amount_kes,payments"];
  for (const d of report.financial.daily) lines.push(`${d.day},${d.amount},${d.n}`);
  lines.push("");
  lines.push("tenant,status,plan,created_at");
  for (const t of report.tenants.new) {
    lines.push(`"${t.name.replace(/"/g, '""')}",${t.status},${t.plan},${t.created_at}`);
  }
  lines.push("");
  lines.push("plan,subscribers,mrr_kes");
  for (const p of report.subscriptions.by_plan) lines.push(`${p.plan},${p.n},${p.mrr}`);
  return lines.join("\n");
}

export async function listPlatformActivity(
  sql: Sql,
  actorUserId: string,
  opts: { q?: string; page?: number; pageSize?: number } = {},
) {
  await requirePlatformActor(sql, actorUserId);
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 40));
  const q = (opts.q || "").trim().toLowerCase();
  const like = q ? `%${q}%` : "";
  const where = like
    ? `where lower(action) like $1 or lower(actor_email) like $1 or lower(coalesce(entity_id,'')) like $1`
    : "";
  const params: unknown[] = like ? [like] : [];
  const [{ n }] = await sql.query<{ n: number }>(
    `select count(*)::int as n from platform_audit_log ${where}`,
    params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await sql.query<{
    id: string;
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string;
    tenant_id: string | null;
    metadata: string;
    created_at: string;
  }>(
    `select id, actor_email, action, entity_type, entity_id, tenant_id, metadata, created_at::text as created_at
     from platform_audit_log ${where}
     order by created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { rows, total: n ?? 0, page, pageSize };
}

export async function platformSearch(sql: Sql, actorUserId: string, q: string) {
  await requirePlatformActor(sql, actorUserId);
  const query = q.trim().toLowerCase();
  if (query.length < 2) return { tenants: [], plans: [], operators: [], nodes: [] };
  const like = `%${query}%`;
  const tenants = await sql<{ id: string; name: string; slug: string; status: string }>`
    select id, name, slug, status from tenants
    where lower(name) like ${like} or lower(slug) like ${like} or lower(id) like ${like}
    order by name limit 8`;
  const plans = await sql<{ code: string; name: string; status: string }>`
    select code, name, status from saas_plans
    where lower(code) like ${like} or lower(name) like ${like}
    order by name limit 8`;
  const operators = await sql<{ user_id: string; name: string; email: string; role: string; tenant_id: string; tenant_name: string }>`
    select m.user_id, u.name, u.email, m.role, t.id as tenant_id, t.name as tenant_name
    from tenant_members m
    join "user" u on u.id = m.user_id
    join tenants t on t.id = m.tenant_id
    where lower(u.email) like ${like} or lower(u.name) like ${like}
    order by u.email limit 8`;
  const nodes = await sql<{ id: string; name: string; tenant_id: string; tenant_name: string }>`
    select n.id, n.name, n.tenant_id, t.name as tenant_name
    from infra_nodes n join tenants t on t.id = n.tenant_id
    where lower(n.name) like ${like} or lower(n.id) like ${like}
    order by n.name limit 8`;
  return { tenants, plans, operators, nodes };
}

export async function listInfrastructure(sql: Sql, actorUserId: string) {
  await requirePlatformActor(sql, actorUserId);
  const routers = await sql<{
    id: string;
    tenant_id: string;
    tenant_name: string;
    name: string;
    wg_status: string;
    last_seen: string | null;
    cpu_pct: number;
    uptime_hours: number;
  }>`select r.id, r.tenant_id, t.name as tenant_name, r.name, r.wg_status, r.last_seen::text as last_seen,
            r.cpu_pct, r.uptime_hours
     from routers r join tenants t on t.id = r.tenant_id
     order by t.name, r.name`;
  const nodes = await sql<{
    id: string;
    tenant_id: string;
    tenant_name: string;
    name: string;
    last_seen: string | null;
    cpu_pct: number | null;
    ram_pct: number | null;
    disk_pct: number | null;
    load_1: number | null;
    net_rx_bytes: number | null;
    net_tx_bytes: number | null;
    uptime_seconds: number | null;
    postgres_ok: boolean | null;
    redis_ok: boolean | null;
    genieacs_ok: boolean | null;
  }>`select n.id, n.tenant_id, t.name as tenant_name, n.name, n.last_seen::text as last_seen,
            n.cpu_pct, n.ram_pct, n.disk_pct, n.load_1::float as load_1, n.net_rx_bytes, n.net_tx_bytes,
            n.uptime_seconds, n.postgres_ok, n.redis_ok, n.genieacs_ok
     from infra_nodes n join tenants t on t.id = n.tenant_id
     order by t.name, n.name`;
  return {
    routers: routers.map((r) => ({
      ...r,
      kind: "router" as const,
      health: nodeHealth(r.last_seen, r.cpu_pct, null, null),
      ram_pct: null as number | null,
      disk_pct: null as number | null,
    })),
    nodes: nodes.map((n) => ({
      ...n,
      kind: "node" as const,
      health: nodeHealth(n.last_seen, n.cpu_pct, n.ram_pct, n.disk_pct),
    })),
  };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function registerInfraNode(sql: Sql, actorUserId: string, tenantId: string, name: string) {
  await requirePlatformActor(sql, actorUserId);
  const label = name.trim();
  if (!label) throw new Error("Node name is required");
  const [ten] = await sql<{ id: string }>`select id from tenants where id = ${tenantId}`;
  if (!ten) throw new Error("ISP not found");
  const id = nid("node");
  const token = `nod_${crypto.randomUUID().replace(/-/g, "")}`;
  await sql`insert into infra_nodes (id, tenant_id, name, token_hash)
    values (${id}, ${tenantId}, ${label}, ${hashToken(token)})`;
  await writePlatformAudit(sql, {
    actorUserId,
    action: "infra.node_registered",
    entityType: "infra_node",
    entityId: id,
    tenantId,
    metadata: { name: label },
  });
  return { id, name: label, token };
}

export async function ingestNodeTelemetry(
  sql: Sql,
  token: string,
  body: {
    cpu_pct?: number;
    ram_pct?: number;
    disk_pct?: number;
    load_1?: number;
    net_rx_bytes?: number;
    net_tx_bytes?: number;
    uptime_seconds?: number;
    postgres_ok?: boolean;
    redis_ok?: boolean;
    genieacs_ok?: boolean;
    reported_at?: string;
  },
) {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Unauthorized");
  const [node] = await sql<{ id: string; tenant_id: string }>`
    select id, tenant_id from infra_nodes where token_hash = ${hashToken(trimmed)}`;
  if (!node) throw new Error("Unauthorized");
  if (body.reported_at) {
    const t = Date.parse(body.reported_at);
    if (Number.isNaN(t)) throw new Error("Invalid timestamp");
    if (t - Date.now() > 5 * 60_000) throw new Error("Timestamp too far in the future");
    if (Date.now() - t > 2 * 3600_000) throw new Error("Timestamp too old");
  }
  const num = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  await sql.query(
    `update infra_nodes set
       last_seen = now(),
       cpu_pct = $2, ram_pct = $3, disk_pct = $4, load_1 = $5,
       net_rx_bytes = $6, net_tx_bytes = $7, uptime_seconds = $8,
       postgres_ok = $9, redis_ok = $10, genieacs_ok = $11
     where id = $1`,
    [
      node.id,
      num(body.cpu_pct),
      num(body.ram_pct),
      num(body.disk_pct),
      num(body.load_1),
      num(body.net_rx_bytes),
      num(body.net_tx_bytes),
      num(body.uptime_seconds),
      body.postgres_ok ?? null,
      body.redis_ok ?? null,
      body.genieacs_ok ?? null,
    ],
  );
  return { ok: true, node_id: node.id };
}

export async function activeSupportSession(sql: Sql, userId: string) {
  const [row] = await sql<{
    id: string;
    tenant_id: string;
    reason: string;
    expires_at: string;
    name: string;
    slug: string;
    status: string;
    currency: string;
    support_email: string;
    support_phone: string;
  }>`select s.id, s.tenant_id, s.reason, s.expires_at::text as expires_at,
            t.name, t.slug, t.status, t.currency, t.support_email, t.support_phone
     from support_sessions s join tenants t on t.id = s.tenant_id
     where s.actor_user_id = ${userId} and s.status = 'active' and s.expires_at > now()
     order by s.started_at desc limit 1`;
  return row ?? null;
}

export async function startSupportAccess(
  sql: Sql,
  actorUserId: string,
  tenantId: string,
  reason: string,
) {
  await requirePlatformActor(sql, actorUserId);
  const settings = await getPlatformSettings(sql);
  if (!settings.support_access_enabled) {
    throw new Error("Support access is disabled. Enable it in System Settings.");
  }
  const why = reason.trim();
  if (why.length < 8) throw new Error("Describe why you need support access (at least 8 characters)");
  const [ten] = await sql<{ id: string; name: string }>`select id, name from tenants where id = ${tenantId}`;
  if (!ten) throw new Error("ISP not found");
  await sql`update support_sessions set status = 'ended', ended_at = now()
    where actor_user_id = ${actorUserId} and status = 'active'`;
  const minutes = settings.support_access_minutes;
  const expires = new Date(Date.now() + minutes * 60_000);
  const id = nid("sup");
  await sql`insert into support_sessions (id, actor_user_id, tenant_id, reason, expires_at)
    values (${id}, ${actorUserId}, ${tenantId}, ${why}, ${expires.toISOString()})`;
  await writePlatformAudit(sql, {
    actorUserId,
    action: "support.started",
    entityType: "support_session",
    entityId: id,
    tenantId,
    metadata: { reason: why, minutes },
  });
  return { id, tenant_id: tenantId, tenant_name: ten.name, expires_at: expires.toISOString(), reason: why };
}

export async function endSupportAccess(sql: Sql, actorUserId: string) {
  const open = await sql<{ id: string; tenant_id: string }>`
    select id, tenant_id from support_sessions
    where actor_user_id = ${actorUserId} and status = 'active'`;
  await sql`update support_sessions set status = 'ended', ended_at = now()
    where actor_user_id = ${actorUserId} and status = 'active'`;
  for (const s of open) {
    await writePlatformAudit(sql, {
      actorUserId,
      action: "support.ended",
      entityType: "support_session",
      entityId: s.id,
      tenantId: s.tenant_id,
    });
  }
  return { ok: true };
}

export async function listSubscriptionsDesk(sql: Sql, actorUserId: string) {
  await requirePlatformActor(sql, actorUserId);
  return sql<{
    tenant_id: string;
    tenant_name: string;
    plan: string;
    status: string;
    monthly_kes: number;
    billing_cycle: string;
    period_end: string | null;
    pending_plan: string;
  }>`select s.tenant_id, t.name as tenant_name, s.plan, s.status, s.monthly_kes,
            coalesce(s.billing_cycle,'monthly') as billing_cycle, s.period_end::text as period_end,
            s.pending_plan
     from tenant_subscriptions s join tenants t on t.id = s.tenant_id
     order by t.name`;
}

export async function loadRevenueDesk(sql: Sql, actorUserId: string) {
  await requirePlatformActor(sql, actorUserId);
  const invoices = await sql<{
    id: string;
    tenant_id: string;
    tenant_name: string;
    number: string;
    plan: string;
    amount_kes: number;
    status: string;
    due_date: string;
    issued_at: string;
  }>`select i.id, i.tenant_id, t.name as tenant_name, i.number, i.plan, i.amount_kes, i.status,
            i.due_date::text as due_date, i.issued_at::text as issued_at
     from saas_invoices i join tenants t on t.id = i.tenant_id
     order by i.issued_at desc limit 80`;
  const payments = await sql<{
    id: string;
    tenant_name: string;
    amount_kes: number;
    provider: string;
    reference: string;
    paid_at: string;
  }>`select p.id, t.name as tenant_name, p.amount_kes, p.provider, p.reference, p.paid_at::text as paid_at
     from saas_payments p join tenants t on t.id = p.tenant_id
     where p.status = 'confirmed'
     order by p.paid_at desc limit 80`;
  const [sum] = await sql<{
    mrr: number;
    outstanding: number;
    paid_month: number;
  }>`select
      coalesce((select sum(monthly_kes)::int from tenant_subscriptions where status in ('active','grace','past_due')),0) as mrr,
      coalesce((select sum(amount_kes)::int from saas_invoices where status in ('issued','due','overdue')),0) as outstanding,
      coalesce((select sum(amount_kes)::int from saas_payments where status = 'confirmed' and paid_at >= date_trunc('month', now())),0) as paid_month`;
  return {
    invoices,
    payments,
    mrr: sum?.mrr ?? 0,
    arr: (sum?.mrr ?? 0) * 12,
    outstanding: sum?.outstanding ?? 0,
    paid_month: sum?.paid_month ?? 0,
  };
}

