import { APP_NAME } from "../brand.ts";
import { nid } from "../utils.ts";
import { getPlan, listPlans, PLANS as SEEDED_PLANS, type PlanRecord } from "./plans";
import { stkAdapter } from "./providers";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** Seed catalog kept for tests and invoice amounts before a custom plan is saved. */
export const PLANS = SEEDED_PLANS;
export type PlanCode = string;

export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "grace",
  "suspended",
  "cancelled",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SaasInvoiceRow = {
  id: string;
  number: string;
  plan: string;
  amount_kes: number;
  status: string;
  due_date: string;
  issued_at: string;
  period_end: string | null;
};

export type PlanSnapshot = {
  id: string;
  plan: string;
  status: string;
  max_customers: number;
  max_routers: number;
  max_services: number;
  max_admins: number;
  monthly_kes: number;
  annual_kes: number;
  billing_cycle: string;
  period_end: string | null;
  pending_plan: string;
  pending_invoice_id: string;
  days_left: number;
  trial_expired: boolean;
  trial_ends_at: string | null;
  grace_until: string | null;
  cancelled_at: string | null;
  started_at: string | null;
  entitlements: Record<string, boolean>;
  support_level: string;
};

function daysLeft(periodEnd: string | null, now = new Date()) {
  if (!periodEnd) return 0;
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return 0;
  return Math.ceil((end.getTime() - now.getTime()) / 86400_000);
}

function parseEnt(raw: unknown): Record<string, boolean> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = Boolean(v);
    return out;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseEnt(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return {};
}

type SubRow = {
  id: string;
  plan: string;
  status: string;
  max_customers: number;
  max_routers: number;
  max_services: number;
  max_admins: number;
  monthly_kes: number;
  billing_cycle: string;
  period_end: string | null;
  pending_plan?: string;
  pending_invoice_id?: string;
  trial_ends_at?: string | null;
  grace_until?: string | null;
  cancelled_at?: string | null;
  started_at?: string | null;
  entitlements?: unknown;
  support_level?: string;
};

function asSnapshot(row: SubRow, annual = 0): PlanSnapshot {
  const left = daysLeft(row.period_end);
  return {
    id: row.id,
    plan: row.plan,
    status: row.status,
    max_customers: row.max_customers,
    max_routers: row.max_routers,
    max_services: row.max_services ?? 0,
    max_admins: row.max_admins ?? 0,
    monthly_kes: row.monthly_kes,
    annual_kes: annual,
    billing_cycle: row.billing_cycle || "monthly",
    period_end: row.period_end,
    pending_plan: row.pending_plan ?? "",
    pending_invoice_id: row.pending_invoice_id ?? "",
    days_left: Math.max(0, left),
    trial_expired: row.plan === "trial" && left < 0,
    trial_ends_at: row.trial_ends_at ?? null,
    grace_until: row.grace_until ?? null,
    cancelled_at: row.cancelled_at ?? null,
    started_at: row.started_at ?? null,
    entitlements: parseEnt(row.entitlements),
    support_level: row.support_level || "community",
  };
}

async function loadPlanOrThrow(sql: Sql, code: string): Promise<PlanRecord> {
  const plan = await getPlan(sql, code);
  if (!plan || plan.status === "archived") throw new Error("Unknown plan");
  return plan;
}

const SUB_SELECT = `id, plan, status, max_customers, max_routers, coalesce(max_services,0) as max_services,
  coalesce(max_admins,0) as max_admins, monthly_kes, coalesce(billing_cycle,'monthly') as billing_cycle,
  period_end::text as period_end, pending_plan, pending_invoice_id,
  trial_ends_at::text as trial_ends_at, grace_until::text as grace_until, cancelled_at::text as cancelled_at,
  started_at::text as started_at, entitlements, coalesce(support_level,'community') as support_level`;

export async function readSubscription(sql: Sql, tenantId: string) {
  const rows = await sql.query<SubRow>(
    `select ${SUB_SELECT} from tenant_subscriptions where tenant_id = $1`,
    [tenantId],
  );
  return rows[0] ?? null;
}

