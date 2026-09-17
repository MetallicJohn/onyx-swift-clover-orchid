import { nid } from "../utils.ts";
import { provisionServiceAccess } from "./access.ts";
import { serviceBalance, serviceOpenInvoices } from "./ledger.ts";
import { assertTenantMatch } from "./rbac.ts";
import {
  accessLabel,
  creditState,
  isCreditBlockedReason,
  resolveEffectiveCredit,
  type CreditSnapshot,
  type CreditState,
  type EffectiveCredit,
} from "./business-credit-format.ts";

export {
  accessLabel,
  creditState,
  creditStateLabel,
  creditUtilization,
  availableCredit,
  isPackageTier,
  resolveEffectiveCredit,
  tierLabel,
} from "./business-credit-format.ts";
export type { CreditSnapshot, CreditState, EffectiveCredit, PackageTier } from "./business-credit-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type BusinessCreditAction =
  | "checked"
  | "warned"
  | "limited"
  | "suspended"
  | "restored"
  | "enabled"
  | "disabled"
  | "limit_changed"
  | "invoice_issued";

export type CreditEvalResult = {
  service_id: string;
  customer_id: string;
  effective: EffectiveCredit;
  snapshot: CreditSnapshot;
  status: string;
  suspend_reason: string;
  restored: boolean;
  suspended: boolean;
  warned: boolean;
};

type ServiceCreditRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: string;
  suspend_reason: string;
  period_end: string | null;
  deleted_at: string | null;
  last_credit_check_at: string | null;
  last_credit_warn_outstanding: number;
  business_credit_enabled: boolean | null;
  business_max_credit_kes: number | null;
  business_warning_kes: number | null;
  package_name: string;
  account_number: string;
  name: string;
  tier: string;
  package_credit_enabled: boolean;
  package_max_kes: number;
  package_warning_kes: number;
  package_disconnect: boolean;
  package_continuity: boolean;
  package_send_warning: boolean;
  package_days_limit: number;
  package_notes: string;
  customer_credit_enabled: boolean | null;
  customer_max_kes: number | null;
  customer_warning_kes: number | null;
};

function mapEffective(row: ServiceCreditRow): EffectiveCredit {
  return resolveEffectiveCredit({
    tier: row.tier,
    packageEnabled: row.package_credit_enabled,
    packageMaxKes: row.package_max_kes,
    packageWarningKes: row.package_warning_kes,
    packageDisconnect: row.package_disconnect,
    packageContinuity: row.package_continuity,
    packageSendWarning: row.package_send_warning,
    packageDaysLimit: row.package_days_limit,
    packageNotes: row.package_notes,
    customerEnabled: row.customer_credit_enabled,
    customerMaxKes: row.customer_max_kes,
    customerWarningKes: row.customer_warning_kes,
    serviceEnabled: row.business_credit_enabled,
    serviceMaxKes: row.business_max_credit_kes,
    serviceWarningKes: row.business_warning_kes,
  });
}

async function writeEvent(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    serviceId: string;
    action: BusinessCreditAction;
    outstanding: number;
    max: number;
    available: number;
    warning: number;
    previousStatus?: string;
    newStatus?: string;
    actorId?: string | null;
    invoiceId?: string | null;
    paymentId?: string | null;
    notes?: string;
  },
) {
  await sql`insert into business_credit_events
    (id, tenant_id, customer_id, service_id, invoice_id, payment_id, action, outstanding_kes, max_credit_kes,
     available_kes, warning_kes, previous_status, new_status, actor_id, notes)
    values (
      ${nid("bce")}, ${opts.tenantId}, ${opts.customerId}, ${opts.serviceId}, ${opts.invoiceId ?? null},
      ${opts.paymentId ?? null}, ${opts.action}, ${opts.outstanding}, ${opts.max}, ${opts.available},
      ${opts.warning}, ${opts.previousStatus ?? ""}, ${opts.newStatus ?? ""}, ${opts.actorId ?? null},
      ${opts.notes ?? ""}
    )`;
}

