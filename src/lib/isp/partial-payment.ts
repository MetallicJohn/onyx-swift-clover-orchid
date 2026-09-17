import { nid } from "../utils.ts";
import { grantPaidPeriod, periodMs, restorePaidAccess } from "./access-policy.ts";
import { remainingKes } from "./billing.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { assertTenantMatch } from "./rbac.ts";
import {
  DEFAULT_PARTIAL_POLICY,
  clampPct,
  decidePartialAccess,
  kesPercent,
  portalMinKes,
  previewPartial,
  resolveEffectivePartial,
  type EffectivePartial,
  type PartialDecision,
  type PartialOutcome,
  type PartialPolicySnapshot,
} from "./partial-payment-format.ts";

export {
  DEFAULT_PARTIAL_POLICY,
  clampPct,
  decidePartialAccess,
  kesPercent,
  portalMinKes,
  previewPartial,
  resolveEffectivePartial,
};
export type { EffectivePartial, PartialDecision, PartialOutcome, PartialPolicySnapshot };

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type PartialPaymentPolicy = PartialPolicySnapshot & { tenant_id: string };

export type PartialPaymentEvent = {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_id: string | null;
  invoice_id: string | null;
  payment_id: string;
  service_account_number: string;
  amount_kes: number;
  full_amount_kes: number;
  paid_kes: number;
  required_pct: number;
  actual_pct: number;
  minimum_kes: number;
  qualifies: boolean;
  validity_ms: number;
  validity_days: number;
  previous_expiry: string | null;
  new_expiry: string | null;
  reference: string;
  provider: string;
  outcome: PartialOutcome;
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  blocked_reason: string;
  created_at: string;
};

function mapPolicy(row: Partial<PartialPaymentPolicy> | undefined, tenantId: string): PartialPaymentPolicy {
  return {
    tenant_id: tenantId,
    enabled_default: Boolean(row?.enabled_default ?? DEFAULT_PARTIAL_POLICY.enabled_default),
    default_min_pct: Number(row?.default_min_pct ?? DEFAULT_PARTIAL_POLICY.default_min_pct),
    allow_customer_override: row?.allow_customer_override ?? DEFAULT_PARTIAL_POLICY.allow_customer_override,
    allow_service_override: row?.allow_service_override ?? DEFAULT_PARTIAL_POLICY.allow_service_override,
    min_pct: Number(row?.min_pct ?? DEFAULT_PARTIAL_POLICY.min_pct),
    max_pct: Number(row?.max_pct ?? DEFAULT_PARTIAL_POLICY.max_pct),
    can_activate_new: row?.can_activate_new ?? DEFAULT_PARTIAL_POLICY.can_activate_new,
    can_restore_expired: row?.can_restore_expired ?? DEFAULT_PARTIAL_POLICY.can_restore_expired,
    can_renew_active: row?.can_renew_active ?? DEFAULT_PARTIAL_POLICY.can_renew_active,
    can_extend_active: row?.can_extend_active ?? DEFAULT_PARTIAL_POLICY.can_extend_active,
    requires_approval: row?.requires_approval ?? DEFAULT_PARTIAL_POLICY.requires_approval,
  };
}