export async function ensureSubscription(sql: Sql, tenantId: string): Promise<PlanSnapshot> {
  const row = await readSubscription(sql, tenantId);
  if (row) {
    const catalog = await getPlan(sql, row.plan);
    return asSnapshot(row, catalog?.annual_kes ?? 0);
  }
  const spec = await loadPlanOrThrow(sql, "trial");
  const end = new Date(Date.now() + (spec.trial_days || 14) * 86400_000);
  const id = nid("sub");
  await sql.query(
    `insert into tenant_subscriptions (
       id, tenant_id, plan, status, max_customers, max_routers, max_services, max_admins,
       max_storage_gb, api_requests_per_day, monthly_kes, period_end, billing_cycle, support_level,
       entitlements, started_at, trial_ends_at
     ) values ($1,$2,'trial','trial',$3,$4,$5,$6,$7,$8,$9,$10,'monthly',$11,$12,now(),$10)`,
    [
      id,
      tenantId,
      spec.max_customers,
      spec.max_routers,
      spec.max_services,
      spec.max_admins,
      spec.max_storage_gb,
      spec.api_requests_per_day,
      spec.monthly_kes,
      end.toISOString(),
      spec.support_level,
      JSON.stringify(spec.entitlements),
    ],
  );
  return asSnapshot({
    id,
    plan: "trial",
    status: "trial",
    max_customers: spec.max_customers,
    max_routers: spec.max_routers,
    max_services: spec.max_services,
    max_admins: spec.max_admins,
    monthly_kes: spec.monthly_kes,
    billing_cycle: "monthly",
    period_end: end.toISOString(),
    pending_plan: "",
    pending_invoice_id: "",
    trial_ends_at: end.toISOString(),
    entitlements: spec.entitlements,
    support_level: spec.support_level,
    started_at: new Date().toISOString(),
  }, spec.annual_kes);
}

function periodEndFor(plan: PlanRecord, cycle: string) {
  const days =
    plan.code === "trial" || plan.monthly_kes === 0
      ? plan.trial_days || 14
      : cycle === "annual"
        ? 365
        : 30;
  return new Date(Date.now() + days * 86400_000);
}

export async function activatePlan(
  sql: Sql,
  tenantId: string,
  plan: PlanCode,
  cycle: "monthly" | "annual" = "monthly",
) {
  const spec = await loadPlanOrThrow(sql, plan);
  await ensureSubscription(sql, tenantId);
  const end = periodEndFor(spec, cycle);
  const status = spec.monthly_kes === 0 || spec.code === "trial" ? "trial" : "active";
  const trialEnd = status === "trial" ? end.toISOString() : null;
  await sql.query(
    `update tenant_subscriptions
     set plan = $2, status = $3, max_customers = $4, max_routers = $5, max_services = $6, max_admins = $7,
         max_storage_gb = $8, api_requests_per_day = $9, monthly_kes = $10, period_end = $11,
         pending_plan = '', pending_invoice_id = '', billing_cycle = $12, support_level = $13,
         entitlements = $14, cancelled_at = null, grace_until = null,
         trial_ends_at = $15, started_at = coalesce(started_at, now())
     where tenant_id = $1`,
    [
      tenantId,
      spec.code,
      status,
      spec.max_customers,
      spec.max_routers,
      spec.max_services,
      spec.max_admins,
      spec.max_storage_gb,
      spec.api_requests_per_day,
      spec.monthly_kes,
      end.toISOString(),
      cycle,
      spec.support_level,
      JSON.stringify(spec.entitlements),
      trialEnd,
    ],
  );
  if (status === "trial") {
    await sql`update tenants set status = 'trial', suspended_reason = '', suspended_at = null where id = ${tenantId}`;
  } else {
    await sql`update tenants set status = 'active', suspended_reason = '', suspended_at = null
      where id = ${tenantId}`;
  }
  return ensureSubscription(sql, tenantId);
}

