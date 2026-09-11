import { nid } from "../utils.ts";
import { provisionServiceAccess } from "./access.ts";
import { assertTenantMatch } from "./rbac.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const HARD_MAX_GRACE_DAYS = 30;

export type GraceActorType = "staff" | "customer" | "system";
export type GraceStatus = "active" | "expired" | "revoked" | "consumed";

export type GracePolicy = {
  tenant_id: string;
  staff_max_days: number;
  staff_preset_days: number[];
  allow_custom_days: boolean;
  customer_self_service: boolean;
  customer_max_days: number;
  customer_preset_days: number[];
  customer_max_uses_per_period: number;
  customer_min_account_days: number;
  customer_require_prior_payment: boolean;
  customer_block_if_already_grace: boolean;
  customer_cooldown_days: number;
  notify_nearing_hours: number;
};

export type GracePeriodRow = {
  id: string;
  tenant_id: string;
  service_id: string;
  customer_id: string;
  days_granted: number;
  starts_at: string;
  expires_at: string;
  status: GraceStatus;
  granted_by_type: GraceActorType;
  granted_by_user_id: string | null;
  granted_by_label: string;
  reason: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoked_reason: string;
  consumed_at: string | null;
  created_at: string;
};

const DEFAULT_POLICY: Omit<GracePolicy, "tenant_id"> = {
  staff_max_days: 14,
  staff_preset_days: [1, 2, 3, 5, 7],
  allow_custom_days: true,
  customer_self_service: true,
  customer_max_days: 3,
  customer_preset_days: [1, 2, 3],
  customer_max_uses_per_period: 1,
  customer_min_account_days: 30,
  customer_require_prior_payment: true,
  customer_block_if_already_grace: true,
  customer_cooldown_days: 30,
  notify_nearing_hours: 24,
};

function parseDayList(raw: string, fallback: number[]) {
  const nums = raw
    .split(/[,\s]+/)
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= HARD_MAX_GRACE_DAYS)
    .map((n) => Math.round(n));
  return nums.length ? [...new Set(nums)].sort((a, b) => a - b) : fallback;
}

function serializeDays(days: number[]) {
  return parseDayList(days.join(","), DEFAULT_POLICY.staff_preset_days).join(",");
}

function clampDays(n: number, max: number) {
  const days = Math.round(Number(n));
  if (!Number.isFinite(days) || days < 1) throw new Error("Grace days must be at least 1");
  if (days > Math.min(HARD_MAX_GRACE_DAYS, max)) {
    throw new Error(`Grace days cannot exceed ${Math.min(HARD_MAX_GRACE_DAYS, max)}`);
  }
  return days;
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /duplicate|unique/i.test(e?.message || "");
}

function mapPolicy(row: {
  tenant_id: string;
  staff_max_days: number;
  staff_preset_days: string;
  allow_custom_days: boolean;
  customer_self_service: boolean;
  customer_max_days: number;
  customer_preset_days: string;
  customer_max_uses_per_period: number;
  customer_min_account_days: number;
  customer_require_prior_payment: boolean;
  customer_block_if_already_grace: boolean;
  customer_cooldown_days: number;
  notify_nearing_hours: number;
}): GracePolicy {
  return {
    tenant_id: row.tenant_id,
    staff_max_days: row.staff_max_days,
    staff_preset_days: parseDayList(row.staff_preset_days, DEFAULT_POLICY.staff_preset_days),
    allow_custom_days: row.allow_custom_days,
    customer_self_service: row.customer_self_service,
    customer_max_days: row.customer_max_days,
    customer_preset_days: parseDayList(row.customer_preset_days, DEFAULT_POLICY.customer_preset_days),
    customer_max_uses_per_period: row.customer_max_uses_per_period,
    customer_min_account_days: row.customer_min_account_days,
    customer_require_prior_payment: row.customer_require_prior_payment,
    customer_block_if_already_grace: row.customer_block_if_already_grace,
    customer_cooldown_days: row.customer_cooldown_days,
    notify_nearing_hours: row.notify_nearing_hours,
  };
}