async function audit(
  sql: Sql,
  tenantId: string,
  userId: string | null,
  action: string,
  entityId: string,
  details = "",
) {
  try {
    await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
      values (${nid("aud")}, ${tenantId}, ${userId || "system"}, ${action}, ${"business_credit"}, ${entityId}, ${details})`;
  } catch {
    /* audit is best-effort */
  }
}

export async function outstandingCredit(sql: Sql, tenantId: string, serviceId: string) {
  return Math.max(0, await serviceBalance(sql, tenantId, serviceId));
}

export async function loadServiceCreditRow(sql: Sql, tenantId: string, serviceId: string) {
  const [row] = await sql<ServiceCreditRow>`
    select s.id, s.tenant_id, s.customer_id, s.status, coalesce(s.suspend_reason,'') as suspend_reason,
           s.period_end::text as period_end, s.deleted_at::text as deleted_at,
           s.last_credit_check_at::text as last_credit_check_at,
           coalesce(s.last_credit_warn_outstanding,0)::int as last_credit_warn_outstanding,
           s.business_credit_enabled, s.business_max_credit_kes, s.business_warning_kes,
           p.name as package_name, coalesce(s.account_number,'') as account_number,
           coalesce(nullif(s.name,''), p.name) as name,
           coalesce(p.tier,'residential') as tier,
           p.business_credit_enabled as package_credit_enabled,
           coalesce(p.max_credit_kes,0)::int as package_max_kes,
           coalesce(p.credit_warning_kes,0)::int as package_warning_kes,
           p.disconnect_when_credit_reached as package_disconnect,
           p.allow_service_continuity_after_expiry as package_continuity,
           p.send_credit_limit_warning as package_send_warning,
           coalesce(p.credit_days_limit,0)::int as package_days_limit,
           coalesce(p.credit_terms_notes,'') as package_notes,
           c.business_credit_enabled as customer_credit_enabled,
           c.business_max_credit_kes as customer_max_kes,
           c.business_warning_kes as customer_warning_kes
    from services s
    join packages p on p.id = s.package_id
    join customers c on c.id = s.customer_id
    where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  return row ?? null;
}

export async function describeServiceCredit(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  now = new Date(),
) {
  const row = await loadServiceCreditRow(sql, tenantId, serviceId);
  if (!row || row.deleted_at) return null;
  const outstanding = await outstandingCredit(sql, tenantId, serviceId);
  const effective = mapEffective(row);
  const expired = Boolean(row.period_end && Date.parse(row.period_end) <= now.getTime());
  const overdue = await serviceHasUnpaid(sql, tenantId, row.customer_id, row.id);
  const snapshot = creditState({
    effective,
    outstandingKes: outstanding,
    status: row.status,
    suspendReason: row.suspend_reason,
    expired,
    overdue,
  });
  return { row, outstanding, effective, snapshot, expired, overdue };
}

async function serviceHasUnpaid(sql: Sql, tenantId: string, customerId: string, serviceId: string) {
  const [row] = await sql<{ id: string }>`
    select i.id from invoices i
    where i.tenant_id = ${tenantId} and i.customer_id = ${customerId}
      and i.status in ('issued','due','overdue','partial')
      and i.amount_kes > i.paid_kes
      and (
        i.service_id = ${serviceId}
        or exists (
          select 1 from invoice_items ii
          where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${serviceId}
        )
      )
    limit 1`;
  return Boolean(row);
}

function daysPastPeriod(periodEnd: string | null, now: Date) {
  if (!periodEnd) return 0;
  const end = Date.parse(periodEnd);
  if (!Number.isFinite(end) || end >= now.getTime()) return 0;
  return Math.floor((now.getTime() - end) / 86400_000);
}

export async function creditCoversService(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  now = new Date(),
) {
  const desc = await describeServiceCredit(sql, tenantId, serviceId, now);
  if (!desc) return false;
  if (isCreditBlockedReason(desc.row.suspend_reason)) return false;
  if (desc.effective.days_limit > 0 && daysPastPeriod(desc.row.period_end, now) > desc.effective.days_limit) {
    return false;
  }
  return desc.snapshot.covers;
}

async function notifyCredit(
  sql: Sql,
  tenantId: string,
  ispName: string,
  customerId: string,
  event:
    | "invoice.created.business"
    | "invoice.overdue.business"
    | "credit.warning"
    | "credit.limit_reached"
    | "payment.received.business"
    | "service.restored.business",
  entityId: string,
  vars: Record<string, string>,
) {
  const { notifyQuietly, buildServiceNotifyVars } = await import("./notifications.ts");
  const built = await buildServiceNotifyVars(sql, tenantId, ispName, {
    customerId,
    serviceId: vars.service_id || null,
    amountKes: Number(String(vars.amount_kes || "0").replace(/[^\d]/g, "")) || undefined,
    invoiceNumber: vars.invoice_number,
    paymentReference: vars.payment_reference,
    dueDate: vars.due_date,
  });
  return notifyQuietly(sql, tenantId, ispName, customerId, event, entityId, {
    ...built,
    outstanding_balance: vars.outstanding_balance || "",
    maximum_credit_amount: vars.maximum_credit_amount || "",
    available_credit: vars.available_credit || "",
    current_period_amount: vars.current_period_amount || "",
    receipt_number: vars.receipt_number || vars.payment_reference || "",
    amount_received: vars.amount_received || "",
  });
}

function creditVars(row: ServiceCreditRow, snapshot: CreditSnapshot, effective: EffectiveCredit) {
  return {
    service_id: row.id,
    outstanding_balance: String(snapshot.outstanding_kes.toLocaleString("en-KE")),
    maximum_credit_amount: String(effective.max_kes.toLocaleString("en-KE")),
    available_credit: String(snapshot.available_kes.toLocaleString("en-KE")),
  };
}

export async function evaluateBusinessCredit(
  sql: Sql,
  opts: {
    tenantId: string;
    serviceId: string;
    ispName: string;
    actorId?: string | null;
    paymentId?: string | null;
    invoiceId?: string | null;
    now?: Date;
    notify?: boolean;
  },
): Promise<CreditEvalResult | null> {
  const now = opts.now ?? new Date();
  const desc = await describeServiceCredit(sql, opts.tenantId, opts.serviceId, now);
  if (!desc) return null;
  const { row, effective, snapshot } = desc;
  assertTenantMatch(row.tenant_id, opts.tenantId);
  if (row.status === "terminated") {
    return {
      service_id: row.id,
      customer_id: row.customer_id,
      effective,
      snapshot,
      status: row.status,
      suspend_reason: row.suspend_reason,
      restored: false,
      suspended: false,
      warned: false,
    };
  }

  await sql`update services set last_credit_check_at = ${now.toISOString()}
    where id = ${row.id} and tenant_id = ${opts.tenantId}`;

  const notify = opts.notify !== false;
  const vars = creditVars(row, snapshot, effective);
  let restored = false;
  let suspended = false;
  let warned = false;
  let status = row.status;
  let reason = row.suspend_reason;

  const daysOver = daysPastPeriod(row.period_end, now);
  const daysBlocked = effective.days_limit > 0 && daysOver > effective.days_limit;
  const blocked = isCreditBlockedReason(row.suspend_reason);

  if (effective.configured && !blocked && !daysBlocked && snapshot.at_limit && effective.disconnect_when_reached) {
    if (row.status !== "suspended" || row.suspend_reason !== "credit_limit") {
      await sql`update services
        set status = ${"suspended"}, suspend_reason = ${"credit_limit"}
        where id = ${row.id} and tenant_id = ${opts.tenantId} and status <> 'terminated'`;
      await provisionServiceAccess(sql, opts.tenantId, row.id);
      status = "suspended";
      reason = "credit_limit";
      suspended = true;
      await writeEvent(sql, {
        tenantId: opts.tenantId,
        customerId: row.customer_id,
        serviceId: row.id,
        action: "suspended",
        outstanding: snapshot.outstanding_kes,
        max: effective.max_kes,
        available: snapshot.available_kes,
        warning: effective.warning_kes,
        previousStatus: row.status,
        newStatus: "suspended",
        actorId: opts.actorId,
        paymentId: opts.paymentId,
        invoiceId: opts.invoiceId,
        notes: "credit_limit",
      });
      await audit(sql, opts.tenantId, opts.actorId ?? null, "business_credit.suspended", row.id, String(snapshot.outstanding_kes));
      if (notify) {
        await notifyCredit(
          sql,
          opts.tenantId,
          opts.ispName,
          row.customer_id,
          "credit.limit_reached",
          `${row.id}:limit:${effective.max_kes}:${snapshot.outstanding_kes}`,
          vars,
        );
      }
    }
  } else if (effective.configured && !blocked && !daysBlocked && snapshot.covers) {
    const nextReason = snapshot.outstanding_kes > 0 ? "business_credit" : "";
    if (
      row.status === "suspended" &&
      (row.suspend_reason === "credit_limit" ||
        row.suspend_reason === "time" ||
        row.suspend_reason === "invoice" ||
        row.suspend_reason === "business_credit")
    ) {
      await sql`update services
        set status = ${"active"}, suspend_reason = ${nextReason}
        where id = ${row.id} and tenant_id = ${opts.tenantId} and status in ('suspended','grace','pending')`;
      await provisionServiceAccess(sql, opts.tenantId, row.id);
      status = "active";
      reason = nextReason;
      restored = true;
      await writeEvent(sql, {
        tenantId: opts.tenantId,
        customerId: row.customer_id,
        serviceId: row.id,
        action: "restored",
        outstanding: snapshot.outstanding_kes,
        max: effective.max_kes,
        available: snapshot.available_kes,
        warning: effective.warning_kes,
        previousStatus: row.status,
        newStatus: "active",
        actorId: opts.actorId,
        paymentId: opts.paymentId,
        invoiceId: opts.invoiceId,
      });
      await audit(sql, opts.tenantId, opts.actorId ?? null, "business_credit.restored", row.id, String(snapshot.outstanding_kes));
    } else if (row.status === "active" || row.status === "grace") {
      if (
        row.status === "grace" ||
        (row.suspend_reason !== nextReason &&
          (row.suspend_reason === "" ||
            row.suspend_reason === "time" ||
            row.suspend_reason === "invoice" ||
            row.suspend_reason === "business_credit"))
      ) {
        await sql`update services
          set status = ${"active"}, suspend_reason = ${nextReason}
          where id = ${row.id} and tenant_id = ${opts.tenantId} and status in ('active','grace')`;
        if (row.status === "grace") await provisionServiceAccess(sql, opts.tenantId, row.id);
        status = "active";
        reason = nextReason;
      }
    }

    if (notify && snapshot.warning && row.last_credit_warn_outstanding < effective.warning_kes) {
      await notifyCredit(
        sql,
        opts.tenantId,
        opts.ispName,
        row.customer_id,
        "credit.warning",
        `${row.id}:warn:${effective.warning_kes}:${snapshot.outstanding_kes}`,
        vars,
      );
      await sql`update services
        set last_credit_warn_at = ${now.toISOString()}, last_credit_warn_outstanding = ${snapshot.outstanding_kes}
        where id = ${row.id} and tenant_id = ${opts.tenantId}`;
      warned = true;
      await writeEvent(sql, {
        tenantId: opts.tenantId,
        customerId: row.customer_id,
        serviceId: row.id,
        action: "warned",
        outstanding: snapshot.outstanding_kes,
        max: effective.max_kes,
        available: snapshot.available_kes,
        warning: effective.warning_kes,
        previousStatus: row.status,
        newStatus: status,
        actorId: opts.actorId,
      });
    }
    if (snapshot.outstanding_kes < effective.warning_kes && row.last_credit_warn_outstanding > 0) {
      await sql`update services set last_credit_warn_outstanding = 0
        where id = ${row.id} and tenant_id = ${opts.tenantId}`;
    }
  }

  const liveSnap = creditState({
    effective,
    outstandingKes: snapshot.outstanding_kes,
    status,
    suspendReason: reason,
    expired: desc.expired,
    overdue: desc.overdue,
  });

  return {
    service_id: row.id,
    customer_id: row.customer_id,
    effective,
    snapshot: liveSnap,
    status,
    suspend_reason: reason,
    restored,
    suspended,
    warned,
  };
}

export async function evaluateTenantBusinessCredit(sql: Sql, tenantId: string, ispName: string, now = new Date()) {
  const rows = await sql<{ id: string }>`
    select s.id from services s
    join packages p on p.id = s.package_id
    where s.tenant_id = ${tenantId} and s.deleted_at is null and s.status <> 'terminated'
      and (
        coalesce(p.tier,'residential') in ('business','enterprise')
        or s.business_credit_enabled = true
        or exists (
          select 1 from customers c
          where c.id = s.customer_id and c.tenant_id = s.tenant_id and c.business_credit_enabled = true
        )
      )`;
  let suspended = 0;
  let restored = 0;
  let warned = 0;
  for (const row of rows) {
    const result = await evaluateBusinessCredit(sql, {
      tenantId,
      serviceId: row.id,
      ispName,
      now,
    });
    if (result?.suspended) suspended += 1;
    if (result?.restored) restored += 1;
    if (result?.warned) warned += 1;
  }
  return { checked: rows.length, suspended, restored, warned };
}

export async function creditAllowsInvoiceStack(sql: Sql, tenantId: string, serviceId: string) {
  const desc = await describeServiceCredit(sql, tenantId, serviceId);
  return Boolean(desc?.snapshot.covers && desc.row.status !== "suspended");
}

export async function saveCustomerCredit(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    actorId: string;
    enabled?: boolean | null;
    maxKes?: number | null;
    warningKes?: number | null;
  },
) {
  const [cus] = await sql<{ id: string; tenant_id: string }>`
    select id, tenant_id from customers where id = ${opts.customerId} and tenant_id = ${opts.tenantId} and deleted_at is null`;
  if (!cus) throw new Error("Customer not found");
  assertTenantMatch(cus.tenant_id, opts.tenantId);
  if (opts.enabled !== undefined) {
    await sql`update customers set business_credit_enabled = ${opts.enabled}
      where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  }
  if (opts.maxKes !== undefined) {
    const maxKes = opts.maxKes == null ? null : Math.max(0, Math.round(opts.maxKes));
    await sql`update customers set business_max_credit_kes = ${maxKes}
      where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  }
  if (opts.warningKes !== undefined) {
    const warningKes = opts.warningKes == null ? null : Math.max(0, Math.round(opts.warningKes));
    await sql`update customers set business_warning_kes = ${warningKes}
      where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  }
  await audit(
    sql,
    opts.tenantId,
    opts.actorId,
    opts.enabled === false ? "business_credit.disabled" : opts.enabled === true ? "business_credit.enabled" : "business_credit.updated",
    opts.customerId,
    JSON.stringify({ max_kes: opts.maxKes, warning_kes: opts.warningKes }),
  );
  return { ok: true };
}

export async function saveServiceCredit(
  sql: Sql,
  opts: {
    tenantId: string;
    serviceId: string;
    actorId: string;
    enabled?: boolean | null;
    maxKes?: number | null;
    warningKes?: number | null;
  },
) {
  const row = await loadServiceCreditRow(sql, opts.tenantId, opts.serviceId);
  if (!row || row.deleted_at) throw new Error("Service not found");
  assertTenantMatch(row.tenant_id, opts.tenantId);
  if (opts.enabled === true && row.tier !== "business" && row.tier !== "enterprise") {
    throw new Error("Credit terms require a Business or Enterprise package");
  }
  if (opts.enabled !== undefined) {
    await sql`update services set business_credit_enabled = ${opts.enabled} where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  }
  if (opts.maxKes !== undefined) {
    const maxKes = opts.maxKes == null ? null : Math.max(0, Math.round(opts.maxKes));
    await sql`update services set business_max_credit_kes = ${maxKes} where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  }
  if (opts.warningKes !== undefined) {
    const warningKes = opts.warningKes == null ? null : Math.max(0, Math.round(opts.warningKes));
    await sql`update services set business_warning_kes = ${warningKes} where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  }
  const outstanding = await outstandingCredit(sql, opts.tenantId, row.id);
  const next = mapEffective({
    ...row,
    business_credit_enabled: opts.enabled !== undefined ? opts.enabled : row.business_credit_enabled,
    business_max_credit_kes: opts.maxKes !== undefined ? opts.maxKes : row.business_max_credit_kes,
    business_warning_kes: opts.warningKes !== undefined ? opts.warningKes : row.business_warning_kes,
  });
  await writeEvent(sql, {
    tenantId: opts.tenantId,
    customerId: row.customer_id,
    serviceId: row.id,
    action: opts.enabled === false ? "disabled" : opts.enabled === true ? "enabled" : "limit_changed",
    outstanding,
    max: next.max_kes,
    available: Math.max(0, next.max_kes - outstanding),
    warning: next.warning_kes,
    previousStatus: row.status,
    newStatus: row.status,
    actorId: opts.actorId,
  });
  await audit(sql, opts.tenantId, opts.actorId, "business_credit.service_updated", row.id, JSON.stringify({ enabled: opts.enabled, max_kes: opts.maxKes }));
  return { ok: true };
}

