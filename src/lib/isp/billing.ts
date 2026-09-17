import { nid } from "../utils.ts";
import { addNairobiDays, nairobiDate } from "./empty-tenant.ts";
import { recordLedger } from "./ledger";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const UNPAID_INVOICE_STATUSES = ["issued", "due", "overdue", "partial"] as const;

export type InvoiceItemInput = {
  description: string;
  quantity?: number;
  unit_kes: number;
  package_id?: string;
  service_id?: string;
};

export function intervalDays(billingInterval: string) {
  if (billingInterval === "daily") return 1;
  if (billingInterval === "weekly") return 7;
  if (billingInterval === "quarterly") return 90;
  if (billingInterval === "yearly") return 365;
  return 30;
}

export function needsRecurringInvoice(opts: {
  hasUnpaid: boolean;
  lastIssuedAt: string | null;
  interval: string;
  today?: Date;
  stackWhileUnpaid?: boolean;
  firstRenewalYmd?: string | null;
}) {
  if (opts.hasUnpaid && !opts.stackWhileUnpaid) return false;
  if (!opts.lastIssuedAt) {
    const anchor = (opts.firstRenewalYmd || "").trim();
    if (anchor) return nairobiDate(opts.today ?? new Date()) >= anchor;
    return true;
  }
  const last = new Date(opts.lastIssuedAt);
  if (Number.isNaN(last.getTime())) return true;
  const today = opts.today ?? new Date();
  const elapsed = Math.floor((today.getTime() - last.getTime()) / 86400_000);
  return elapsed >= intervalDays(opts.interval);
}