export function computeGraceExpiry(periodEnd: string | null, days: number, now = new Date()) {
  const ms = Math.max(1, Math.round(days)) * 86400_000;
  const paid = periodEnd ? Date.parse(periodEnd) : NaN;
  const fromPaid = Number.isFinite(paid) ? paid + ms : NaN;
  if (Number.isFinite(fromPaid) && fromPaid > now.getTime()) return new Date(fromPaid);
  return new Date(now.getTime() + ms);
}

export function graceStartsAt(periodEnd: string | null, now = new Date()) {
  const paid = periodEnd ? Date.parse(periodEnd) : NaN;
  if (Number.isFinite(paid) && paid > now.getTime()) return new Date(paid);
  return now;
}

export function remainingMs(expiresAt: string, now = new Date()) {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - now.getTime());
}

export function remainingLabel(expiresAt: string, now = new Date()) {
  const ms = remainingMs(expiresAt, now);
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86400_000);
  const hours = Math.floor((ms % 86400_000) / 3600_000);
  if (days > 1) return `${days} days remaining`;
  if (days === 1) return hours > 0 ? `1 day ${hours}h remaining` : "1 day remaining";
  if (hours > 1) return `${hours} hours remaining`;
  if (hours === 1) return "1 hour remaining";
  return "Less than an hour remaining";
}

export function formatGraceDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(new Date(t));
}