export async function staffSuspendCredit(
  sql: Sql,
  opts: { tenantId: string; serviceId: string; actorId: string; ispName: string },
) {
  const desc = await describeServiceCredit(sql, opts.tenantId, opts.serviceId);
  if (!desc) throw new Error("Service not found");
  assertTenantMatch(desc.row.tenant_id, opts.tenantId);
  if (desc.row.status === "terminated") throw new Error("Terminated services cannot be suspended");
  await sql`update services
    set status = ${"suspended"}, suspend_reason = ${"credit_limit"}
    where id = ${desc.row.id} and tenant_id = ${opts.tenantId} and status <> 'terminated'`;
  await provisionServiceAccess(sql, opts.tenantId, desc.row.id);
  await writeEvent(sql, {
    tenantId: opts.tenantId,
    customerId: desc.row.customer_id,
    serviceId: desc.row.id,
    action: "suspended",
    outstanding: desc.snapshot.outstanding_kes,
    max: desc.effective.max_kes,
    available: desc.snapshot.available_kes,
    warning: desc.effective.warning_kes,
    previousStatus: desc.row.status,
    newStatus: "suspended",
    actorId: opts.actorId,
    notes: "staff",
  });
  await audit(sql, opts.tenantId, opts.actorId, "business_credit.staff_suspended", desc.row.id, String(desc.snapshot.outstanding_kes));
  await notifyCredit(
    sql,
    opts.tenantId,
    opts.ispName,
    desc.row.customer_id,
    "credit.limit_reached",
    `${desc.row.id}:limit:staff:${Date.now()}`,
    creditVars(desc.row, desc.snapshot, desc.effective),
  );
  return { ok: true, status: "suspended" as const };
}

