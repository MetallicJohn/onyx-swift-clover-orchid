import { remainingKes, invoiceBelongsToService } from "./billing.ts";
import { periodMs } from "./access-policy.ts";
import { getPartialPolicy } from "./partial-payment.ts";
import { kesPercent, resolveEffectivePartial } from "./partial-payment-format.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { DEFAULT_DATE_FORMAT, normalizeDateFormat } from "./display.ts";
import {
  PORTAL_TICKET_CATEGORIES,
  type PortalCustomer,
  type PortalDashboard,
  type PortalHome,
  type PortalInvoice,
  type PortalPayment,
  type PortalPaymentMethod,
  type PortalPaymentPage,
  type PortalService,
  type PortalStkPoll,
  type PortalStkStart,
  type PortalTicket,
} from "./customer-portal-dto.ts";
import {
  accountStatusFrom,
  billingPeriodLabel,
  customerSafeText,
  daysRemaining,
  deriveServiceStatus,
  invoiceStatusFrom,
  invoiceStatusLabel,
  maskReference,
  nextPeriodLabel,
  paymentMethodLabel,
  paymentStatusFrom,
  paymentStatusLabel,
  portalServiceRef,
  serviceStatusLabel,
  ticketCategoryLabel,
  ticketStatusLabel,
} from "./customer-portal-format.ts";
import type { InvoiceDocument, StatementDocument } from "./document-format.ts";
import { loadInvoiceDocument, loadStatementDocument } from "./documents.ts";
import { customerGraceEligibility, customerSelfGrant } from "./grace.ts";
import { listCustomerInbox } from "./inbox.ts";
import { renderInvoicePdf } from "./pdf/invoice.ts";
import { renderStatementPdf } from "./pdf/statement.ts";
import { createStkIntent, settleStkIntent } from "./payments.ts";
import { type portalContext } from "./portal.ts";
import { openTicket, commentTicket } from "./tickets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type PortalCtx = Awaited<ReturnType<typeof portalContext>>;

function presentCustomer(ctx: PortalCtx): PortalCustomer {
  return {
    id: ctx.customer.id,
    name: ctx.customer.name,
    phone: ctx.customer.phone,
    email: ctx.customer.email,
    address: ctx.customer.address || "",
    account_status: accountStatusFrom(ctx.customer.status),
    using_initial_password: Boolean(ctx.customer.portal_password_is_initial),
  };
}

function presentIsp(ctx: PortalCtx) {
  return {
    name: ctx.isp.name,
    slug: ctx.isp.slug,
    support_phone: ctx.isp.support_phone || "",
    support_email: ctx.isp.support_email || "",
    date_format: normalizeDateFormat(ctx.isp.date_format || DEFAULT_DATE_FORMAT),
  };
}

function asDate(iso: string | null) {
  if (!iso) return null;
  return nairobiDate(iso) || iso.slice(0, 10);
}

function fileSafe(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "document";
}

export function sanitizeInvoiceForPortal(doc: InvoiceDocument): InvoiceDocument {
  return {
    ...doc,
    invoice: { ...doc.invoice, notes: customerSafeText(doc.invoice.notes, "") },
    lines: doc.lines.map((line) => {
      const pkg = customerSafeText(line.packageName, "Internet service");
      return {
        ...line,
        packageName: pkg,
        description: customerSafeText(line.description, pkg),
      };
    }),
    payments: doc.payments.map((p) => ({
      ...p,
      provider: paymentMethodLabel(p.provider),
      reference: maskReference(p.reference),
    })),
  };
}

export function sanitizeStatementForPortal(doc: StatementDocument): StatementDocument {
  return {
    ...doc,
    rows: doc.rows.map((row) => ({
      ...row,
      reference: maskReference(row.reference),
      description: customerSafeText(
        row.description,
        row.kind === "payment" ? "Payment" : row.kind === "invoice" ? "Invoice" : "Account entry",
      ),
    })),
  };
}