async function writeAudit(
  sql: Sql,
  tenantId: string,
  userId: string | null,
  action: string,
  entityId: string,
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, ${userId || "system"}, ${action}, ${"service_grace"}, ${entityId})`;
}

async function writeEvent(
  sql: Sql,
  opts: {
    tenantId: string;
    graceId: string;
    serviceId: string;
    action: "granted" | "extended" | "revoked" | "expired" | "consumed";
    days?: number;
    previousExpiresAt?: string | null;
    newExpiresAt?: string | null;
    actorType: GraceActorType;
    actorId?: string | null;
    reason?: string;
  },
) {
  await sql`insert into service_grace_events
    (id, tenant_id, grace_id, service_id, action, days, previous_expires_at, new_expires_at, actor_type, actor_id, reason)
    values (
      ${nid("gev")}, ${opts.tenantId}, ${opts.graceId}, ${opts.serviceId}, ${opts.action}, ${opts.days ?? 0},
      ${opts.previousExpiresAt ?? null}, ${opts.newExpiresAt ?? null}, ${opts.actorType},
      ${opts.actorId ?? null}, ${opts.reason ?? ""}
    )`;
}

async function notify(
  sql: Sql,
  tenantId: string,
  ispName: string,
  customerId: string,
  event: "grace.started" | "grace.granted" | "grace.ending" | "grace.expired",
  entityId: string,
  vars: { service_name?: string; grace_until?: string; renewal_date?: string; days?: string },
) {
  const { notifyCustomerEvent } = await import("./notifications.ts");
  return notifyCustomerEvent(sql, tenantId, ispName, customerId, event, entityId, {
    customer_name: "",
    ...vars,
  });
}

export async function getGracePolicy(sql: Sql, tenantId: string): Promise<GracePolicy> {
  const [row] = await sql<{
    tenant_id: string;
    staff_max_days: number;
    staff_preset_days: string;
    allow_custom_days: boolean;
    customer_self_service: boolean;
    customer_max_days: number;
    customer_preset_days: string;
    customer_max_uses_per_period: number;
    customer_min_account_days: number;
    customer_require_prior_payment: boolean;
    customer_block_if_already_grace: boolean;
    customer_cooldown_days: number;
    notify_nearing_hours: number;
  }>`select tenant_id, staff_max_days, staff_preset_days, allow_custom_days,
            customer_self_service, customer_max_days, customer_preset_days,
            customer_max_uses_per_period, customer_min_account_days,
            customer_require_prior_payment, customer_block_if_already_grace,
            customer_cooldown_days, notify_nearing_hours
     from grace_policies where tenant_id = ${tenantId}`;
  if (row) return mapPolicy(row);
  return { tenant_id: tenantId, ...DEFAULT_POLICY };
}

export async function saveGracePolicy(
  sql: Sql,
  tenantId: string,
  patch: Partial<Omit<GracePolicy, "tenant_id" | "staff_preset_days" | "customer_preset_days">> & {
    staff_preset_days?: number[] | string;
    customer_preset_days?: number[] | string;
  },
): Promise<GracePolicy> {
  const current = await getGracePolicy(sql, tenantId);
  const staffPresets = serializeDays(
    typeof patch.staff_preset_days === "string"
      ? parseDayList(patch.staff_preset_days, current.staff_preset_days)
      : (patch.staff_preset_days ?? current.staff_preset_days),
  );
  const customerPresets = serializeDays(
    typeof patch.customer_preset_days === "string"
      ? parseDayList(patch.customer_preset_days, current.customer_preset_days)
      : (patch.customer_preset_days ?? current.customer_preset_days),
  );
  const staffMax = clampDays(patch.staff_max_days ?? current.staff_max_days, HARD_MAX_GRACE_DAYS);
  const customerMax = clampDays(patch.customer_max_days ?? current.customer_max_days, staffMax);
  const uses = Math.max(1, Math.round(patch.customer_max_uses_per_period ?? current.customer_max_uses_per_period));
  const minAge = Math.max(0, Math.round(patch.customer_min_account_days ?? current.customer_min_account_days));
  const cooldown = Math.max(0, Math.round(patch.customer_cooldown_days ?? current.customer_cooldown_days));
  const nearing = Math.max(1, Math.round(patch.notify_nearing_hours ?? current.notify_nearing_hours));
  await sql`insert into grace_policies (
      tenant_id, staff_max_days, staff_preset_days, allow_custom_days,
      customer_self_service, customer_max_days, customer_preset_days,
      customer_max_uses_per_period, customer_min_account_days,
      customer_require_prior_payment, customer_block_if_already_grace,
      customer_cooldown_days, notify_nearing_hours, updated_at
    ) values (
      ${tenantId}, ${staffMax}, ${staffPresets}, ${patch.allow_custom_days ?? current.allow_custom_days},
      ${patch.customer_self_service ?? current.customer_self_service}, ${customerMax}, ${customerPresets},
      ${uses}, ${minAge},
      ${patch.customer_require_prior_payment ?? current.customer_require_prior_payment},
      ${patch.customer_block_if_already_grace ?? current.customer_block_if_already_grace},
      ${cooldown}, ${nearing}, now()
    )
    on conflict (tenant_id) do update set
      staff_max_days = excluded.staff_max_days,
      staff_preset_days = excluded.staff_preset_days,
      allow_custom_days = excluded.allow_custom_days,
      customer_self_service = excluded.customer_self_service,
      customer_max_days = excluded.customer_max_days,
      customer_preset_days = excluded.customer_preset_days,
      customer_max_uses_per_period = excluded.customer_max_uses_per_period,
      customer_min_account_days = excluded.customer_min_account_days,
      customer_require_prior_payment = excluded.customer_require_prior_payment,
      customer_block_if_already_grace = excluded.customer_block_if_already_grace,
      customer_cooldown_days = excluded.customer_cooldown_days,
      notify_nearing_hours = excluded.notify_nearing_hours,
      updated_at = now()`;
  return getGracePolicy(sql, tenantId);
}

export async function activeGrant(sql: Sql, tenantId: string, serviceId: string) {
  const [row] = await sql<GracePeriodRow>`
    select id, tenant_id, service_id, customer_id, days_granted,
           starts_at::text as starts_at, expires_at::text as expires_at, status,
           granted_by_type, granted_by_user_id, granted_by_label, reason,
           revoked_at::text as revoked_at, revoked_by_user_id, revoked_reason,
           consumed_at::text as consumed_at, created_at::text as created_at
    from service_grace_periods
    where tenant_id = ${tenantId} and service_id = ${serviceId} and status = 'active'
    limit 1`;
  return row ?? null;
}

export async function grantAccessUntilMs(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  periodEnd: string | null,
  packageGraceDays: number,
  now = Date.now(),
) {
  const paid = periodEnd ? Date.parse(periodEnd) : NaN;
  const pkg = Number.isFinite(paid) ? paid + Math.max(0, packageGraceDays) * 86400_000 : 0;
  const grant = await activeGrant(sql, tenantId, serviceId);
  const granted = grant ? Date.parse(grant.expires_at) : 0;
  const until = Math.max(pkg, Number.isFinite(granted) ? granted : 0);
  return until > now ? until : 0;
}

async function loadService(
  sql: Sql,
  tenantId: string,
  serviceId: string,
) {
  const [svc] = await sql<{
    id: string;
    tenant_id: string;
    customer_id: string;
    status: string;
    period_end: string | null;
    bundle_used_mb: number;
    bundle_mb: number;
    package_name: string;
    grace_days: number;
  }>`select s.id, s.tenant_id, s.customer_id, s.status, s.period_end::text as period_end,
            s.bundle_used_mb, p.bundle_mb, p.name as package_name, p.grace_days
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  if (!svc) throw new Error("Service not found");
  return svc;
}