/** Immediate activate — kept for tests and internal use. Operator UI uses requestPlanChange. */
export async function changePlan(sql: Sql, tenantId: string, plan: PlanCode) {
  return activatePlan(sql, tenantId, plan);
}

async function voidOpenSaasInvoice(sql: Sql, tenantId: string, invoiceId: string) {
  if (!invoiceId) return;
  await sql`update saas_invoices set status = 'void'
    where id = ${invoiceId} and tenant_id = ${tenantId} and status in ('issued','due','overdue')`;
}

async function issueSaasInvoice(sql: Sql, tenantId: string, plan: PlanCode, cycle: "monthly" | "annual" = "monthly") {
  const spec = await loadPlanOrThrow(sql, plan);
  const amount = cycle === "annual" ? spec.annual_kes || spec.monthly_kes * 12 : spec.monthly_kes;
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from saas_invoices where tenant_id = ${tenantId}`;
  const number = `SUB-${String(1000 + (n ?? 0) + 1)}`;
  const id = nid("sinv");
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const periodStart = new Date();
  const periodEnd = periodEndFor(spec, cycle);
  await sql`insert into saas_invoices
    (id, tenant_id, number, plan, amount_kes, status, due_date, period_start, period_end)
    values (
      ${id}, ${tenantId}, ${number}, ${plan}, ${amount}, 'issued', ${due.toISOString().slice(0, 10)},
      ${periodStart.toISOString()}, ${periodEnd.toISOString()}
    )`;
  return {
    id,
    number,
    plan,
    amount_kes: amount,
    status: "issued",
    due_date: due.toISOString().slice(0, 10),
    issued_at: new Date().toISOString(),
    period_end: periodEnd.toISOString(),
  } satisfies SaasInvoiceRow;
}

export async function listSaasInvoices(sql: Sql, tenantId: string) {
  return sql<SaasInvoiceRow>`
    select id, number, plan, amount_kes, status, due_date::text as due_date,
           issued_at::text as issued_at, period_end::text as period_end
    from saas_invoices where tenant_id = ${tenantId}
    order by issued_at desc`;
}

export async function requestPlanChange(sql: Sql, tenantId: string, plan: PlanCode) {
  const spec = await loadPlanOrThrow(sql, plan);
  const sub = await ensureSubscription(sql, tenantId);
  if (spec.monthly_kes === 0 || spec.code === "trial") {
    if (sub.pending_invoice_id) await voidOpenSaasInvoice(sql, tenantId, sub.pending_invoice_id);
    if (sub.plan === spec.code && !sub.pending_plan) {
      return { ...sub, invoice: null as SaasInvoiceRow | null, invoices: await listSaasInvoices(sql, tenantId) };
    }
    const next = await activatePlan(sql, tenantId, spec.code);
    return { ...next, invoice: null as SaasInvoiceRow | null, invoices: await listSaasInvoices(sql, tenantId) };
  }
  if (sub.plan === plan && sub.status === "active" && !sub.pending_plan) {
    return { ...sub, invoice: null as SaasInvoiceRow | null, invoices: await listSaasInvoices(sql, tenantId), unchanged: true };
  }
  if (sub.pending_plan === plan && sub.pending_invoice_id) {
    const [existing] = await sql<SaasInvoiceRow>`
      select id, number, plan, amount_kes, status, due_date::text as due_date,
             issued_at::text as issued_at, period_end::text as period_end
      from saas_invoices where id = ${sub.pending_invoice_id} and tenant_id = ${tenantId}
        and status in ('issued','due','overdue')`;
    if (existing) {
      return { ...sub, invoice: existing, invoices: await listSaasInvoices(sql, tenantId) };
    }
  }
  if (sub.pending_invoice_id) await voidOpenSaasInvoice(sql, tenantId, sub.pending_invoice_id);
  const invoice = await issueSaasInvoice(sql, tenantId, plan);
  await sql`update tenant_subscriptions
    set pending_plan = ${plan}, pending_invoice_id = ${invoice.id}
    where tenant_id = ${tenantId}`;
  const next = await ensureSubscription(sql, tenantId);
  return { ...next, invoice, invoices: await listSaasInvoices(sql, tenantId) };
}

export async function applySaasPayment(
  sql: Sql,
  opts: { tenantId: string; invoiceId: string; provider: string; reference: string; amountKes?: number },
) {
  const ref = opts.reference.trim();
  if (!ref) throw new Error("Payment reference is required");
  const [inv] = await sql<{
    id: string;
    plan: string;
    amount_kes: number;
    status: string;
    number: string;
  }>`select id, plan, amount_kes, status, number from saas_invoices
     where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
  if (!inv) throw new Error("Platform invoice not found");
  if (inv.status === "paid") throw new Error("Invoice already paid");
  if (inv.status === "void") throw new Error("Invoice was cancelled");
  const dup = await sql<{ id: string }>`select id from saas_payments where tenant_id = ${opts.tenantId} and reference = ${ref}`;
  if (dup[0]) throw new Error("Duplicate payment reference");
  const amount = Math.round(opts.amountKes ?? inv.amount_kes);
  if (amount !== inv.amount_kes) throw new Error("Platform invoices must be paid in full");
  const payId = nid("spay");
  await sql`insert into saas_payments (id, tenant_id, invoice_id, provider, amount_kes, reference, status)
    values (${payId}, ${opts.tenantId}, ${inv.id}, ${opts.provider || "mpesa"}, ${amount}, ${ref}, 'confirmed')`;
  await sql`update saas_invoices set status = 'paid', paid_at = now()
    where id = ${inv.id} and tenant_id = ${opts.tenantId}`;
  const next = await activatePlan(sql, opts.tenantId, inv.plan);
  return { id: payId, amount, plan: next.plan, status: next.status, period_end: next.period_end };
}