export async function loadPortalServices(sql: Sql, ctx: PortalCtx): Promise<PortalService[]> {
  const rows = await sql<{
    id: string;
    name: string;
    account_number: string;
    package_name: string;
    price_kes: number;
    billing_interval: string;
    access_method: string;
    location: string;
    status: string;
    period_end: string | null;
    access_until: string | null;
    grace_expires_at: string | null;
    validity_hours: number;
    partial_enabled: boolean | null;
    partial_min_pct: number | null;
    customer_partial_enabled: boolean | null;
    customer_partial_min_pct: number | null;
  }>`
    select s.id, coalesce(nullif(s.name,''), p.name) as name, coalesce(s.account_number,'') as account_number,
           p.name as package_name, p.price_kes, p.billing_interval, s.access_method,
           coalesce(c.address,'') as location, s.status,
           s.period_end::text as period_end, s.access_until::text as access_until,
           g.expires_at::text as grace_expires_at,
           p.validity_hours,
           s.partial_enabled, s.partial_min_pct,
           c.partial_enabled as customer_partial_enabled, c.partial_min_pct as customer_partial_min_pct
    from services s
    join packages p on p.id = s.package_id
    join customers c on c.id = s.customer_id
    left join service_grace_periods g
      on g.service_id = s.id and g.tenant_id = s.tenant_id and g.status = 'active'
    where s.tenant_id = ${ctx.tenantId} and s.customer_id = ${ctx.customer.id} and s.deleted_at is null
    order by s.created_at desc`;

  const balances = await sql<{ invoice_id: string; service_id: string; balance: number; inv_status: string }>`
    select i.id as invoice_id,
           coalesce(nullif(i.service_id,''), ii.service_id) as service_id,
           greatest(0, i.amount_kes - i.paid_kes)::int as balance,
           i.status as inv_status
    from invoices i
    left join lateral (
      select service_id from invoice_items
      where invoice_id = i.id and tenant_id = i.tenant_id
        and service_id is not null and service_id <> ''
      limit 1
    ) ii on true
    where i.tenant_id = ${ctx.tenantId} and i.customer_id = ${ctx.customer.id}
      and i.status in ('issued','due','overdue','partial')`;

  const byService = new Map<string, { balance: number; status: string }>();
  const seenInv = new Set<string>();
  for (const b of balances) {
    if (!b.service_id || seenInv.has(b.invoice_id)) continue;
    seenInv.add(b.invoice_id);
    const cur = byService.get(b.service_id) ?? { balance: 0, status: b.inv_status };
    cur.balance += b.balance;
    if (b.inv_status === "overdue") cur.status = "overdue";
    else if (cur.status !== "overdue" && b.inv_status === "partial") cur.status = "partial";
    byService.set(b.service_id, cur);
  }

  const policy = await getPartialPolicy(sql, ctx.tenantId);
  const out: PortalService[] = [];
  for (const row of rows) {
    const status = deriveServiceStatus({
      status: row.status,
      period_end: row.period_end,
      grace_expires_at: row.grace_expires_at,
    });
    const billed = byService.get(row.id);
    const outstanding = billed?.balance ?? 0;
    const payStatus = paymentStatusFrom(outstanding, billed?.status ?? (outstanding > 0 ? "due" : null));
    const expiry = row.access_until || row.grace_expires_at || row.period_end;
    let elig: { ok: boolean; reason?: string; allowed_days: number[] } = { ok: false, allowed_days: [] };
    try {
      elig = await customerGraceEligibility(sql, ctx.tenantId, ctx.customer.id, row.id);
    } catch {
      elig = { ok: false, allowed_days: [] };
    }
    const period = periodMs(row.billing_interval, row.validity_hours);
    const effective = resolveEffectivePartial({
      policy,
      customerEnabled: row.customer_partial_enabled,
      customerMinPct: row.customer_partial_min_pct,
      serviceEnabled: row.partial_enabled,
      serviceMinPct: row.partial_min_pct,
    });
    const full = row.price_kes > 0 ? row.price_kes : outstanding;
    const paidOnOpen = Math.max(0, full - outstanding);
    out.push({
      id: row.id,
      reference: row.account_number || portalServiceRef(row.id),
      account_number: row.account_number,
      name: row.name,
      package_name: row.package_name,
      package_price_kes: row.price_kes,
      access_type: row.access_method === "hotspot" ? "Hotspot" : row.access_method === "static" ? "Dedicated" : "Broadband",
      location: row.location,
      billing_period: billingPeriodLabel(row.billing_interval),
      renewal_date: asDate(row.period_end),
      expiry_date: asDate(expiry),
      days_remaining: daysRemaining(expiry),
      next_billing_period: nextPeriodLabel(row.period_end, row.billing_interval, ctx.isp.date_format),
      status,
      status_label: serviceStatusLabel(status),
      payment_status: payStatus,
      payment_status_label: paymentStatusLabel(payStatus),
      outstanding_kes: outstanding,
      grace_until: asDate(row.grace_expires_at),
      can_request_grace: Boolean(elig.ok),
      grace_reason: elig.ok ? null : elig.reason || null,
      allowed_grace_days: elig.ok ? elig.allowed_days : [],
      partial_available: effective.enabled && outstanding > 0,
      partial_min_pct: effective.min_pct,
      partial_min_kes: kesPercent(full, effective.min_pct),
      partial_full_kes: full,
      partial_paid_kes: paidOnOpen,
      partial_period_ms: period,
      partial_hourly: (row.validity_hours || 0) > 0,
    });
    try {
      const { describeServiceCredit, accessLabel } = await import("./business-credit.ts");
      const desc = await describeServiceCredit(sql, ctx.tenantId, row.id);
      if (desc?.effective.enabled) {
        const last = out[out.length - 1];
        if (last) {
          last.tier = desc.effective.tier;
          last.credit_enabled = desc.effective.configured;
          last.credit_max_kes = desc.effective.max_kes;
          last.credit_available_kes = desc.snapshot.available_kes;
          last.credit_outstanding_kes = desc.snapshot.outstanding_kes;
          last.credit_utilization_pct = desc.snapshot.utilization_pct;
          last.credit_warning = desc.snapshot.warning || desc.snapshot.at_limit;
          last.credit_label = accessLabel(desc.row.status, desc.row.suspend_reason, desc.snapshot);
          if (desc.effective.configured) last.status_label = last.credit_label;
        }
      }
    } catch {
      /* credit display is optional */
    }
  }
  return out;
}