async function activateGraceAccess(sql: Sql, tenantId: string, serviceId: string, reason: string) {
  await sql`update services
    set status = 'grace', suspend_reason = ${reason}
    where id = ${serviceId} and tenant_id = ${tenantId}
      and status in ('active','grace','suspended','pending')`;
  await provisionServiceAccess(sql, tenantId, serviceId);
}

export async function grantGrace(
  sql: Sql,
  opts: {
    tenantId: string;
    serviceId: string;
    days: number;
    reason?: string;
    actorType: GraceActorType;
    actorId?: string | null;
    actorLabel?: string;
    ispName: string;
    now?: Date;
    maxDays?: number;
  },
) {
  const now = opts.now ?? new Date();
  const days = clampDays(opts.days, opts.maxDays ?? HARD_MAX_GRACE_DAYS);
  const svc = await loadService(sql, opts.tenantId, opts.serviceId);
  assertTenantMatch(svc.tenant_id, opts.tenantId);
  if (svc.status === "terminated") throw new Error("Cannot grant grace on a terminated service");
  const existing = await activeGrant(sql, opts.tenantId, svc.id);
  if (existing) throw new Error("This service already has an active grace period. Extend it instead.");
  const starts = graceStartsAt(svc.period_end, now);
  const expires = computeGraceExpiry(svc.period_end, days, now);
  const id = nid("grp");
  try {
    await sql`insert into service_grace_periods
      (id, tenant_id, service_id, customer_id, days_granted, starts_at, expires_at, status,
       granted_by_type, granted_by_user_id, granted_by_label, reason)
      values (
        ${id}, ${opts.tenantId}, ${svc.id}, ${svc.customer_id}, ${days},
        ${starts.toISOString()}, ${expires.toISOString()}, ${"active"},
        ${opts.actorType}, ${opts.actorId ?? null}, ${opts.actorLabel || opts.actorType},
        ${opts.reason?.trim() || ""}
      )`;
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error("This service already has an active grace period. Extend it instead.");
    throw err;
  }
  await writeEvent(sql, {
    tenantId: opts.tenantId,
    graceId: id,
    serviceId: svc.id,
    action: "granted",
    days,
    newExpiresAt: expires.toISOString(),
    actorType: opts.actorType,
    actorId: opts.actorId,
    reason: opts.reason,
  });
  await writeAudit(sql, opts.tenantId, opts.actorId ?? null, "service.grace.granted", id);
  const paidEnded = !svc.period_end || Date.parse(svc.period_end) <= now.getTime();
  if (paidEnded || svc.status === "suspended" || svc.status === "grace" || svc.status === "pending") {
    await activateGraceAccess(sql, opts.tenantId, svc.id, opts.actorType === "customer" ? "grace_customer" : "grace_staff");
  }
  const renewal = formatGraceDate(svc.period_end);
  const until = formatGraceDate(expires.toISOString());
  await notify(sql, opts.tenantId, opts.ispName, svc.customer_id, "grace.granted", id, {
    service_name: svc.package_name,
    grace_until: until,
    renewal_date: renewal,
    days: String(days),
  });
  return {
    id,
    days_granted: days,
    starts_at: starts.toISOString(),
    expires_at: expires.toISOString(),
    period_end: svc.period_end,
    status: "active" as const,
  };
}