export async function createSaasStkIntent(
  sql: Sql,
  opts: { tenantId: string; invoiceId: string; provider: string },
) {
  const [inv] = await sql<{ id: string; amount_kes: number; status: string; number: string; plan: string }>`
    select id, amount_kes, status, number, plan from saas_invoices
    where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
  if (!inv) throw new Error("Platform invoice not found");
  if (inv.status === "paid") throw new Error("Invoice already paid");
  if (inv.status === "void") throw new Error("Invoice was cancelled");
  const [prov] = await sql<{ enabled: boolean }>`
    select enabled from payment_providers where tenant_id = ${opts.tenantId} and kind = ${opts.provider}`;
  if (prov && !prov.enabled) throw new Error("Provider disabled");
  const [ten] = await sql<{ name: string; slug: string; public_base_url: string; support_phone: string }>`
    select name, slug, public_base_url, support_phone from tenants where id = ${opts.tenantId}`;
  const phone = ten?.support_phone ?? "";
  if (!phone.replace(/\D/g, "")) throw new Error("Set a company phone in Settings → Company to receive the STK prompt");
  const origin = (ten?.public_base_url || "").replace(/\/$/, "");
  const callbackUrl = origin && ten?.slug ? `${origin}/api/webhooks/${opts.provider}/${ten.slug}` : "";
  let checkout = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let note = "queued";
  const adapter = stkAdapter(opts.provider);
  if (adapter) {
    const started = await adapter.start(sql, {
      tenantId: opts.tenantId,
      phone,
      amount: inv.amount_kes,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      firstName: ten?.name || APP_NAME,
      lastName: "Plan",
      callbackUrl,
    });
    if (started.checkout_id) checkout = started.checkout_id;
    note = started.note;
  }
  const id = nid("sint");
  await sql`insert into saas_payment_intents (id, tenant_id, invoice_id, provider, amount_kes, phone, checkout_id, status)
    values (${id}, ${opts.tenantId}, ${inv.id}, ${opts.provider}, ${inv.amount_kes}, ${phone}, ${checkout}, 'pending')`;
  return { id, checkout_id: checkout, phone, amount_kes: inv.amount_kes, note, invoice_number: inv.number };
}

export async function settleSaasStkIntent(
  sql: Sql,
  opts: { tenantId: string; ispName: string; checkoutId: string },
) {
  const [intent] = await sql<{
    id: string;
    invoice_id: string;
    provider: string;
    status: string;
    checkout_id: string;
    amount_kes: number;
  }>`select id, invoice_id, provider, status, checkout_id, amount_kes from saas_payment_intents
     where checkout_id = ${opts.checkoutId} and tenant_id = ${opts.tenantId}`;
  if (!intent) throw new Error("STK request not found");
  if (intent.status === "confirmed") throw new Error("Already confirmed");
  let reference = intent.checkout_id;
  const [prov] = await sql<{ sandbox: boolean }>`
    select sandbox from payment_providers where tenant_id = ${opts.tenantId} and kind = ${intent.provider}`;
  const simulated = intent.checkout_id.startsWith("ws_");
  if (simulated && prov && !prov.sandbox) {
    throw new Error("Cannot confirm a simulated STK on a live provider. Wait for the Daraja/Kopo Kopo callback.");
  }
  const adapter = stkAdapter(intent.provider);
  if (adapter && !simulated) {
    const q = await adapter.query(sql, { tenantId: opts.tenantId, checkoutId: intent.checkout_id });
    if (!q.ok) throw new Error(q.error || "STK not confirmed by provider");
    if (q.reference) reference = q.reference;
  } else if (simulated && !prov?.sandbox) {
    throw new Error("Cannot confirm a simulated STK on a live provider");
  }
  const pay = await applySaasPayment(sql, {
    tenantId: opts.tenantId,
    invoiceId: intent.invoice_id,
    provider: intent.provider,
    reference,
    amountKes: intent.amount_kes,
  });
  await sql`update saas_payment_intents set status = 'confirmed' where id = ${intent.id}`;
  return pay;
}

export async function loadPlanDesk(sql: Sql, tenantId: string) {
  const current = await ensureSubscription(sql, tenantId);
  const invoices = await listSaasInvoices(sql, tenantId);
  const pending = current.pending_invoice_id
    ? (invoices.find((i) => i.id === current.pending_invoice_id && i.status !== "paid" && i.status !== "void") ?? null)
    : null;
  const catalog = (await listPlans(sql, false)).map((p) => ({
    code: p.code,
    label: p.name,
    blurb: p.description,
    max_customers: p.max_customers,
    max_routers: p.max_routers,
    monthly_kes: p.monthly_kes,
    annual_kes: p.annual_kes,
    entitlements: p.entitlements,
  }));
  return {
    ...current,
    catalog,
    invoice: pending,
    invoices,
  };
}

export async function assertTenantOperable(sql: Sql, tenantId: string) {
  const [row] = await sql<{ status: string }>`select status from tenants where id = ${tenantId}`;
  if (row?.status === "suspended") {
    throw new Error(`This ISP is suspended. Contact ${APP_NAME} support.`);
  }
}

function quotaMessage(plan: string, kind: string, max: number) {
  return `Plan ${plan} allows ${max} ${kind}. Upgrade in Settings → Plan.`;
}

export async function assertCustomerQuota(sql: Sql, tenantId: string) {
  await assertTenantOperable(sql, tenantId);
  const sub = await ensureSubscription(sql, tenantId);
  const [n] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = ${tenantId}`;
  if (sub.max_customers > 0 && (n?.n ?? 0) >= sub.max_customers) {
    throw new Error(quotaMessage(sub.plan, "customers", sub.max_customers));
  }
}