export function moneyRound(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export function taxOn(subtotal: number, ratePct: number) {
  if (ratePct <= 0 || subtotal <= 0) return 0;
  return moneyRound((subtotal * ratePct) / 100);
}

export function normalizeItems(items: InvoiceItemInput[]) {
  return items
    .map((item) => {
      const quantity = Math.max(1, moneyRound(item.quantity ?? 1) || 1);
      const unit_kes = moneyRound(item.unit_kes);
      return {
        description: item.description.trim() || "Internet service",
        quantity,
        unit_kes,
        amount_kes: quantity * unit_kes,
        package_id: item.package_id || "",
        service_id: item.service_id || "",
      };
    })
    .filter((item) => item.amount_kes > 0);
}

export function invoiceTotals(items: Array<{ amount_kes: number }>, vatRatePct: number) {
  const subtotal = items.reduce((sum, item) => sum + item.amount_kes, 0);
  const tax = taxOn(subtotal, vatRatePct);
  return { subtotal, tax, total: subtotal + tax, tax_rate: vatRatePct > 0 ? vatRatePct : 0 };
}

export function remainingKes(amount: number, paid: number, status?: string) {
  if (status === "paid") return 0;
  return Math.max(0, moneyRound(amount) - moneyRound(paid));
}

export function statusAfterPayment(amount: number, paid: number, current: string) {
  if (paid >= amount) return "paid";
  if (paid > 0) return "partial";
  return current === "paid" ? "issued" : current;
}

export async function tenantVatRate(sql: Sql, tenantId: string) {
  const [ten] = await sql<{ vat_enabled: boolean; vat_rate_pct: number }>`
    select vat_enabled, vat_rate_pct from tenants where id = ${tenantId}`;
  if (!ten?.vat_enabled) return 0;
  return Math.max(0, ten.vat_rate_pct || 16);
}

export async function issueInvoice(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    dueDate: string;
    amountKes?: number;
    items?: InvoiceItemInput[];
    notes?: string;
    serviceId?: string;
  },
) {
  const rawItems =
    opts.items && opts.items.length > 0
      ? opts.items
      : [{ description: "Internet service", quantity: 1, unit_kes: moneyRound(opts.amountKes ?? 0) }];
  const items = normalizeItems(rawItems);
  if (items.length === 0) throw new Error("Invoice needs at least one line");
  const rate = await tenantVatRate(sql, opts.tenantId);
  const totals = invoiceTotals(items, rate);
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = ${opts.tenantId}`;
  const number = `INV-${String(1000 + (n ?? 0) + 1)}`;
  const id = nid("inv");
  const itemServiceIds = [...new Set(items.map((i) => i.service_id).filter(Boolean))];
  const serviceId = opts.serviceId || (itemServiceIds.length === 1 ? itemServiceIds[0] : "") || null;
  await sql`insert into invoices
    (id, tenant_id, customer_id, service_id, number, amount_kes, status, due_date, subtotal_kes, tax_kes, tax_rate, paid_kes, notes)
    values (
      ${id}, ${opts.tenantId}, ${opts.customerId}, ${serviceId}, ${number}, ${totals.total}, 'issued', ${opts.dueDate},
      ${totals.subtotal}, ${totals.tax}, ${totals.tax_rate}, 0, ${opts.notes ?? ""}
    )`;
  for (const item of items) {
    await sql`insert into invoice_items
      (id, tenant_id, invoice_id, description, quantity, unit_kes, amount_kes, package_id, service_id)
      values (
        ${nid("ili")}, ${opts.tenantId}, ${id}, ${item.description}, ${item.quantity}, ${item.unit_kes},
        ${item.amount_kes}, ${item.package_id || null}, ${item.service_id || null}
      )`;
  }
  await recordLedger(sql, {
    tenantId: opts.tenantId,
    customerId: opts.customerId,
    serviceId: serviceId || undefined,
    entryType: "invoice",
    debitKes: totals.total,
    refType: "invoice",
    refId: id,
    memo: number,
  });
  return { id, number, amount_kes: totals.total, subtotal_kes: totals.subtotal, tax_kes: totals.tax, tax_rate: totals.tax_rate, service_id: serviceId || "" };
}

export async function resolveInvoiceServiceId(sql: Sql, tenantId: string, invoiceId: string) {
  const [inv] = await sql<{ service_id: string | null }>`
    select service_id from invoices where id = ${invoiceId} and tenant_id = ${tenantId}`;
  if (inv?.service_id) return inv.service_id;
  const [item] = await sql<{ service_id: string }>`
    select service_id from invoice_items
    where invoice_id = ${invoiceId} and tenant_id = ${tenantId}
      and service_id is not null and service_id <> ''
    limit 1`;
  return item?.service_id || "";
}

export async function invoiceBelongsToService(
  sql: Sql,
  tenantId: string,
  invoiceId: string,
  serviceId: string,
) {
  if (!invoiceId || !serviceId) return false;
  const [row] = await sql<{ id: string }>`
    select i.id from invoices i
    where i.id = ${invoiceId} and i.tenant_id = ${tenantId}
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

export async function generateRecurringInvoices(sql: Sql, tenantId: string, now = new Date()) {
  const services = await sql<{
    id: string;
    customer_id: string;
    package_id: string;
    name: string;
    price_kes: number;
    billing_interval: string;
    billing_anchor_date: string | null;
    first_renewal_invoiced_at: string | null;
  }>`
    select s.id, s.customer_id, p.id as package_id, p.name, p.price_kes, p.billing_interval,
           s.billing_anchor_date::text as billing_anchor_date,
           s.first_renewal_invoiced_at::text as first_renewal_invoiced_at
    from services s
    join packages p on p.id = s.package_id
    join customers c on c.id = s.customer_id
    where s.tenant_id = ${tenantId} and c.tenant_id = ${tenantId}
      and c.deleted_at is null and s.deleted_at is null
      and s.status in ('active','grace')`;
  const created: Array<{ customerId: string; serviceId: string; id: string; number: string; amount_kes: number; dueDate: string }> = [];
  for (const svc of services) {
    if (svc.price_kes <= 0) continue;
    const unpaid = await sql<{ id: string }>`
      select i.id from invoices i
      where i.tenant_id = ${tenantId} and i.customer_id = ${svc.customer_id}
        and i.status in ('issued','due','overdue','partial')
        and (
          i.service_id = ${svc.id}
          or exists (
            select 1 from invoice_items ii
            where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${svc.id}
          )
          or (
            (i.service_id is null or i.service_id = '')
            and not exists (
              select 1 from invoice_items ii
              where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id
                and ii.service_id is not null and ii.service_id <> ''
            )
          )
        )
      limit 1`;
    const [last] = await sql<{ issued_at: string }>`
      select i.issued_at::text as issued_at from invoices i
      where i.tenant_id = ${tenantId} and i.customer_id = ${svc.customer_id}
        and (
          i.service_id = ${svc.id}
          or exists (
            select 1 from invoice_items ii
            where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${svc.id}
          )
          or (
            (i.service_id is null or i.service_id = '')
            and not exists (
              select 1 from invoice_items ii
              where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id
                and ii.service_id is not null and ii.service_id <> ''
            )
          )
        )
      order by i.issued_at desc limit 1`;
    const firstRenewalYmd = !last?.issued_at && svc.billing_anchor_date ? String(svc.billing_anchor_date).slice(0, 10) : null;
    if (!needsRecurringInvoice({
      hasUnpaid: Boolean(unpaid[0]),
      lastIssuedAt: last?.issued_at ?? null,
      interval: svc.billing_interval,
      today: now,
      stackWhileUnpaid: await creditAllowsStack(sql, tenantId, svc.id),
      firstRenewalYmd,
    })) {
      continue;
    }
    const dueDate = firstRenewalYmd || addNairobiDays(Math.min(intervalDays(svc.billing_interval), 14), now);
    const inv = await issueInvoice(sql, {
      tenantId,
      customerId: svc.customer_id,
      serviceId: svc.id,
      dueDate,
      items: [
        {
          description: `${svc.name} (${svc.billing_interval})`,
          quantity: 1,
          unit_kes: svc.price_kes,
          package_id: svc.package_id,
          service_id: svc.id,
        },
      ],
    });
    if (!svc.first_renewal_invoiced_at && svc.billing_anchor_date) {
      await sql`update services set first_renewal_invoiced_at = ${now.toISOString()}
        where id = ${svc.id} and tenant_id = ${tenantId} and first_renewal_invoiced_at is null`;
    }
    created.push({
      customerId: svc.customer_id,
      serviceId: svc.id,
      id: inv.id,
      number: inv.number,
      amount_kes: inv.amount_kes,
      dueDate,
    });
  }
  return created;
}

async function creditAllowsStack(sql: Sql, tenantId: string, serviceId: string) {
  try {
    const { creditAllowsInvoiceStack } = await import("./business-credit.ts");
    return creditAllowsInvoiceStack(sql, tenantId, serviceId);
  } catch {
    return false;
  }
}