export async function extendGrace(
  sql: Sql,
  opts: {
    tenantId: string;
    serviceId: string;
    days: number;
    reason?: string;
    actorType: GraceActorType;
    actorId?: string | null;
    actorLabel?: string;
    ispName: string;
    now?: Date;
    maxDays?: number;
  },
) {
  const now = opts.now ?? new Date();
  const extra = clampDays(opts.days, opts.maxDays ?? HARD_MAX_GRACE_DAYS);
  const svc = await loadService(sql, opts.tenantId, opts.serviceId);
  assertTenantMatch(svc.tenant_id, opts.tenantId);
  const grant = await activeGrant(sql, opts.tenantId, svc.id);
  if (!grant) throw new Error("No active grace period to extend");
  const previous = grant.expires_at;
  const base = Math.max(Date.parse(grant.expires_at), now.getTime());
  const next = new Date(base + extra * 86400_000);
  const newDays = grant.days_granted + extra;
  if (newDays > HARD_MAX_GRACE_DAYS) throw new Error(`Grace days cannot exceed ${HARD_MAX_GRACE_DAYS}`);
  await sql`update service_grace_periods
    set expires_at = ${next.toISOString()}, days_granted = ${newDays},
        reason = case when ${opts.reason?.trim() || ""} = '' then reason
                      else reason || case when reason = '' then '' else ' · ' end || ${opts.reason?.trim() || ""} end
    where id = ${grant.id} and tenant_id = ${opts.tenantId} and status = 'active'`;
  await writeEvent(sql, {
    tenantId: opts.tenantId,
    graceId: grant.id,
    serviceId: svc.id,
    action: "extended",
    days: extra,
    previousExpiresAt: previous,
    newExpiresAt: next.toISOString(),
    actorType: opts.actorType,
    actorId: opts.actorId,
    reason: opts.reason,
  });
  await writeAudit(sql, opts.tenantId, opts.actorId ?? null, "service.grace.extended", grant.id);
  if (svc.status === "suspended") {
    await activateGraceAccess(sql, opts.tenantId, svc.id, "grace_staff");
  }
  await notify(sql, opts.tenantId, opts.ispName, svc.customer_id, "grace.granted", `${grant.id}:ext:${next.toISOString().slice(0, 10)}`, {
    service_name: svc.package_name,
    grace_until: formatGraceDate(next.toISOString()),
    renewal_date: formatGraceDate(svc.period_end),
    days: String(extra),
  });
  return { id: grant.id, days_granted: newDays, expires_at: next.toISOString(), period_end: svc.period_end };
}

export async function revokeGrace(
  sql: Sql,
  opts: {
    tenantId: string;
    serviceId: string;
    reason?: string;
    actorId?: string | null;
    now?: Date;
  },
) {
  const now = opts.now ?? new Date();
  const svc = await loadService(sql, opts.tenantId, opts.serviceId);
  assertTenantMatch(svc.tenant_id, opts.tenantId);
  const grant = await activeGrant(sql, opts.tenantId, svc.id);
  if (!grant) throw new Error("No active grace period to revoke");
  await sql`update service_grace_periods
    set status = 'revoked', revoked_at = ${now.toISOString()},
        revoked_by_user_id = ${opts.actorId ?? null}, revoked_reason = ${opts.reason?.trim() || ""}
    where id = ${grant.id} and tenant_id = ${opts.tenantId} and status = 'active'`;
  await writeEvent(sql, {
    tenantId: opts.tenantId,
    graceId: grant.id,
    serviceId: svc.id,
    action: "revoked",
    days: grant.days_granted,
    previousExpiresAt: grant.expires_at,
    actorType: "staff",
    actorId: opts.actorId,
    reason: opts.reason,
  });
  await writeAudit(sql, opts.tenantId, opts.actorId ?? null, "service.grace.revoked", grant.id);
  const pkgUntil = svc.period_end
    ? Date.parse(svc.period_end) + Math.max(0, svc.grace_days) * 86400_000
    : 0;
  const stillCovered = pkgUntil > now.getTime();
  if (!stillCovered && svc.status !== "terminated") {
    await sql`update services
      set status = 'suspended', suspend_reason = 'grace_revoked'
      where id = ${svc.id} and tenant_id = ${opts.tenantId} and status in ('active','grace')`;
    await provisionServiceAccess(sql, opts.tenantId, svc.id);
  }
  return { id: grant.id, status: "revoked" as const, period_end: svc.period_end };
}