export async function loadPortalInvoices(sql: Sql, ctx: PortalCtx): Promise<PortalInvoice[]> {
  const rows = await sql<{
    id: string;
    number: string;
    service_id: string | null;
    amount_kes: number;
    paid_kes: number;
    status: string;
    due_date: string;
    issued_at: string;
  }>`select i.id, i.number, i.service_id, i.amount_kes, i.paid_kes, i.status, i.due_date::text as due_date, i.issued_at::text as issued_at
     from invoices i
     where i.tenant_id = ${ctx.tenantId} and i.customer_id = ${ctx.customer.id}
     order by i.issued_at desc`;

  const items = await sql<{ invoice_id: string; description: string; package_id: string | null; service_id: string | null }>`
    select ii.invoice_id, ii.description, ii.package_id, ii.service_id
    from invoice_items ii
    join invoices i on i.id = ii.invoice_id and i.tenant_id = ii.tenant_id
    where i.tenant_id = ${ctx.tenantId} and i.customer_id = ${ctx.customer.id}`;
  const pkgIds = [...new Set(items.map((i) => i.package_id).filter(Boolean))] as string[];
  const pkgs = pkgIds.length
    ? await sql<{ id: string; name: string; billing_interval: string }>`
        select id, name, billing_interval from packages where tenant_id = ${ctx.tenantId}`
    : [];
  const pkgBy = new Map(pkgs.map((p) => [p.id, p]));
  const firstItem = new Map<string, (typeof items)[number]>();
  for (const it of items) if (!firstItem.has(it.invoice_id)) firstItem.set(it.invoice_id, it);
  const svcIds = [
    ...new Set(
      [...rows.map((r) => r.service_id), ...items.map((i) => i.service_id)].filter(Boolean) as string[],
    ),
  ];
  const svcs = svcIds.length
    ? await sql<{ id: string; account_number: string; name: string }>`
        select s.id, coalesce(s.account_number,'') as account_number, coalesce(nullif(s.name,''), p.name) as name
        from services s join packages p on p.id = s.package_id
        where s.tenant_id = ${ctx.tenantId}`
    : [];
  const svcBy = new Map(svcs.map((s) => [s.id, s]));

  return rows.map((row) => {
    const remaining = remainingKes(row.amount_kes, row.paid_kes, row.status);
    const status = invoiceStatusFrom(row.status, remaining);
    const item = firstItem.get(row.id);
    const pkg = item?.package_id ? pkgBy.get(item.package_id) : undefined;
    const sid = row.service_id || item?.service_id || "";
    const svc = sid ? svcBy.get(sid) : undefined;
    return {
      id: row.id,
      number: row.number,
      service_id: sid || null,
      service_name: svc?.name || pkg?.name || customerSafeText(item?.description || "", "Internet service"),
      account_number: svc?.account_number || "",
      issued_at: asDate(row.issued_at) || row.issued_at.slice(0, 10),
      due_date: row.due_date,
      billing_period: billingPeriodLabel(pkg?.billing_interval || "monthly"),
      package_name: pkg?.name || customerSafeText(item?.description || "", "Internet service"),
      amount_kes: row.amount_kes,
      paid_kes: row.paid_kes,
      balance_kes: remaining,
      status,
      status_label: invoiceStatusLabel(status),
    };
  });
}