export async function staffRestoreCredit(
  sql: Sql,
  opts: { tenantId: string; serviceId: string; actorId: string; ispName: string; force?: boolean },
) {
  const desc = await describeServiceCredit(sql, opts.tenantId, opts.serviceId);
  if (!desc) throw new Error("Service not found");
  assertTenantMatch(desc.row.tenant_id, opts.tenantId);
  if (isCreditBlockedReason(desc.row.suspend_reason) && !opts.force) {
    throw new Error("This service was suspended for a security or staff reason");
  }
  if (!desc.snapshot.covers && !opts.force) {
    throw new Error("Outstanding is still at or above the credit limit");
  }
  const nextReason = desc.snapshot.outstanding_kes > 0 ? "business_credit" : "";
  await sql`update services
    set status = ${"active"}, suspend_reason = ${nextReason}
    where id = ${desc.row.id} and tenant_id = ${opts.tenantId} and status in ('suspended','grace','pending')`;
  await provisionServiceAccess(sql, opts.tenantId, desc.row.id);
  await writeEvent(sql, {
    tenantId: opts.tenantId,
    customerId: desc.row.customer_id,
    serviceId: desc.row.id,
    action: "restored",
    outstanding: desc.snapshot.outstanding_kes,
    max: desc.effective.max_kes,
    available: desc.snapshot.available_kes,
    warning: desc.effective.warning_kes,
    previousStatus: desc.row.status,
    newStatus: "active",
    actorId: opts.actorId,
    notes: opts.force ? "override" : "staff",
  });
  await audit(sql, opts.tenantId, opts.actorId, "business_credit.staff_restored", desc.row.id, String(desc.snapshot.outstanding_kes));
  const [live] = await sql<{ status: string; enabled: boolean | null }>`
    select s.status, ra.enabled
    from services s
    left join radius_accounts ra on ra.service_id = s.id and ra.tenant_id = s.tenant_id
    where s.id = ${desc.row.id} and s.tenant_id = ${opts.tenantId}`;
  if (live?.status === "active" && live.enabled !== false) {
    await notifyCredit(
      sql,
      opts.tenantId,
      opts.ispName,
      desc.row.customer_id,
      "service.restored.business",
      `${desc.row.id}:staff:${opts.actorId}`,
      creditVars(desc.row, desc.snapshot, desc.effective),
    );
  }
  return { ok: true, status: "active" as const, provisioned: live?.status === "active" && live.enabled !== false };
}