export async function consumeActiveGrantsForCustomer(sql: Sql, tenantId: string, customerId: string, now = new Date()) {
  const rows = await sql<{ id: string; service_id: string }>`
    select id, service_id from service_grace_periods
    where tenant_id = ${tenantId} and customer_id = ${customerId} and status = 'active'`;
  for (const row of rows) {
    await sql`update service_grace_periods
      set status = 'consumed', consumed_at = ${now.toISOString()}
      where id = ${row.id} and tenant_id = ${tenantId} and status = 'active'`;
    await writeEvent(sql, {
      tenantId,
      graceId: row.id,
      serviceId: row.service_id,
      action: "consumed",
      actorType: "system",
    });
    await writeAudit(sql, tenantId, null, "service.grace.consumed", row.id);
  }
  return rows.length;
}

export async function ensureSystemGrant(
  sql: Sql,
  opts: {
    tenantId: string;
    serviceId: string;
    customerId: string;
    days: number;
    expiresAt: Date;
    startsAt: Date;
  },
) {
  if (opts.days < 1) return null;
  const existing = await activeGrant(sql, opts.tenantId, opts.serviceId);
  if (existing) return existing;
  const id = nid("grp");
  try {
    await sql`insert into service_grace_periods
      (id, tenant_id, service_id, customer_id, days_granted, starts_at, expires_at, status,
       granted_by_type, granted_by_label, reason)
      values (
        ${id}, ${opts.tenantId}, ${opts.serviceId}, ${opts.customerId}, ${Math.min(HARD_MAX_GRACE_DAYS, opts.days)},
        ${opts.startsAt.toISOString()}, ${opts.expiresAt.toISOString()}, ${"active"},
        ${"system"}, ${"Automatic"}, ${"Package grace"}
      )`;
  } catch (err) {
    if (isUniqueViolation(err)) return activeGrant(sql, opts.tenantId, opts.serviceId);
    throw err;
  }
  await writeEvent(sql, {
    tenantId: opts.tenantId,
    graceId: id,
    serviceId: opts.serviceId,
    action: "granted",
    days: opts.days,
    newExpiresAt: opts.expiresAt.toISOString(),
    actorType: "system",
  });
  return activeGrant(sql, opts.tenantId, opts.serviceId);
}

export async function expireDueGrants(sql: Sql, tenantId: string, ispName: string, now = new Date()) {
  const rows = await sql<{
    id: string;
    service_id: string;
    customer_id: string;
    expires_at: string;
    package_name: string;
    period_end: string | null;
  }>`select g.id, g.service_id, g.customer_id, g.expires_at::text as expires_at,
            p.name as package_name, s.period_end::text as period_end
     from service_grace_periods g
     join services s on s.id = g.service_id
     join packages p on p.id = s.package_id
     where g.tenant_id = ${tenantId} and g.status = 'active' and g.expires_at <= ${now.toISOString()}`;
  let expired = 0;
  for (const row of rows) {
    const updated = await sql<{ id: string }>`
      update service_grace_periods set status = 'expired'
      where id = ${row.id} and tenant_id = ${tenantId} and status = 'active'
      returning id`;
    if (!updated[0]) continue;
    await writeEvent(sql, {
      tenantId,
      graceId: row.id,
      serviceId: row.service_id,
      action: "expired",
      previousExpiresAt: row.expires_at,
      actorType: "system",
    });
    await writeAudit(sql, tenantId, null, "service.grace.expired", row.id);
    await notify(sql, tenantId, ispName, row.customer_id, "grace.expired", row.id, {
      service_name: row.package_name,
      grace_until: formatGraceDate(row.expires_at),
      renewal_date: formatGraceDate(row.period_end),
    });
    expired += 1;
  }
  return expired;
}