export async function loadPortalPayments(
  sql: Sql,
  ctx: PortalCtx,
  opts?: { q?: string; status?: string; from?: string; to?: string; page?: number; page_size?: number },
): Promise<PortalPaymentPage> {
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(50, Math.max(10, opts?.page_size ?? 20));
  const q = (opts?.q || "").trim().toLowerCase();
  const rows = await sql<{
    id: string;
    paid_at: string;
    amount_kes: number;
    provider: string;
    reference: string;
    status: string;
    invoice_number: string | null;
    service_name: string | null;
  }>`
    select p.id, p.paid_at::text as paid_at, p.amount_kes, p.provider, p.reference, p.status,
           i.number as invoice_number,
           (
             select pk.name from invoice_items ii
             join packages pk on pk.id = ii.package_id and pk.tenant_id = ii.tenant_id
             where ii.invoice_id = p.invoice_id and ii.tenant_id = p.tenant_id
             limit 1
           ) as service_name
    from payments p
    left join invoices i on i.id = p.invoice_id and i.tenant_id = p.tenant_id
    where p.tenant_id = ${ctx.tenantId} and p.customer_id = ${ctx.customer.id}
    order by p.paid_at desc`;

  const filtered = rows.filter((r) => {
    if (opts?.status && r.status !== opts.status) return false;
    if (opts?.from && r.paid_at.slice(0, 10) < opts.from) return false;
    if (opts?.to && r.paid_at.slice(0, 10) > opts.to) return false;
    if (q) {
      const hay = `${r.invoice_number || ""} ${r.provider} ${r.service_name || ""} ${r.reference}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  return {
    total: filtered.length,
    page,
    page_size: pageSize,
    rows: slice.map(presentPayment),
  };
}

function presentPayment(row: {
  id: string;
  paid_at: string;
  amount_kes: number;
  provider: string;
  reference: string;
  status: string;
  invoice_number: string | null;
  service_name: string | null;
}): PortalPayment {
  return {
    id: row.id,
    paid_at: row.paid_at,
    amount_kes: row.amount_kes,
    method: paymentMethodLabel(row.provider),
    reference_masked: maskReference(row.reference),
    invoice_number: row.invoice_number,
    service_name: row.service_name,
    status: row.status === "confirmed" ? "confirmed" : row.status,
    receipt_status: row.status === "confirmed" ? "available" : "pending",
  };
}

export async function loadPortalPaymentMethods(sql: Sql, ctx: PortalCtx): Promise<PortalPaymentMethod[]> {
  const providers = await sql<{
    id: string;
    kind: string;
    label: string;
    enabled: boolean;
    sandbox: boolean;
    till_number: string;
    stk_type: string;
    has_client: boolean;
  }>`select id, kind, label, enabled, sandbox,
            coalesce(till_number,'') as till_number,
            coalesce(stk_type,'') as stk_type,
            (coalesce(client_id,'') <> '') as has_client
     from payment_providers where tenant_id = ${ctx.tenantId} and enabled = true`;

  const methods: PortalPaymentMethod[] = [];
  for (const p of providers) {
    if (p.kind === "mpesa") {
      const till = p.stk_type === "till";
      const stkReady = p.sandbox || p.has_client;
      if (p.till_number) {
        methods.push({
          id: p.id,
          kind: "mpesa",
          label: till ? "M-Pesa Till" : "M-Pesa Paybill",
          mode: till ? "till" : "paybill",
          instructions: `Pay with M-Pesa ${till ? "Till" : "Paybill"} ${p.till_number}. Use the service account number as the reference.`,
          public_number: p.till_number,
          stk_available: false,
        });
      }
      if (stkReady) {
        methods.push({
          id: `${p.id}-stk`,
          kind: "mpesa",
          label: "M-Pesa STK Push",
          mode: "stk",
          instructions: "Confirm the amount and phone. We send a prompt to that handset. Do not pay twice.",
          public_number: p.till_number,
          stk_available: true,
        });
      }
    } else if (p.kind === "kopokopo") {
      if (!p.till_number && !p.has_client) continue;
      methods.push({
        id: p.id,
        kind: "kopokopo",
        label: "Kopo Kopo",
        mode: p.till_number ? "till" : "other",
        instructions: p.till_number ? `Pay to till ${p.till_number}.` : "Use the till issued by this network.",
        public_number: p.till_number,
        stk_available: p.sandbox || p.has_client,
      });
    } else if (p.kind === "card" || p.kind === "stripe") {
      methods.push({
        id: p.id,
        kind: "card",
        label: p.label || "Card payment",
        mode: "card",
        instructions: "Pay with a debit or credit card using the link this network issues.",
        public_number: "",
        stk_available: false,
      });
    } else if (p.till_number) {
      methods.push({
        id: p.id,
        kind: p.kind,
        label: p.label || paymentMethodLabel(p.kind),
        mode: "other",
        instructions: `Pay using ${p.till_number}.`,
        public_number: p.till_number,
        stk_available: false,
      });
    }
  }

  const [ten] = await sql<{ bank_name: string; bank_account: string; bank_branch: string }>`
    select coalesce(bank_name,'') as bank_name, coalesce(bank_account,'') as bank_account, coalesce(bank_branch,'') as bank_branch
    from tenants where id = ${ctx.tenantId}`;
  if (ten?.bank_name && ten.bank_account) {
    methods.push({
      id: "bank",
      kind: "bank",
      label: "Bank payment",
      mode: "bank",
      instructions: [ten.bank_name, ten.bank_account, ten.bank_branch].filter(Boolean).join(" · "),
      public_number: ten.bank_account,
      stk_available: false,
    });
  }
  return methods;
}

export async function loadPortalTickets(sql: Sql, ctx: PortalCtx, ticketId?: string): Promise<PortalTicket[]> {
  const tickets = ticketId
    ? await sql<{
        id: string;
        title: string;
        category: string;
        status: string;
        created_at: string;
        service_id: string | null;
      }>`select id, title, category, status, created_at::text as created_at, service_id
         from tickets
         where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id} and id = ${ticketId}
         order by created_at desc`
    : await sql<{
        id: string;
        title: string;
        category: string;
        status: string;
        created_at: string;
        service_id: string | null;
      }>`select id, title, category, status, created_at::text as created_at, service_id
         from tickets
         where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}
         order by created_at desc`;

  if (!tickets.length) return [];

  const comments = await sql<{
    id: string;
    ticket_id: string;
    author_id: string;
    author_kind: string;
    body: string;
    created_at: string;
  }>`select tc.id, tc.ticket_id, tc.author_id, coalesce(tc.author_kind,'staff') as author_kind, tc.body, tc.created_at::text as created_at
     from ticket_comments tc
     join tickets t on t.id = tc.ticket_id and t.tenant_id = tc.tenant_id
     where tc.tenant_id = ${ctx.tenantId} and t.customer_id = ${ctx.customer.id} and tc.is_internal = false
     order by tc.created_at asc`;

  const byTicket = new Map<string, PortalTicket["comments"]>();
  for (const c of comments) {
    const list = byTicket.get(c.ticket_id) ?? [];
    list.push({
      id: c.id,
      author: c.author_kind === "customer" || c.author_id === ctx.customer.id ? "you" : "support",
      body: c.body,
      created_at: c.created_at,
    });
    byTicket.set(c.ticket_id, list);
  }

  return tickets.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    category_label: ticketCategoryLabel(t.category),
    status: t.status,
    status_label: ticketStatusLabel(t.status),
    service_id: t.service_id,
    created_at: t.created_at,
    comments: byTicket.get(t.id) ?? [],
  }));
}

export async function loadPortalDashboard(sql: Sql, ctx: PortalCtx): Promise<PortalDashboard> {
  const services = await loadPortalServices(sql, ctx);
  const invoices = await loadPortalInvoices(sql, ctx);
  const payments = await loadPortalPayments(sql, ctx, { page: 1, page_size: 1 });
  const tickets = await sql<{ n: number }>`
    select count(*)::int as n from tickets
    where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}
      and status not in ('resolved','closed')`;
  const [loy] = await sql<{ points: number }>`
    select points from loyalty_accounts where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}`;
  const outstanding = invoices.reduce((s, i) => s + i.balance_kes, 0);
  const nextRenewal = services
    .map((s) => s.renewal_date)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? null;
  return {
    customer: presentCustomer(ctx),
    isp: presentIsp(ctx),
    services_total: services.length,
    services_active: services.filter((s) => s.status === "active").length,
    services_expired: services.filter((s) => s.status === "expired").length,
    services_suspended: services.filter((s) => s.status === "suspended").length,
    services_grace: services.filter((s) => s.status === "grace").length,
    outstanding_kes: outstanding,
    unpaid_invoices: invoices.filter((i) => i.balance_kes > 0).length,
    open_tickets: tickets[0]?.n ?? 0,
    next_renewal: nextRenewal,
    latest_payment: payments.rows[0] ?? null,
    using_initial_password: Boolean(ctx.customer.portal_password_is_initial),
    points: loy?.points ?? 0,
  };
}

export async function loadPortalHome(sql: Sql, ctx: PortalCtx): Promise<PortalHome> {
  const [services, invoices, payments, methods, tickets] = await Promise.all([
    loadPortalServices(sql, ctx),
    loadPortalInvoices(sql, ctx),
    loadPortalPayments(sql, ctx, { page: 1, page_size: 8 }),
    loadPortalPaymentMethods(sql, ctx),
    loadPortalTickets(sql, ctx),
  ]);
  const dashboard = await loadPortalDashboard(sql, ctx);
  return {
    customer: presentCustomer(ctx),
    isp: presentIsp(ctx),
    dashboard,
    services,
    invoices,
    payments: payments.rows,
    methods,
    tickets,
    points: dashboard.points,
  };
}

export async function loadPortalInbox(sql: Sql, ctx: PortalCtx) {
  return listCustomerInbox(sql, ctx.tenantId, ctx.customer.id);
}

export async function assertOwnInvoice(sql: Sql, ctx: PortalCtx, invoiceId: string) {
  const [inv] = await sql<{ id: string; number: string; customer_id: string; amount_kes: number; paid_kes: number; status: string }>`
    select id, number, customer_id, amount_kes, paid_kes, status
    from invoices where id = ${invoiceId} and tenant_id = ${ctx.tenantId}`;
  if (!inv || inv.customer_id !== ctx.customer.id) throw new Error("Invoice not found");
  return inv;
}

async function assertOwnService(sql: Sql, ctx: PortalCtx, serviceId: string) {
  const [row] = await sql<{ id: string }>`
    select id from services
    where id = ${serviceId} and tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id} and deleted_at is null`;
  if (!row) throw new Error("Service not found");
  return row;
}

async function assertOwnTicket(sql: Sql, ctx: PortalCtx, ticketId: string) {
  const [row] = await sql<{ id: string }>`
    select id from tickets where id = ${ticketId} and tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}`;
  if (!row) throw new Error("Ticket not found");
  return row;
}

export async function makePortalInvoiceFile(sql: Sql, ctx: PortalCtx, invoiceId: string) {
  const inv = await assertOwnInvoice(sql, ctx, invoiceId);
  const doc = sanitizeInvoiceForPortal(await loadInvoiceDocument(sql, ctx.tenantId, inv.id));
  const pdf = await renderInvoicePdf(doc);
  return { filename: `${fileSafe(doc.brand.slug)}-${fileSafe(doc.invoice.number)}.pdf`, pdf, doc };
}

export async function makePortalStatementFile(sql: Sql, ctx: PortalCtx, serviceId?: string) {
  if (serviceId) await assertOwnService(sql, ctx, serviceId);
  const doc = sanitizeStatementForPortal(await loadStatementDocument(sql, ctx.tenantId, ctx.customer.id, serviceId));
  const pdf = await renderStatementPdf(doc);
  return { filename: `${fileSafe(doc.brand.slug)}-statement-${fileSafe(doc.customer.accountNo)}.pdf`, pdf, doc };
}

export async function startPortalPayment(
  sql: Sql,
  ctx: PortalCtx,
  opts: { invoice_id?: string; service_id?: string; phone?: string; provider?: string; confirm_account?: string; amount_kes?: number },
): Promise<PortalStkStart> {
  let invoiceId = (opts.invoice_id || "").trim();
  let serviceId = (opts.service_id || "").trim();
  if (!invoiceId && !serviceId) throw new Error("Select the service you want to pay");

  if (serviceId) {
    const [svc] = await sql<{ id: string; account_number: string; name: string; deleted_at: string | null }>`
      select s.id, coalesce(s.account_number,'') as account_number, coalesce(nullif(s.name,''), p.name) as name,
             s.deleted_at::text as deleted_at
      from services s join packages p on p.id = s.package_id
      where s.id = ${serviceId} and s.tenant_id = ${ctx.tenantId} and s.customer_id = ${ctx.customer.id}`;
    if (!svc || svc.deleted_at) throw new Error("Service not found");
    const confirm = (opts.confirm_account || "").trim().toUpperCase();
    if (svc.account_number) {
      if (!confirm) throw new Error("Confirm the service account number before sending the payment prompt");
      if (confirm !== svc.account_number.toUpperCase()) {
        throw new Error("Confirm the service account number before sending the payment prompt");
      }
    }
    if (invoiceId) {
      const owns = await invoiceBelongsToService(sql, ctx.tenantId, invoiceId, serviceId);
      if (!owns) throw new Error("That invoice does not belong to this service");
    }
    if (!invoiceId) {
      const open = await sql<{ id: string }>`
        select i.id from invoices i
        where i.tenant_id = ${ctx.tenantId} and i.customer_id = ${ctx.customer.id}
          and i.status in ('issued','due','overdue','partial')
          and (
            i.service_id = ${serviceId}
            or exists (
              select 1 from invoice_items ii
              where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${serviceId}
            )
          )
        order by i.due_date, i.issued_at limit 1`;
      if (!open[0]) throw new Error("Nothing to pay on this service");
      invoiceId = open[0].id;
    }
  }

  const inv = await assertOwnInvoice(sql, ctx, invoiceId);
  const remaining = remainingKes(inv.amount_kes, inv.paid_kes, inv.status);
  if (remaining <= 0) throw new Error("Invoice already paid");

  let amountKes: number | undefined;
  if (opts.amount_kes != null) {
    const { assertPortalAmount, previewPortalPartial } = await import("./partial-payment.ts");
    const preview = serviceId
      ? await previewPortalPartial(sql, ctx.tenantId, {
          serviceId,
          customerId: ctx.customer.id,
          amountKes: opts.amount_kes,
        }).catch(() => null)
      : null;
    if (preview?.available) {
      amountKes = assertPortalAmount({
        available: true,
        amountKes: opts.amount_kes,
        remainingKes: remaining,
        minEnterKes: preview.min_enter_kes,
      });
    } else {
      amountKes = Math.min(remaining, Math.max(1, Math.round(opts.amount_kes)));
    }
  }

  const methods = await loadPortalPaymentMethods(sql, ctx);
  const provider = opts.provider || (methods.find((m) => m.stk_available)?.kind ?? "mpesa");
  const available = methods.some((m) => m.kind === provider && m.stk_available);
  if (!available) throw new Error("That payment method is not available");

  const phone = (opts.phone || ctx.customer.phone).trim();
  if (phone.replace(/\D/g, "").length < 9) throw new Error("Enter a valid M-Pesa phone number");

  const [svc] = await sql<{ id: string; account_number: string; name: string }>`
    select s.id, coalesce(s.account_number,'') as account_number, coalesce(nullif(s.name,''), p.name) as name
    from invoice_items ii
    join services s on s.id = ii.service_id
    join packages p on p.id = s.package_id
    where ii.invoice_id = ${inv.id} and ii.tenant_id = ${ctx.tenantId} and s.customer_id = ${ctx.customer.id}
      and s.deleted_at is null
    limit 1`;
  const [headerSvc] = !svc && serviceId
    ? await sql<{ id: string; account_number: string; name: string }>`
        select s.id, coalesce(s.account_number,'') as account_number, coalesce(nullif(s.name,''), p.name) as name
        from services s join packages p on p.id = s.package_id
        where s.id = ${serviceId} and s.tenant_id = ${ctx.tenantId}`
    : [];
  const billed = svc || headerSvc;

  const [pending] = await sql<{ id: string; checkout_id: string; amount_kes: number; phone: string }>`
    select id, checkout_id, amount_kes, phone from payment_intents
    where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id} and invoice_id = ${inv.id}
      and status = 'pending' and created_at > now() - interval '5 minutes'
    order by created_at desc limit 1`;
  if (pending) {
    return {
      intent_id: pending.id,
      checkout_id: pending.checkout_id,
      amount_kes: pending.amount_kes,
      phone: pending.phone || phone,
      invoice_number: inv.number,
      account_number: billed?.account_number || "",
      service_id: billed?.id || serviceId || "",
      service_name: billed?.name || "",
      status: "pending",
      note: "A payment prompt is already in progress. Complete it on your phone, or wait a few minutes to retry.",
    };
  }

  const intent = await createStkIntent(sql, {
    tenantId: ctx.tenantId,
    invoiceId: inv.id,
    provider,
    phone,
    amountKes,
  });
  return {
    intent_id: intent.id,
    checkout_id: intent.checkout_id,
    amount_kes: intent.amount_kes,
    phone: intent.phone || phone,
    invoice_number: inv.number,
    account_number: billed?.account_number || "",
    service_id: billed?.id || serviceId || "",
    service_name: billed?.name || "",
    status: "pending",
    note: intent.note || "Complete the M-Pesa prompt on your phone.",
  };
}

export async function pollPortalPayment(sql: Sql, ctx: PortalCtx, checkoutId: string): Promise<PortalStkPoll> {
  const [intent] = await sql<{
    id: string;
    invoice_id: string;
    customer_id: string;
    status: string;
    amount_kes: number;
    checkout_id: string;
  }>`select id, invoice_id, customer_id, status, amount_kes, checkout_id
     from payment_intents
     where checkout_id = ${checkoutId} and tenant_id = ${ctx.tenantId}`;
  if (!intent || intent.customer_id !== ctx.customer.id) throw new Error("Payment request not found");
  if (intent.status === "confirmed") {
    const [pay] = await sql<{ id: string; reference: string }>`
      select id, reference from payments
      where tenant_id = ${ctx.tenantId} and invoice_id = ${intent.invoice_id} and customer_id = ${ctx.customer.id}
      order by paid_at desc limit 1`;
    return {
      status: "confirmed",
      note: "Payment confirmed.",
      payment_id: pay?.id,
      amount_kes: intent.amount_kes,
      reference_masked: pay ? maskReference(pay.reference) : undefined,
    };
  }
  if (intent.status === "failed" || intent.status === "cancelled" || intent.status === "timeout") {
    return {
      status: intent.status,
      note:
        intent.status === "cancelled"
          ? "The M-Pesa prompt was cancelled."
          : intent.status === "timeout"
            ? "The M-Pesa prompt timed out. You can try again."
            : "Payment failed. You can try again.",
      amount_kes: intent.amount_kes,
    };
  }
  try {
    const pay = await settleStkIntent(sql, {
      tenantId: ctx.tenantId,
      ispName: ctx.isp.name,
      checkoutId: intent.checkout_id,
    });
    return {
      status: "confirmed",
      note: "Payment confirmed.",
      payment_id: pay.id,
      amount_kes: pay.amount,
      reference_masked: maskReference(intent.checkout_id),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Waiting for payment";
    const lower = msg.toLowerCase();
    if (lower.includes("cancel") || lower.includes("1032")) return { status: "cancelled", note: "The M-Pesa prompt was cancelled." };
    if (lower.includes("timeout") || lower.includes("1037")) return { status: "timeout", note: "The M-Pesa prompt timed out. You can try again." };
    if (lower.includes("fail") || lower.includes("reject") || lower.includes("declin")) {
      return { status: "failed", note: "Payment was not completed. You can try again." };
    }
    if (lower.includes("already confirmed")) {
      return { status: "confirmed", note: "Payment confirmed.", amount_kes: intent.amount_kes };
    }
    if (lower.includes("not confirmed") || lower.includes("waiting") || lower.includes("pending") || lower.includes("stk")) {
      return { status: "pending", note: "Waiting for M-Pesa. Keep your phone nearby." };
    }
    return { status: "pending", note: "Waiting for M-Pesa. Keep your phone nearby." };
  }
}

export async function openPortalTicket(
  sql: Sql,
  ctx: PortalCtx,
  opts: { title: string; category: string; message: string; service_id?: string },
) {
  const title = opts.title.trim();
  const message = opts.message.trim();
  if (title.length < 3) throw new Error("Enter a short subject");
  if (message.length < 3) throw new Error("Describe the issue");
  const category = PORTAL_TICKET_CATEGORIES.some((c) => c.id === opts.category) ? opts.category : "other";
  if (opts.service_id) await assertOwnService(sql, ctx, opts.service_id);
  const opened = await openTicket(sql, ctx.tenantId, {
    title,
    category,
    priority: "normal",
    customer_id: ctx.customer.id,
    service_id: opts.service_id || null,
  });
  await commentTicket(sql, ctx.tenantId, opened.id, ctx.customer.id, message, {
    internal: false,
    authorKind: "customer",
  });
  return opened;
}

export async function replyPortalTicket(sql: Sql, ctx: PortalCtx, opts: { ticket_id: string; message: string }) {
  await assertOwnTicket(sql, ctx, opts.ticket_id);
  const message = opts.message.trim();
  if (message.length < 1) throw new Error("Enter a reply");
  await commentTicket(sql, ctx.tenantId, opts.ticket_id, ctx.customer.id, message, {
    internal: false,
    authorKind: "customer",
  });
  return { ok: true };
}

export async function requestPortalGrace(sql: Sql, ctx: PortalCtx, opts: { service_id: string; days: number }) {
  await assertOwnService(sql, ctx, opts.service_id);
  return customerSelfGrant(sql, {
    tenantId: ctx.tenantId,
    customerId: ctx.customer.id,
    serviceId: opts.service_id,
    days: opts.days,
    ispName: ctx.isp.name,
  });
}

export function publicErrorMessage(err: unknown) {
  const msg = err instanceof Error ? err.message : "Something went wrong";
  if (/sql|postgres|column|relation|stack|pglite|typeerror/i.test(msg)) return "Something went wrong. Try again.";
  return msg;
}