async function writeAudit(
  sql: Sql,
  tenantId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details = "",
) {
  try {
    await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
      values (${nid("aud")}, ${tenantId}, ${userId || "system"}, ${action}, ${entityType}, ${entityId}, ${details})`;
  } catch {
    /* audit is best-effort */
  }
}

export async function getPartialPolicy(sql: Sql, tenantId: string): Promise<PartialPaymentPolicy> {
  const [row] = await sql<PartialPaymentPolicy>`
    select tenant_id, enabled_default, default_min_pct, allow_customer_override, allow_service_override,
           min_pct, max_pct, can_activate_new, can_restore_expired, can_renew_active, can_extend_active,
           requires_approval
    from partial_payment_policies where tenant_id = ${tenantId}`;
  return mapPolicy(row, tenantId);
}

export async function savePartialPolicy(
  sql: Sql,
  tenantId: string,
  patch: Partial<PartialPolicySnapshot>,
  actorId?: string | null,
): Promise<PartialPaymentPolicy> {
  const current = await getPartialPolicy(sql, tenantId);
  const minPct = clampPct(patch.min_pct ?? current.min_pct, 1, 100);
  const maxPct = clampPct(patch.max_pct ?? current.max_pct, minPct, 100);
  const defaultMin = clampPct(patch.default_min_pct ?? current.default_min_pct, minPct, maxPct);
  const next = {
    enabled_default: patch.enabled_default ?? current.enabled_default,
    default_min_pct: defaultMin,
    allow_customer_override: patch.allow_customer_override ?? current.allow_customer_override,
    allow_service_override: patch.allow_service_override ?? current.allow_service_override,
    min_pct: minPct,
    max_pct: maxPct,
    can_activate_new: patch.can_activate_new ?? current.can_activate_new,
    can_restore_expired: patch.can_restore_expired ?? current.can_restore_expired,
    can_renew_active: patch.can_renew_active ?? current.can_renew_active,
    can_extend_active: patch.can_extend_active ?? current.can_extend_active,
    requires_approval: patch.requires_approval ?? current.requires_approval,
  };
  await sql`insert into partial_payment_policies (
      tenant_id, enabled_default, default_min_pct, allow_customer_override, allow_service_override,
      min_pct, max_pct, can_activate_new, can_restore_expired, can_renew_active, can_extend_active,
      requires_approval, updated_at
    ) values (
      ${tenantId}, ${next.enabled_default}, ${next.default_min_pct}, ${next.allow_customer_override},
      ${next.allow_service_override}, ${next.min_pct}, ${next.max_pct}, ${next.can_activate_new},
      ${next.can_restore_expired}, ${next.can_renew_active}, ${next.can_extend_active},
      ${next.requires_approval}, now()
    )
    on conflict (tenant_id) do update set
      enabled_default = excluded.enabled_default,
      default_min_pct = excluded.default_min_pct,
      allow_customer_override = excluded.allow_customer_override,
      allow_service_override = excluded.allow_service_override,
      min_pct = excluded.min_pct,
      max_pct = excluded.max_pct,
      can_activate_new = excluded.can_activate_new,
      can_restore_expired = excluded.can_restore_expired,
      can_renew_active = excluded.can_renew_active,
      can_extend_active = excluded.can_extend_active,
      requires_approval = excluded.requires_approval,
      updated_at = now()`;
  await writeAudit(sql, tenantId, actorId ?? null, "partial_payment.policy.updated", "tenant", tenantId, JSON.stringify(next));
  return getPartialPolicy(sql, tenantId);
}

type CustomerPartialRow = {
  id: string;
  partial_enabled: boolean | null;
  partial_min_pct: number | null;
  partial_notes: string;
  partial_enabled_by: string | null;
  partial_enabled_at: string | null;
  partial_updated_at: string | null;
};

type ServicePartialRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: string;
  suspend_reason: string;
  activation_mode: string;
  period_end: string | null;
  account_number: string;
  name: string;
  deleted_at: string | null;
  partial_enabled: boolean | null;
  partial_min_pct: number | null;
  partial_method: string;
  last_partial_payment_id: string | null;
  last_partial_validity_ms: number;
  last_partial_pct: number;
  billing_interval: string;
  validity_hours: number;
  price_kes: number;
};

async function loadCustomerPartial(sql: Sql, tenantId: string, customerId: string) {
  const [row] = await sql<CustomerPartialRow>`
    select id, partial_enabled, partial_min_pct, coalesce(partial_notes,'') as partial_notes,
           partial_enabled_by, partial_enabled_at::text as partial_enabled_at,
           partial_updated_at::text as partial_updated_at
    from customers where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  return row ?? null;
}

async function loadServicePartial(sql: Sql, tenantId: string, serviceId: string) {
  const [row] = await sql<ServicePartialRow>`
    select s.id, s.tenant_id, s.customer_id, s.status, coalesce(s.suspend_reason,'') as suspend_reason,
           coalesce(s.activation_mode,'after_payment') as activation_mode,
           s.period_end::text as period_end, coalesce(s.account_number,'') as account_number,
           coalesce(nullif(s.name,''), p.name) as name, s.deleted_at::text as deleted_at,
           s.partial_enabled, s.partial_min_pct, coalesce(s.partial_method,'pro_rata') as partial_method,
           s.last_partial_payment_id, coalesce(s.last_partial_validity_ms,0)::bigint as last_partial_validity_ms,
           coalesce(s.last_partial_pct,0)::int as last_partial_pct,
           p.billing_interval, p.validity_hours, p.price_kes
    from services s join packages p on p.id = s.package_id
    where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  return row ?? null;
}

export async function effectivePartialForService(sql: Sql, tenantId: string, serviceId: string) {
  const policy = await getPartialPolicy(sql, tenantId);
  const svc = await loadServicePartial(sql, tenantId, serviceId);
  if (!svc) throw new Error("Service not found");
  assertTenantMatch(svc.tenant_id, tenantId);
  const cus = await loadCustomerPartial(sql, tenantId, svc.customer_id);
  const effective = resolveEffectivePartial({
    policy,
    customerEnabled: cus?.partial_enabled ?? null,
    customerMinPct: cus?.partial_min_pct ?? null,
    serviceEnabled: svc.partial_enabled,
    serviceMinPct: svc.partial_min_pct,
  });
  return { policy, svc, cus, effective };
}

export async function saveCustomerPartial(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    actorId: string;
    enabled?: boolean | null;
    minPct?: number | null;
    notes?: string;
  },
) {
  const policy = await getPartialPolicy(sql, opts.tenantId);
  if (!policy.allow_customer_override) throw new Error("Customer-level partial payment override is not allowed");
  const cus = await loadCustomerPartial(sql, opts.tenantId, opts.customerId);
  if (!cus) throw new Error("Customer not found");
  const enabled = opts.enabled === undefined ? cus.partial_enabled : opts.enabled;
  const minPct =
    opts.minPct === undefined
      ? cus.partial_min_pct
      : opts.minPct === null
        ? null
        : clampPct(opts.minPct, policy.min_pct, policy.max_pct);
  const notes = opts.notes === undefined ? cus.partial_notes : String(opts.notes || "").slice(0, 400);
  const turningOn = enabled === true && cus.partial_enabled !== true;
  await sql`update customers
    set partial_enabled = ${enabled},
        partial_min_pct = ${minPct},
        partial_notes = ${notes},
        partial_enabled_by = case when ${turningOn} then ${opts.actorId} else partial_enabled_by end,
        partial_enabled_at = case when ${turningOn} then now() else partial_enabled_at end,
        partial_updated_at = now()
    where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  await writeAudit(
    sql,
    opts.tenantId,
    opts.actorId,
    enabled === true ? "partial_payment.customer.enabled" : enabled === false ? "partial_payment.customer.disabled" : "partial_payment.customer.updated",
    "customer",
    opts.customerId,
    JSON.stringify({ enabled, min_pct: minPct }),
  );
  return loadCustomerPartial(sql, opts.tenantId, opts.customerId);
}

export async function saveServicePartial(
  sql: Sql,
  opts: {
    tenantId: string;
    serviceId: string;
    actorId: string;
    enabled?: boolean | null;
    minPct?: number | null;
  },
) {
  const policy = await getPartialPolicy(sql, opts.tenantId);
  if (!policy.allow_service_override) throw new Error("Service-level partial payment override is not allowed");
  const svc = await loadServicePartial(sql, opts.tenantId, opts.serviceId);
  if (!svc || svc.deleted_at) throw new Error("Service not found");
  assertTenantMatch(svc.tenant_id, opts.tenantId);
  const enabled = opts.enabled === undefined ? svc.partial_enabled : opts.enabled;
  const minPct =
    opts.minPct === undefined
      ? svc.partial_min_pct
      : opts.minPct === null
        ? null
        : clampPct(opts.minPct, policy.min_pct, policy.max_pct);
  await sql`update services
    set partial_enabled = ${enabled},
        partial_min_pct = ${minPct}
    where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  await writeAudit(
    sql,
    opts.tenantId,
    opts.actorId,
    enabled === true ? "partial_payment.service.enabled" : enabled === false ? "partial_payment.service.disabled" : "partial_payment.service.updated",
    "service",
    opts.serviceId,
    JSON.stringify({ enabled, min_pct: minPct }),
  );
  return loadServicePartial(sql, opts.tenantId, opts.serviceId);
}

async function openInvoiceForService(sql: Sql, tenantId: string, customerId: string, serviceId: string) {
  const [row] = await sql<{
    id: string;
    amount_kes: number;
    paid_kes: number;
    status: string;
    access_granted_ms: number;
    number: string;
  }>`select i.id, i.amount_kes, i.paid_kes, i.status, coalesce(i.access_granted_ms,0)::bigint as access_granted_ms, i.number
     from invoices i
     where i.tenant_id = ${tenantId} and i.customer_id = ${customerId}
       and i.status in ('issued','due','overdue','partial')
       and (
         i.service_id = ${serviceId}
         or exists (
           select 1 from invoice_items ii
           where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${serviceId}
         )
       )
     order by i.due_date, i.issued_at
     limit 1`;
  return row ?? null;
}

export async function describePartialDesk(
  sql: Sql,
  tenantId: string,
  opts: { customerId?: string; serviceId?: string },
) {
  const policy = await getPartialPolicy(sql, tenantId);
  if (opts.serviceId) {
    const { svc, cus, effective } = await effectivePartialForService(sql, tenantId, opts.serviceId);
    const invoice = await openInvoiceForService(sql, tenantId, svc.customer_id, svc.id);
    const period = periodMs(svc.billing_interval, svc.validity_hours);
    const hourly = (svc.validity_hours || 0) > 0;
    const full = invoice?.amount_kes || svc.price_kes;
    const paid = invoice?.paid_kes || 0;
    const preview = previewPartial({
      fullKes: full,
      paidBeforeKes: paid,
      thisKes: 0,
      minPct: effective.min_pct,
      periodMs: period,
      hourly,
      alreadyGrantedMs: invoice?.access_granted_ms || 0,
    });
    const events = await listPartialEvents(sql, tenantId, { serviceId: svc.id, limit: 20 });
    return {
      policy,
      effective,
      customer: cus,
      service: {
        id: svc.id,
        name: svc.name,
        account_number: svc.account_number,
        status: svc.status,
        suspend_reason: svc.suspend_reason,
        activation_mode: svc.activation_mode,
        period_end: svc.period_end,
        partial_enabled: svc.partial_enabled,
        partial_min_pct: svc.partial_min_pct,
        last_partial_payment_id: svc.last_partial_payment_id,
        last_partial_validity_ms: Number(svc.last_partial_validity_ms || 0),
        last_partial_pct: svc.last_partial_pct,
        price_kes: svc.price_kes,
        period_ms: period,
        hourly,
      },
      invoice: invoice
        ? {
            id: invoice.id,
            number: invoice.number,
            amount_kes: invoice.amount_kes,
            paid_kes: invoice.paid_kes,
            remaining_kes: remainingKes(invoice.amount_kes, invoice.paid_kes, invoice.status),
            status: invoice.status,
            access_granted_ms: Number(invoice.access_granted_ms || 0),
          }
        : null,
      preview,
      events,
    };
  }
  if (!opts.customerId) throw new Error("Customer or service is required");
  const cus = await loadCustomerPartial(sql, tenantId, opts.customerId);
  if (!cus) throw new Error("Customer not found");
  const effective = resolveEffectivePartial({
    policy,
    customerEnabled: cus.partial_enabled,
    customerMinPct: cus.partial_min_pct,
  });
  const events = await listPartialEvents(sql, tenantId, { customerId: opts.customerId, limit: 30 });
  return { policy, effective, customer: cus, service: null, invoice: null, preview: null, events };
}

export async function listPartialEvents(
  sql: Sql,
  tenantId: string,
  opts: { customerId?: string; serviceId?: string; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 80));
  if (opts.serviceId) {
    return sql<PartialPaymentEvent>`
      select id, tenant_id, customer_id, service_id, invoice_id, payment_id,
             service_account_number, amount_kes, full_amount_kes, paid_kes, required_pct, actual_pct,
             minimum_kes, qualifies, validity_ms, validity_days,
             previous_expiry::text as previous_expiry, new_expiry::text as new_expiry,
             reference, provider, outcome, approval_status, approved_by,
             approved_at::text as approved_at, blocked_reason, created_at::text as created_at
      from partial_payment_events
      where tenant_id = ${tenantId} and service_id = ${opts.serviceId}
      order by created_at desc
      limit ${limit}`;
  }
  if (opts.customerId) {
    return sql<PartialPaymentEvent>`
      select id, tenant_id, customer_id, service_id, invoice_id, payment_id,
             service_account_number, amount_kes, full_amount_kes, paid_kes, required_pct, actual_pct,
             minimum_kes, qualifies, validity_ms, validity_days,
             previous_expiry::text as previous_expiry, new_expiry::text as new_expiry,
             reference, provider, outcome, approval_status, approved_by,
             approved_at::text as approved_at, blocked_reason, created_at::text as created_at
      from partial_payment_events
      where tenant_id = ${tenantId} and customer_id = ${opts.customerId}
      order by created_at desc
      limit ${limit}`;
  }
  return sql<PartialPaymentEvent>`
    select id, tenant_id, customer_id, service_id, invoice_id, payment_id,
           service_account_number, amount_kes, full_amount_kes, paid_kes, required_pct, actual_pct,
           minimum_kes, qualifies, validity_ms, validity_days,
           previous_expiry::text as previous_expiry, new_expiry::text as new_expiry,
           reference, provider, outcome, approval_status, approved_by,
           approved_at::text as approved_at, blocked_reason, created_at::text as created_at
    from partial_payment_events
    where tenant_id = ${tenantId}
    order by created_at desc
    limit ${limit}`;
}

export async function listPartialReport(sql: Sql, tenantId: string) {
  const [counts] = await sql<{
    total: number;
    below_minimum: number;
    qualifies: number;
    activated: number;
    restored: number;
    pending_approval: number;
    revenue_kes: number;
    validity_days: number;
  }>`select
      count(*)::int as total,
      count(*) filter (where outcome = 'below_minimum')::int as below_minimum,
      count(*) filter (where qualifies)::int as qualifies,
      count(*) filter (where outcome = 'activated')::int as activated,
      count(*) filter (where outcome = 'restored')::int as restored,
      count(*) filter (where outcome = 'pending_approval')::int as pending_approval,
      coalesce(sum(amount_kes),0)::int as revenue_kes,
      coalesce(sum(validity_days) filter (where outcome in ('activated','restored','extended')),0)::int as validity_days
     from partial_payment_events where tenant_id = ${tenantId}`;
  const events = await listPartialEvents(sql, tenantId, { limit: 80 });
  const avgValidity =
    counts && counts.activated + counts.restored > 0
      ? Math.trunc(counts.validity_days / Math.max(1, counts.activated + counts.restored + events.filter((e) => e.outcome === "extended").length))
      : 0;
  return {
    counts: counts ?? {
      total: 0,
      below_minimum: 0,
      qualifies: 0,
      activated: 0,
      restored: 0,
      pending_approval: 0,
      revenue_kes: 0,
      validity_days: 0,
    },
    average_validity_days: avgValidity,
    events,
  };
}

function isUniqueViolation(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /duplicate|unique/i.test(e?.message || "");
}

async function notifyPartial(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    customerId: string;
    serviceId: string | null;
    paymentId: string;
    amountKes: number;
    invoiceNumber?: string;
    reference?: string;
    decision: PartialDecision;
    outcome: PartialOutcome;
    newExpiry: string | null;
  },
) {
  const { buildServiceNotifyVars, notifyQuietly } = await import("./notifications.ts");
  const vars = await buildServiceNotifyVars(sql, opts.tenantId, opts.ispName, {
    customerId: opts.customerId,
    serviceId: opts.serviceId,
    amountKes: opts.amountKes,
    invoiceNumber: opts.invoiceNumber,
    paymentReference: opts.reference,
  });
  const extra = {
    ...vars,
    amount_received: vars.amount_due || String(opts.amountKes),
    full_package_amount: String(opts.decision.full_kes.toLocaleString("en-KE")),
    payment_percentage: String(opts.decision.actual_pct),
    required_percentage: String(opts.decision.min_pct),
    minimum_payment_amount: String(opts.decision.min_kes.toLocaleString("en-KE")),
    remaining_activation_amount: String(
      (opts.outcome === "below_minimum" ? opts.decision.remaining_to_qualify_kes : opts.decision.remaining_kes).toLocaleString(
        "en-KE",
      ),
    ),
    validity_days: String(opts.decision.grant_days),
    service_expiry_date: opts.newExpiry || vars.service_expiry_date || "",
  };
  const payId = opts.paymentId;
  if (opts.outcome === "below_minimum") {
    await notifyQuietly(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.partial.below_minimum", payId, extra);
    return;
  }
  if (opts.outcome === "activated") {
    await notifyQuietly(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.partial.activated", `${payId}:act`, extra);
    await notifyQuietly(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.partial.remaining", `${payId}:bal`, extra);
    return;
  }
  if (opts.outcome === "restored") {
    await notifyQuietly(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.partial.restored", `${payId}:rst`, extra);
    await notifyQuietly(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.partial.remaining", `${payId}:bal`, extra);
    return;
  }
  if (opts.decision.qualifies) {
    await notifyQuietly(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.partial.received", payId, extra);
    if (opts.decision.remaining_kes > 0) {
      await notifyQuietly(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.partial.remaining", `${payId}:bal`, extra);
    }
  }
}

export type ApplyPaymentAccessResult = PartialDecision & {
  granted: boolean;
  held: boolean;
  previous_expiry: string | null;
  new_expiry: string | null;
  event_id: string | null;
};

export async function applyPaymentAccess(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    customerId: string;
    serviceId?: string;
    invoiceId?: string;
    paymentId: string;
    amountKes: number;
    paidKes: number;
    invoicePaid: boolean;
    reference?: string;
    provider?: string;
    invoiceNumber?: string;
    now?: Date;
  },
): Promise<ApplyPaymentAccessResult> {
  const now = opts.now ?? new Date();
  const empty: ApplyPaymentAccessResult = {
    ...previewPartial({ fullKes: 0, thisKes: 0, minPct: 50, periodMs: 0 }),
    enabled: false,
    blocked_reason: "no_service",
    outcome: "posted",
    action: "none",
    grant_ms: 0,
    granted: false,
    held: false,
    previous_expiry: null,
    new_expiry: null,
    event_id: null,
  };
  const serviceId = (opts.serviceId || "").trim();
  if (!serviceId) {
    if (opts.invoicePaid) {
      await restorePaidAccess(sql, opts.tenantId, opts.customerId);
    }
    return empty;
  }

  const existing = await sql<{ id: string; outcome: PartialOutcome; validity_ms: number; previous_expiry: string | null; new_expiry: string | null }>`
    select id, outcome, validity_ms, previous_expiry::text as previous_expiry, new_expiry::text as new_expiry
    from partial_payment_events
    where tenant_id = ${opts.tenantId} and payment_id = ${opts.paymentId}
    limit 1`;
  if (existing[0]) {
    return {
      ...empty,
      outcome: existing[0].outcome,
      grant_ms: Number(existing[0].validity_ms || 0),
      granted: ["activated", "restored", "extended"].includes(existing[0].outcome),
      previous_expiry: existing[0].previous_expiry,
      new_expiry: existing[0].new_expiry,
      event_id: existing[0].id,
    };
  }

  const loaded = await effectivePartialForService(sql, opts.tenantId, serviceId);
  const { svc, effective } = loaded;
  if (svc.customer_id !== opts.customerId) {
    return { ...empty, blocked_reason: "wrong_service", outcome: "blocked" };
  }
  const [inv] = opts.invoiceId
    ? await sql<{
        id: string;
        amount_kes: number;
        paid_kes: number;
        status: string;
        access_granted_ms: number;
        number: string;
      }>`select id, amount_kes, paid_kes, status, coalesce(access_granted_ms,0)::bigint as access_granted_ms, number
         from invoices where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`
    : [];
  const period = periodMs(svc.billing_interval, svc.validity_hours);
  const hourly = (svc.validity_hours || 0) > 0;
  const full = inv?.amount_kes || svc.price_kes;
  const paid = inv?.paid_kes ?? opts.paidKes;
  const already = Number(inv?.access_granted_ms || 0);
  const decision = decidePartialAccess({
    effective,
    fullKes: full,
    paidKes: paid,
    thisKes: opts.amountKes,
    invoicePaid: opts.invoicePaid,
    periodMs: period,
    hourly,
    alreadyGrantedMs: already,
    serviceStatus: svc.status,
    suspendReason: svc.suspend_reason,
    activationMode: svc.activation_mode,
    deleted: Boolean(svc.deleted_at),
    terminated: svc.status === "terminated",
  });

  let granted = false;
  let held = false;
  let newExpiry = svc.period_end;
  const previousExpiry = svc.period_end;

  if (decision.action === "activate" || decision.action === "restore" || decision.action === "extend") {
    if (decision.grant_ms > 0) {
      await grantPaidPeriod(sql, opts.tenantId, opts.customerId, now, serviceId, decision.grant_ms);
    }
    const restored = await restorePaidAccess(sql, opts.tenantId, opts.customerId, serviceId, {
      skipGrant: true,
      ignoreInvoiceId: opts.invoicePaid ? undefined : opts.invoiceId,
      now,
    });
    held = Boolean(restored.held);
    granted = !held && (restored.restored > 0 || svc.status === "active" || decision.action === "extend");
    if (held) {
      decision.action = "none";
      decision.outcome = "blocked";
      decision.blocked_reason = "other_overdue";
      granted = false;
    }
    const [live] = await sql<{ period_end: string | null; status: string }>`
      select period_end::text as period_end, status from services
      where id = ${serviceId} and tenant_id = ${opts.tenantId}`;
    newExpiry = live?.period_end || newExpiry;
    if (granted && (decision.action === "activate" || decision.action === "restore")) {
      const [radius] = await sql<{ enabled: boolean | null }>`
        select enabled from radius_accounts where service_id = ${serviceId} and tenant_id = ${opts.tenantId}`;
      if (live?.status !== "active" || radius?.enabled === false) {
        granted = false;
      }
    }
    if (inv && decision.grant_ms > 0) {
      const nextGranted = already + decision.grant_ms;
      await sql`update invoices set access_granted_ms = ${nextGranted}
        where id = ${inv.id} and tenant_id = ${opts.tenantId}`;
    }
    if (granted && !opts.invoicePaid) {
      await sql`update services
        set last_partial_payment_id = ${opts.paymentId},
            last_partial_validity_ms = ${decision.grant_ms},
            last_partial_pct = ${decision.actual_pct}
        where id = ${serviceId} and tenant_id = ${opts.tenantId}`;
    }
  }

  const outcome: PartialOutcome = opts.invoicePaid
    ? "posted"
    : granted
      ? decision.outcome
      : decision.outcome === "activated" || decision.outcome === "restored" || decision.outcome === "extended"
        ? "posted"
        : decision.outcome;

  if (opts.invoicePaid) {
    return {
      ...decision,
      outcome: "posted",
      granted,
      held,
      previous_expiry: previousExpiry,
      new_expiry: newExpiry,
      event_id: null,
    };
  }

  const eventId = nid("ppe");
  try {
    await sql`insert into partial_payment_events (
        id, tenant_id, customer_id, service_id, invoice_id, payment_id, service_account_number,
        amount_kes, full_amount_kes, paid_kes, required_pct, actual_pct, minimum_kes, qualifies,
        validity_ms, validity_days, previous_expiry, new_expiry, reference, provider, outcome,
        approval_status, blocked_reason
      ) values (
        ${eventId}, ${opts.tenantId}, ${opts.customerId}, ${serviceId}, ${opts.invoiceId || null},
        ${opts.paymentId}, ${svc.account_number},
        ${opts.amountKes}, ${full}, ${paid}, ${decision.min_pct}, ${decision.actual_pct}, ${decision.min_kes},
        ${decision.qualifies}, ${decision.grant_ms}, ${decision.grant_days},
        ${previousExpiry}, ${newExpiry}, ${opts.reference || ""}, ${opts.provider || ""}, ${outcome},
        ${decision.action === "approve" ? "pending" : "none"}, ${decision.blocked_reason}
      )`;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return applyPaymentAccess(sql, opts);
    }
    throw err;
  }

  await writeAudit(
    sql,
    opts.tenantId,
    "system",
    `partial_payment.${outcome}`,
    "payment",
    opts.paymentId,
    JSON.stringify({
      service_id: serviceId,
      invoice_id: opts.invoiceId || "",
      qualifies: decision.qualifies,
      validity_ms: decision.grant_ms,
      pct: decision.actual_pct,
      outcome,
    }),
  );

  if (!opts.invoicePaid) {
    try {
      await notifyPartial(sql, {
        tenantId: opts.tenantId,
        ispName: opts.ispName,
        customerId: opts.customerId,
        serviceId,
        paymentId: opts.paymentId,
        amountKes: opts.amountKes,
        invoiceNumber: opts.invoiceNumber || inv?.number,
        reference: opts.reference,
        decision: { ...decision, outcome },
        outcome,
        newExpiry,
      });
    } catch {
      /* failed SMS must not reverse payment */
    }
  }

  return {
    ...decision,
    outcome,
    granted,
    held,
    previous_expiry: previousExpiry,
    new_expiry: newExpiry,
    event_id: eventId,
  };
}

export async function approvePartialPayment(
  sql: Sql,
  opts: { tenantId: string; eventId: string; actorId: string; approve: boolean; ispName: string },
) {
  const [event] = await sql<PartialPaymentEvent>`
    select id, tenant_id, customer_id, service_id, invoice_id, payment_id,
           service_account_number, amount_kes, full_amount_kes, paid_kes, required_pct, actual_pct,
           minimum_kes, qualifies, validity_ms, validity_days,
           previous_expiry::text as previous_expiry, new_expiry::text as new_expiry,
           reference, provider, outcome, approval_status, approved_by,
           approved_at::text as approved_at, blocked_reason, created_at::text as created_at
    from partial_payment_events
    where id = ${opts.eventId} and tenant_id = ${opts.tenantId}`;
  if (!event) throw new Error("Partial payment not found");
  if (event.approval_status !== "pending") throw new Error("This payment is not awaiting approval");
  if (!opts.approve) {
    await sql`update partial_payment_events
      set approval_status = 'rejected', approved_by = ${opts.actorId}, approved_at = now(),
          outcome = 'posted', blocked_reason = 'rejected'
      where id = ${event.id} and tenant_id = ${opts.tenantId}`;
    await writeAudit(sql, opts.tenantId, opts.actorId, "partial_payment.rejected", "payment", event.payment_id, event.id);
    return { ...event, approval_status: "rejected" as const, outcome: "posted" as const };
  }
  if (!event.service_id) throw new Error("Service not found");
  const now = new Date();
  await grantPaidPeriod(sql, opts.tenantId, event.customer_id, now, event.service_id, Number(event.validity_ms || 0));
  const restored = await restorePaidAccess(sql, opts.tenantId, event.customer_id, event.service_id, {
    skipGrant: true,
    ignoreInvoiceId: event.invoice_id || undefined,
    now,
  });
  const [live] = await sql<{ period_end: string | null; status: string }>`
    select period_end::text as period_end, status from services
    where id = ${event.service_id} and tenant_id = ${opts.tenantId}`;
  const granted = !restored.held && live?.status === "active";
  const awaiting = (await loadServicePartial(sql, opts.tenantId, event.service_id))?.suspend_reason === "awaiting_payment";
  const outcome: PartialOutcome = granted ? (awaiting ? "activated" : restored.restored > 0 ? "restored" : "extended") : "posted";
  await sql`update partial_payment_events
    set approval_status = 'approved', approved_by = ${opts.actorId}, approved_at = now(),
        outcome = ${outcome}, new_expiry = ${live?.period_end || null}
    where id = ${event.id} and tenant_id = ${opts.tenantId}`;
  if (event.invoice_id && Number(event.validity_ms || 0) > 0) {
    await sql`update invoices
      set access_granted_ms = coalesce(access_granted_ms,0) + ${Number(event.validity_ms || 0)}
      where id = ${event.invoice_id} and tenant_id = ${opts.tenantId}`;
  }
  await writeAudit(sql, opts.tenantId, opts.actorId, "partial_payment.approved", "payment", event.payment_id, event.id);
  if (granted) {
    const { svc, effective } = await effectivePartialForService(sql, opts.tenantId, event.service_id);
    const decision = decidePartialAccess({
      effective,
      fullKes: event.full_amount_kes,
      paidKes: event.paid_kes,
      thisKes: event.amount_kes,
      invoicePaid: false,
      periodMs: periodMs(svc.billing_interval, svc.validity_hours),
      hourly: (svc.validity_hours || 0) > 0,
      alreadyGrantedMs: 0,
      serviceStatus: awaiting ? "pending" : svc.status,
      suspendReason: awaiting ? "awaiting_payment" : svc.suspend_reason,
      activationMode: svc.activation_mode,
    });
    try {
      await notifyPartial(sql, {
        tenantId: opts.tenantId,
        ispName: opts.ispName,
        customerId: event.customer_id,
        serviceId: event.service_id,
        paymentId: event.payment_id,
        amountKes: event.amount_kes,
        reference: event.reference,
        decision: { ...decision, outcome, grant_ms: Number(event.validity_ms || 0), grant_days: event.validity_days },
        outcome,
        newExpiry: live?.period_end || null,
      });
    } catch {
      /* SMS must not roll back approval */
    }
  }
  return { ...event, approval_status: "approved" as const, outcome, new_expiry: live?.period_end || event.new_expiry };
}

export async function previewPortalPartial(
  sql: Sql,
  tenantId: string,
  opts: { serviceId: string; customerId: string; amountKes?: number },
) {
  const { svc, effective } = await effectivePartialForService(sql, tenantId, opts.serviceId);
  if (svc.customer_id !== opts.customerId) throw new Error("Service not found");
  const invoice = await openInvoiceForService(sql, tenantId, opts.customerId, opts.serviceId);
  const period = periodMs(svc.billing_interval, svc.validity_hours);
  const hourly = (svc.validity_hours || 0) > 0;
  const full = invoice?.amount_kes || svc.price_kes;
  const paid = invoice?.paid_kes || 0;
  const remaining = remainingKes(full, paid, invoice?.status);
  const thisKes = Math.max(0, Math.min(remaining, Math.round(opts.amountKes ?? 0)));
  const decision = decidePartialAccess({
    effective,
    fullKes: full,
    paidKes: paid + (thisKes || 0),
    thisKes: thisKes || kesPercent(full, effective.min_pct),
    invoicePaid: remaining > 0 && thisKes >= remaining,
    periodMs: period,
    hourly,
    alreadyGrantedMs: Number(invoice?.access_granted_ms || 0),
    serviceStatus: svc.status,
    suspendReason: svc.suspend_reason,
    activationMode: svc.activation_mode,
    deleted: Boolean(svc.deleted_at),
  });
  const minEnter = portalMinKes(decision);
  return {
    available: effective.enabled,
    effective,
    invoice_id: invoice?.id || "",
    invoice_number: invoice?.number || "",
    full_kes: full,
    paid_kes: paid,
    remaining_kes: remaining,
    min_enter_kes: minEnter,
    period_end: svc.period_end,
    account_number: svc.account_number,
    service_name: svc.name,
    hourly,
    decision,
    expected_expiry: decision.grant_days
      ? nairobiDate(new Date(Date.now() + decision.grant_ms))
      : svc.period_end,
  };
}

export function assertPortalAmount(opts: { available: boolean; amountKes: number; remainingKes: number; minEnterKes: number }) {
  const amount = Math.round(opts.amountKes);
  if (amount < 1) throw new Error("Enter a payment amount");
  if (amount > opts.remainingKes) throw new Error("Amount is more than the remaining balance");
  if (opts.available && opts.minEnterKes > 0 && amount < opts.minEnterKes) {
    throw new Error("This payment is below the minimum required amount and will not activate or restore the service");
  }
  return amount;
}