export async function notifyNearingGrants(sql: Sql, tenantId: string, ispName: string, now = new Date()) {
  const policy = await getGracePolicy(sql, tenantId);
  const horizon = new Date(now.getTime() + Math.max(1, policy.notify_nearing_hours) * 3600_000);
  const rows = await sql<{
    id: string;
    customer_id: string;
    expires_at: string;
    package_name: string;
    period_end: string | null;
  }>`select g.id, g.customer_id, g.expires_at::text as expires_at, p.name as package_name,
            s.period_end::text as period_end
     from service_grace_periods g
     join services s on s.id = g.service_id
     join packages p on p.id = s.package_id
     where g.tenant_id = ${tenantId} and g.status = 'active'
       and g.expires_at > ${now.toISOString()}
       and g.expires_at <= ${horizon.toISOString()}`;
  let sent = 0;
  for (const row of rows) {
    sent += await notify(sql, tenantId, ispName, row.customer_id, "grace.ending", row.id, {
      service_name: row.package_name,
      grace_until: formatGraceDate(row.expires_at),
      renewal_date: formatGraceDate(row.period_end),
    });
  }
  return sent;
}

export type CustomerGraceEligibility = {
  ok: boolean;
  reason: string;
  allowed_days: number[];
  max_days: number;
  service_id: string;
  period_end: string | null;
};