export async function assertRouterQuota(sql: Sql, tenantId: string) {
  await assertTenantOperable(sql, tenantId);
  const sub = await ensureSubscription(sql, tenantId);
  const [n] = await sql<{ n: number }>`select count(*)::int as n from routers where tenant_id = ${tenantId}`;
  if (sub.max_routers > 0 && (n?.n ?? 0) >= sub.max_routers) {
    throw new Error(quotaMessage(sub.plan, "routers", sub.max_routers));
  }
}

export async function assertServiceQuota(sql: Sql, tenantId: string) {
  await assertTenantOperable(sql, tenantId);
  const sub = await ensureSubscription(sql, tenantId);
  if (sub.max_services <= 0) return;
  const [n] = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = ${tenantId}`;
  if ((n?.n ?? 0) >= sub.max_services) {
    throw new Error(quotaMessage(sub.plan, "services", sub.max_services));
  }
}

export async function assertAdminQuota(sql: Sql, tenantId: string) {
  const sub = await ensureSubscription(sql, tenantId);
  if (sub.max_admins <= 0) return;
  const [n] = await sql<{ n: number }>`select count(*)::int as n from tenant_members where tenant_id = ${tenantId}`;
  if ((n?.n ?? 0) >= sub.max_admins) {
    throw new Error(quotaMessage(sub.plan, "staff logins", sub.max_admins));
  }
}

export async function settingInt(sql: Sql, key: string, fallback: number) {
  const [row] = await sql<{ value: string }>`select value from platform_settings where key = ${key}`;
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : fallback;
}

/** Advance trial/active → grace → past_due → expired/suspended from dates. Does not delete data. */
export async function evaluateSubscription(sql: Sql, tenantId: string, now = new Date()) {
  const sub = await ensureSubscription(sql, tenantId);
  if (sub.status === "cancelled" || sub.cancelled_at) return ensureSubscription(sql, tenantId);
  const [ten] = await sql<{ status: string; suspended_reason: string }>`
    select status, suspended_reason from tenants where id = ${tenantId}`;
  if (ten?.status === "suspended" && ten.suspended_reason) {
    if (sub.status !== "suspended") {
      await sql`update tenant_subscriptions set status = 'suspended' where tenant_id = ${tenantId}`;
    }
    return ensureSubscription(sql, tenantId);
  }
  const end = sub.period_end ? new Date(sub.period_end) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() >= now.getTime()) {
    return sub;
  }
  const graceDays = await settingInt(sql, "grace_days", 3);
  const pastDueDays = await settingInt(sql, "past_due_days", 7);
  const overdueMs = now.getTime() - end.getTime();
  const graceMs = graceDays * 86400_000;
  const pastDueMs = pastDueDays * 86400_000;
  if (sub.plan === "trial" || sub.monthly_kes === 0) {
    await sql`update tenant_subscriptions set status = 'expired' where tenant_id = ${tenantId}`;
    await sql`update tenants set status = 'suspended', suspended_reason = 'trial expired', suspended_at = now()
      where id = ${tenantId} and status <> 'suspended'`;
    return ensureSubscription(sql, tenantId);
  }
  if (overdueMs <= graceMs) {
    const until = new Date(end.getTime() + graceMs).toISOString();
    await sql`update tenant_subscriptions set status = 'grace', grace_until = ${until} where tenant_id = ${tenantId}`;
    return ensureSubscription(sql, tenantId);
  }
  if (overdueMs <= graceMs + pastDueMs) {
    await sql`update tenant_subscriptions set status = 'past_due' where tenant_id = ${tenantId}`;
    return ensureSubscription(sql, tenantId);
  }
  await sql`update tenant_subscriptions set status = 'suspended' where tenant_id = ${tenantId}`;
  await sql`update tenants set status = 'suspended', suspended_reason = 'non-payment', suspended_at = now()
    where id = ${tenantId}`;
  return ensureSubscription(sql, tenantId);
}

export async function cancelSubscription(sql: Sql, tenantId: string) {
  await ensureSubscription(sql, tenantId);
  await sql`update tenant_subscriptions set status = 'cancelled', cancelled_at = now(), pending_plan = '', pending_invoice_id = ''
    where tenant_id = ${tenantId}`;
  return ensureSubscription(sql, tenantId);
}