export async function describeCustomerCredit(sql: Sql, tenantId: string, customerId: string) {
  const services = await sql<{ id: string }>`
    select id from services where tenant_id = ${tenantId} and customer_id = ${customerId} and deleted_at is null
    order by created_at`;
  const desks = [];
  for (const s of services) {
    const desc = await describeServiceCredit(sql, tenantId, s.id);
    if (desc) desks.push(desc);
  }
  const [cus] = await sql<{
    business_credit_enabled: boolean | null;
    business_max_credit_kes: number | null;
    business_warning_kes: number | null;
  }>`select business_credit_enabled, business_max_credit_kes, business_warning_kes
     from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  return {
    customer: {
      enabled: cus?.business_credit_enabled ?? null,
      max_kes: cus?.business_max_credit_kes ?? null,
      warning_kes: cus?.business_warning_kes ?? null,
    },
    services: desks.map((d) => ({
      service_id: d.row.id,
      name: d.row.name,
      account_number: d.row.account_number,
      package_name: d.row.package_name,
      status: d.row.status,
      suspend_reason: d.row.suspend_reason,
      period_end: d.row.period_end,
      last_credit_check_at: d.row.last_credit_check_at,
      effective: d.effective,
      snapshot: d.snapshot,
      label: accessLabel(d.row.status, d.row.suspend_reason, d.snapshot),
    })),
  };
}

export async function describeCreditDesk(
  sql: Sql,
  tenantId: string,
  opts: { customerId?: string; serviceId?: string },
) {
  if (opts.serviceId) {
    const desc = await describeServiceCredit(sql, tenantId, opts.serviceId);
    if (!desc) throw new Error("Service not found");
    const events = await listCreditEvents(sql, tenantId, desc.row.id);
    const unpaid = await serviceOpenInvoices(sql, tenantId, desc.row.customer_id, desc.row.id);
    return {
      kind: "service" as const,
      customer: {
        enabled: desc.row.customer_credit_enabled,
        max_kes: desc.row.customer_max_kes,
        warning_kes: desc.row.customer_warning_kes,
      },
      service: {
        service_id: desc.row.id,
        name: desc.row.name,
        account_number: desc.row.account_number,
        package_name: desc.row.package_name,
        status: desc.row.status,
        suspend_reason: desc.row.suspend_reason,
        period_end: desc.row.period_end,
        last_credit_check_at: desc.row.last_credit_check_at,
        service_enabled: desc.row.business_credit_enabled,
        service_max_kes: desc.row.business_max_credit_kes,
        service_warning_kes: desc.row.business_warning_kes,
        package_max_kes: desc.row.package_max_kes,
        effective: desc.effective,
        snapshot: desc.snapshot,
        label: accessLabel(desc.row.status, desc.row.suspend_reason, desc.snapshot),
      },
      events,
      unpaid,
    };
  }
  if (!opts.customerId) throw new Error("customer_id or service_id required");
  const data = await describeCustomerCredit(sql, tenantId, opts.customerId);
  return { kind: "customer" as const, ...data, events: [], unpaid: [] };
}

export async function listCreditEvents(sql: Sql, tenantId: string, serviceId: string) {
  return sql<{
    id: string;
    action: string;
    outstanding_kes: number;
    max_credit_kes: number;
    available_kes: number;
    previous_status: string;
    new_status: string;
    notes: string;
    created_at: string;
  }>`select id, action, outstanding_kes, max_credit_kes, available_kes, previous_status, new_status, notes,
            created_at::text as created_at
     from business_credit_events
     where tenant_id = ${tenantId} and service_id = ${serviceId}
     order by created_at desc limit 40`;
}

export async function listBusinessCreditReport(sql: Sql, tenantId: string) {
  const rows = await sql<{
    id: string;
    customer_id: string;
    customer_name: string;
    account_number: string;
    name: string;
    package_name: string;
    status: string;
    suspend_reason: string;
    period_end: string | null;
    outstanding: number;
    max_kes: number;
    warning_kes: number;
    tier: string;
    enabled: boolean;
  }>`select s.id, s.customer_id, c.name as customer_name, coalesce(s.account_number,'') as account_number,
            coalesce(nullif(s.name,''), p.name) as name, p.name as package_name, s.status,
            coalesce(s.suspend_reason,'') as suspend_reason, s.period_end::text as period_end,
            coalesce((
              select coalesce(sum(greatest(0, i.amount_kes - i.paid_kes)),0)::int
              from invoices i
              where i.tenant_id = s.tenant_id and i.customer_id = s.customer_id
                and i.status in ('issued','due','overdue','partial')
                and (
                  i.service_id = s.id
                  or exists (
                    select 1 from invoice_items ii
                    where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = s.id
                  )
                )
            ),0)::int as outstanding,
            coalesce(s.business_max_credit_kes, c.business_max_credit_kes, p.max_credit_kes, 0)::int as max_kes,
            coalesce(s.business_warning_kes, c.business_warning_kes, p.credit_warning_kes, 0)::int as warning_kes,
            coalesce(p.tier,'residential') as tier,
            coalesce(s.business_credit_enabled, c.business_credit_enabled, p.business_credit_enabled, false) as enabled
     from services s
     join customers c on c.id = s.customer_id
     join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.deleted_at is null
       and coalesce(p.tier,'residential') in ('business','enterprise')
     order by c.name, s.created_at`;

  const onCredit = rows.filter((r) => r.enabled && r.status === "active" && r.outstanding > 0 && r.outstanding < r.max_kes);
  const approaching = rows.filter(
    (r) =>
      r.enabled &&
      r.max_kes > 0 &&
      r.warning_kes > 0 &&
      r.outstanding >= r.warning_kes &&
      r.outstanding < r.max_kes &&
      r.status !== "terminated",
  );
  const atLimit = rows.filter((r) => r.enabled && r.max_kes > 0 && r.outstanding >= r.max_kes);
  const suspended = rows.filter((r) => r.suspend_reason === "credit_limit");
  const receivables = rows.reduce((s, r) => s + Math.max(0, r.outstanding), 0);
  const pays = await sql<{ amount: number }>`
    select coalesce(sum(p.amount_kes),0)::int as amount from payments p
    join services s on s.id = p.service_id
    join packages pk on pk.id = s.package_id
    where p.tenant_id = ${tenantId} and p.status = 'confirmed'
      and coalesce(pk.tier,'residential') in ('business','enterprise')`;

  return {
    rows,
    onCredit,
    approaching,
    atLimit,
    suspended,
    counts: {
      services: rows.length,
      on_credit: onCredit.length,
      approaching: approaching.length,
      at_limit: atLimit.length,
      suspended: suspended.length,
      receivables,
      payments: pays[0]?.amount ?? 0,
    },
  };
}

export async function notifyBusinessInvoice(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    customerId: string;
    serviceId: string;
    invoiceId: string;
    invoiceNumber: string;
    amountKes: number;
    dueDate: string;
  },
) {
  const desc = await describeServiceCredit(sql, opts.tenantId, opts.serviceId);
  if (!desc?.effective.enabled) return false;
  const outstanding = desc.snapshot.outstanding_kes;
  await notifyCredit(sql, opts.tenantId, opts.ispName, opts.customerId, "invoice.created.business", opts.invoiceId, {
    service_id: opts.serviceId,
    invoice_number: opts.invoiceNumber,
    current_period_amount: String(opts.amountKes.toLocaleString("en-KE")),
    outstanding_balance: String(outstanding.toLocaleString("en-KE")),
    maximum_credit_amount: String(desc.effective.max_kes.toLocaleString("en-KE")),
    available_credit: String(desc.snapshot.available_kes.toLocaleString("en-KE")),
    due_date: opts.dueDate,
    amount_kes: String(opts.amountKes),
  });
  return true;
}

export async function notifyBusinessOverdue(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    customerId: string;
    serviceId: string;
    invoiceId: string;
    invoiceNumber: string;
    amountKes: number;
    dueDate: string;
  },
) {
  const desc = await describeServiceCredit(sql, opts.tenantId, opts.serviceId);
  if (!desc?.effective.configured) return false;
  await notifyCredit(sql, opts.tenantId, opts.ispName, opts.customerId, "invoice.overdue.business", opts.invoiceId, {
    service_id: opts.serviceId,
    invoice_number: opts.invoiceNumber,
    outstanding_balance: String(desc.snapshot.outstanding_kes.toLocaleString("en-KE")),
    maximum_credit_amount: String(desc.effective.max_kes.toLocaleString("en-KE")),
    available_credit: String(desc.snapshot.available_kes.toLocaleString("en-KE")),
    due_date: opts.dueDate,
    amount_kes: String(opts.amountKes),
  });
  return true;
}

export async function notifyBusinessPayment(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    customerId: string;
    serviceId: string;
    paymentId: string;
    amountKes: number;
    reference: string;
    restored: boolean;
    provisioned: boolean;
  },
) {
  const desc = await describeServiceCredit(sql, opts.tenantId, opts.serviceId);
  if (
    !desc?.effective.enabled &&
    !desc?.snapshot.at_limit &&
    desc?.row.suspend_reason !== "credit_limit" &&
    desc?.row.suspend_reason !== "business_credit"
  ) {
    return false;
  }
  const vars = {
    service_id: opts.serviceId,
    amount_received: String(opts.amountKes.toLocaleString("en-KE")),
    outstanding_balance: String((desc?.snapshot.outstanding_kes ?? 0).toLocaleString("en-KE")),
    available_credit: String((desc?.snapshot.available_kes ?? 0).toLocaleString("en-KE")),
    maximum_credit_amount: String((desc?.effective.max_kes ?? 0).toLocaleString("en-KE")),
    receipt_number: opts.reference,
    payment_reference: opts.reference,
    amount_kes: String(opts.amountKes),
  };
  await notifyCredit(sql, opts.tenantId, opts.ispName, opts.customerId, "payment.received.business", opts.paymentId, vars);
  if (opts.restored && opts.provisioned) {
    await notifyCredit(sql, opts.tenantId, opts.ispName, opts.customerId, "service.restored.business", `${opts.serviceId}:${opts.paymentId}:biz`, vars);
  }
  return true;
}
