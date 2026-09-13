import { nid } from "../utils.ts";
import { provisionServiceAccess } from "./access.ts";
import { nairobiDate } from "./empty-tenant.ts";
import {
  STAFF_EXPIRY_SOURCE,
  effectiveAccessIso,
  isPastNairobiDate,
  parseExpiryYmd,
  resolveStaffExpiryOutcome,
} from "./service-expiry-format.ts";
import type { ServiceStatus } from "./types.ts";

export {
  STAFF_EXPIRY_REASON,
  STAFF_EXPIRY_SOURCE,
  effectiveAccessEndMs,
  effectiveAccessIso,
  isPastNairobiDate,
  parseExpiryYmd,
  previewStaffExpiry,
  resolveStaffExpiryOutcome,
} from "./service-expiry-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

async function invoiceBlocksRestore(sql: Sql, tenantId: string, customerId: string) {
  const today = nairobiDate();
  const rows = await sql<{ id: string }>`
    select id from invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('issued','due','overdue','partial')
      and due_date::text < ${today}
    limit 1`;
  return Boolean(rows[0]);
}

async function auditExpiryFailure(
  sql: Sql,
  tenantId: string,
  opts: { actorId: string; serviceId: string; code: string },
) {
  try {
    const details = JSON.stringify({
      error: opts.code,
      source: STAFF_EXPIRY_SOURCE,
      trigger_billing: false,
      send_customer_notifications: false,
    });
    await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
      values (${nid("aud")}, ${tenantId}, ${opts.actorId}, ${"service.expiry.update.failed"}, ${"service"}, ${opts.serviceId}, ${details})`;
  } catch {
    /* never hide the original error */
  }
}

async function consumeServiceGrants(sql: Sql, tenantId: string, serviceId: string) {
  await sql`update service_grace_periods
    set status = ${"consumed"}, consumed_at = now()
    where tenant_id = ${tenantId} and service_id = ${serviceId} and status = ${"active"}`;
}

export async function setServiceExpiry(
  sql: Sql,
  tenantId: string,
  opts: {
    serviceId: string;
    ymd: string;
    reason: string;
    actorId: string;
    actorLabel?: string;
    now?: Date;
  },
) {
  const reason = String(opts.reason || "").trim();
  if (!reason) {
    await auditExpiryFailure(sql, tenantId, { actorId: opts.actorId, serviceId: opts.serviceId, code: "reason_required" });
    throw new Error("A reason is required");
  }

  let ymd: string;
  let accessUntil: Date;
  try {
    ({ ymd, accessUntil } = parseExpiryYmd(opts.ymd));
  } catch (err) {
    await auditExpiryFailure(sql, tenantId, { actorId: opts.actorId, serviceId: opts.serviceId, code: "invalid_date" });
    throw err;
  }
  const past = isPastNairobiDate(ymd, opts.now);

  const [svc] = await sql<{
    id: string;
    customer_id: string;
    status: string;
    suspend_reason: string;
    period_end: string | null;
    access_until: string | null;
    expiry_source: string;
    bundle_used_mb: number;
    bundle_mb: number;
    package_name: string;
    customer_name: string;
    account_number: string;
  }>`select s.id, s.customer_id, s.status, s.suspend_reason, s.period_end::text as period_end,
            s.access_until::text as access_until, s.expiry_source, s.bundle_used_mb, p.bundle_mb,
            p.name as package_name, c.name as customer_name, coalesce(c.account_number,'') as account_number
     from services s
     join packages p on p.id = s.package_id
     join customers c on c.id = s.customer_id
     where s.id = ${opts.serviceId} and s.tenant_id = ${tenantId}`;
  if (!svc) {
    await auditExpiryFailure(sql, tenantId, { actorId: opts.actorId, serviceId: opts.serviceId, code: "not_found" });
    throw new Error("Service not found");
  }

  const previousExpiry = effectiveAccessIso(svc);
  const previousStatus = svc.status as ServiceStatus;
  const billingPeriodEnd = svc.period_end;

  const invoiceBlocked = !past && (await invoiceBlocksRestore(sql, tenantId, svc.customer_id));
  const outcome = resolveStaffExpiryOutcome({
    past,
    status: svc.status,
    suspend_reason: svc.suspend_reason,
    bundleBlocked: svc.bundle_mb > 0 && svc.bundle_used_mb >= svc.bundle_mb,
    invoiceBlocked,
  });

  await sql`update services
    set access_until = ${accessUntil.toISOString()},
        expiry_source = ${"staff"},
        expiry_changed_by = ${opts.actorId},
        expiry_changed_at = now(),
        expiry_change_reason = ${reason.slice(0, 240)},
        status = ${outcome.status},
        suspend_reason = ${outcome.reason}
    where id = ${svc.id} and tenant_id = ${tenantId}`;

  await consumeServiceGrants(sql, tenantId, svc.id);
  await provisionServiceAccess(sql, tenantId, svc.id);

  const details = JSON.stringify({
    customer_id: svc.customer_id,
    customer_name: svc.customer_name,
    previous_expiry: previousExpiry,
    new_expiry: accessUntil.toISOString(),
    selected_date: ymd,
    previous_status: previousStatus,
    resulting_status: outcome.status,
    reason,
    actor_label: opts.actorLabel || "",
    source: STAFF_EXPIRY_SOURCE,
    trigger_billing: false,
    send_customer_notifications: false,
  });
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${opts.actorId}, ${"service.expiry.update"}, ${"service"}, ${svc.id}, ${details})`;

  return {
    id: svc.id,
    customer_id: svc.customer_id,
    customer_name: svc.customer_name,
    account_number: svc.account_number,
    package_name: svc.package_name,
    previous_expiry: previousExpiry,
    period_end: billingPeriodEnd,
    access_until: accessUntil.toISOString(),
    expiry_source: "staff" as const,
    previous_status: previousStatus,
    status: outcome.status,
    suspend_reason: outcome.reason,
    source: STAFF_EXPIRY_SOURCE,
    trigger_billing: false as const,
    send_customer_notifications: false as const,
  };
}