export async function customerGraceEligibility(
  sql: Sql,
  tenantId: string,
  customerId: string,
  serviceId: string,
  now = new Date(),
): Promise<CustomerGraceEligibility> {
  const policy = await getGracePolicy(sql, tenantId);
  const empty = (reason: string, svc?: { period_end: string | null }): CustomerGraceEligibility => ({
    ok: false,
    reason,
    allowed_days: [],
    max_days: policy.customer_max_days,
    service_id: serviceId,
    period_end: svc?.period_end ?? null,
  });
  if (!policy.customer_self_service) {
    return empty("Your ISP has not enabled self-service grace.");
  }
  const svc = await loadService(sql, tenantId, serviceId);
  if (svc.customer_id !== customerId) return empty("Service not found");
  if (svc.status === "terminated") return empty("This service is terminated.", svc);
  if (svc.bundle_mb > 0 && svc.bundle_used_mb >= svc.bundle_mb) {
    return empty("Data on this package is used up. Grace cannot restore a used bundle.", svc);
  }
  const grant = await activeGrant(sql, tenantId, svc.id);
  if (policy.customer_block_if_already_grace && (svc.status === "grace" || grant)) {
    return empty("This line is already on a grace period.", svc);
  }
  const [cus] = await sql<{ created_at: string }>`
    select created_at::text as created_at from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  const ageDays = cus ? Math.floor((now.getTime() - Date.parse(cus.created_at)) / 86400_000) : 0;
  if (ageDays < policy.customer_min_account_days) {
    return empty(`Account must be at least ${policy.customer_min_account_days} days old.`, svc);
  }
  if (policy.customer_require_prior_payment) {
    const [pay] = await sql<{ id: string }>`
      select id from payments
      where tenant_id = ${tenantId} and customer_id = ${customerId} and status = 'confirmed' limit 1`;
    if (!pay) return empty("A previous confirmed payment is required before you can add grace.", svc);
  }
  const [overdue] = await sql<{ id: string }>`
    select id from invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('issued','due','overdue','partial')
      and due_date::text < ${now.toISOString().slice(0, 10)}
    limit 1`;
  const paidEnded = !svc.period_end || Date.parse(svc.period_end) <= now.getTime();
  if (!paidEnded && svc.status === "active" && !overdue) {
    return empty("Grace is only available after the paid-through date, or when an invoice is overdue.", svc);
  }
  const since = new Date(now.getTime() - Math.max(policy.customer_cooldown_days, 1) * 86400_000);
  const used = await sql<{ id: string; created_at: string }>`
    select id, created_at::text as created_at from service_grace_periods
    where tenant_id = ${tenantId} and service_id = ${svc.id} and granted_by_type = 'customer'
      and created_at >= ${since.toISOString()}`;
  if (used.length >= policy.customer_max_uses_per_period) {
    return empty("You have already used the allowed grace for this period.", svc);
  }
  const last = used[0] ? Date.parse(used[0].created_at) : 0;
  if (last && now.getTime() - last < policy.customer_cooldown_days * 86400_000) {
    return empty(`Please wait ${policy.customer_cooldown_days} days between grace requests.`, svc);
  }
  const allowed = policy.customer_preset_days.filter((d) => d <= policy.customer_max_days);
  if (!allowed.length) return empty("No grace day options are configured.", svc);
  return {
    ok: true,
    reason: "",
    allowed_days: allowed,
    max_days: policy.customer_max_days,
    service_id: svc.id,
    period_end: svc.period_end,
  };
}

export async function customerSelfGrant(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    serviceId: string;
    days: number;
    ispName: string;
    now?: Date;
  },
) {
  const now = opts.now ?? new Date();
  const eligibility = await customerGraceEligibility(sql, opts.tenantId, opts.customerId, opts.serviceId, now);
  if (!eligibility.ok) throw new Error(eligibility.reason);
  if (!eligibility.allowed_days.includes(Math.round(opts.days))) {
    throw new Error("That number of days is not allowed for self-service grace.");
  }
  const policy = await getGracePolicy(sql, opts.tenantId);
  return grantGrace(sql, {
    tenantId: opts.tenantId,
    serviceId: opts.serviceId,
    days: opts.days,
    reason: "Requested from customer portal",
    actorType: "customer",
    actorLabel: "Customer portal",
    ispName: opts.ispName,
    now,
    maxDays: policy.customer_max_days,
  });
}

export async function listGraceReport(sql: Sql, tenantId: string) {
  const current = await sql<{
    id: string;
    service_id: string;
    customer_id: string;
    customer_name: string;
    package_name: string;
    days_granted: number;
    starts_at: string;
    expires_at: string;
    granted_by_label: string;
    granted_by_type: string;
    period_end: string | null;
    status: string;
    reason: string;
  }>`select g.id, g.service_id, g.customer_id, c.name as customer_name, p.name as package_name,
            g.days_granted, g.starts_at::text as starts_at, g.expires_at::text as expires_at,
            g.granted_by_label, g.granted_by_type, s.period_end::text as period_end,
            g.status, g.reason
     from service_grace_periods g
     join services s on s.id = g.service_id
     join customers c on c.id = g.customer_id
     join packages p on p.id = s.package_id
     where g.tenant_id = ${tenantId}
     order by g.created_at desc
     limit 80`;
  const [counts] = await sql<{
    active: number;
    expired: number;
    revoked: number;
    consumed: number;
    days_granted: number;
  }>`select
      count(*) filter (where status = 'active')::int as active,
      count(*) filter (where status = 'expired')::int as expired,
      count(*) filter (where status = 'revoked')::int as revoked,
      count(*) filter (where status = 'consumed')::int as consumed,
      coalesce(sum(days_granted) filter (where status = 'active'),0)::int as days_granted
     from service_grace_periods where tenant_id = ${tenantId}`;
  const byStaff = await sql<{ label: string; n: number; days: number }>`
    select coalesce(nullif(granted_by_label,''), granted_by_type) as label,
           count(*)::int as n, coalesce(sum(days_granted),0)::int as days
    from service_grace_periods
    where tenant_id = ${tenantId} and granted_by_type = 'staff'
    group by 1
    order by n desc`;
  const [suspendedAfter] = await sql<{ n: number }>`
    select count(*)::int as n from services
    where tenant_id = ${tenantId} and status = 'suspended' and suspend_reason in ('time','invoice','grace_revoked')
      and id in (select service_id from service_grace_periods where tenant_id = ${tenantId} and status = 'expired')`;
  return {
    current,
    counts: counts ?? { active: 0, expired: 0, revoked: 0, consumed: 0, days_granted: 0 },
    byStaff,
    suspendedAfter: suspendedAfter?.n ?? 0,
  };
}
