import { nid } from "../utils.ts";
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
  return 30;
}

export function needsRecurringInvoice(opts: {
  hasUnpaid: boolean;
  lastIssuedAt: string | null;
  interval: string;
  today?: Date;
}) {
  if (opts.hasUnpaid) return false;
  if (!opts.lastIssuedAt) return true;
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
  await sql`insert into invoices
    (id, tenant_id, customer_id, number, amount_kes, status, due_date, subtotal_kes, tax_kes, tax_rate, paid_kes, notes)
    values (
      ${id}, ${opts.tenantId}, ${opts.customerId}, ${number}, ${totals.total}, 'issued', ${opts.dueDate},
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
    entryType: "invoice",
    debitKes: totals.total,
    refType: "invoice",
    refId: id,
    memo: number,
  });
  return { id, number, amount_kes: totals.total, subtotal_kes: totals.subtotal, tax_kes: totals.tax, tax_rate: totals.tax_rate };
}

export async function generateRecurringInvoices(sql: Sql, tenantId: string) {
  const customers = await sql<{ id: string }>`
    select distinct c.id from customers c
    join services s on s.customer_id = c.id
    where c.tenant_id = ${tenantId} and s.tenant_id = ${tenantId} and s.status in ('active','grace')`;
  const created: Array<{ customerId: string; id: string; number: string; amount_kes: number; dueDate: string }> = [];
  for (const c of customers) {
    const pkgs = await sql<{
      service_id: string;
      package_id: string;
      name: string;
      price_kes: number;
      billing_interval: string;
    }>`
      select s.id as service_id, p.id as package_id, p.name, p.price_kes, p.billing_interval
      from services s
      join packages p on p.id = s.package_id
      where s.tenant_id = ${tenantId} and s.customer_id = ${c.id} and s.status in ('active','grace')`;
    if (!pkgs[0]) continue;
    const unpaid = await sql<{ id: string }>`
      select id from invoices where tenant_id = ${tenantId} and customer_id = ${c.id}
      and status in ('issued','due','overdue','partial') limit 1`;
    const [last] = await sql<{ issued_at: string }>`
      select issued_at::text as issued_at from invoices
      where tenant_id = ${tenantId} and customer_id = ${c.id}
      order by issued_at desc limit 1`;
    if (!needsRecurringInvoice({ hasUnpaid: Boolean(unpaid[0]), lastIssuedAt: last?.issued_at ?? null, interval: pkgs[0].billing_interval })) {
      continue;
    }
    const due = new Date();
    due.setDate(due.getDate() + Math.min(intervalDays(pkgs[0].billing_interval), 14));
    const dueDate = due.toISOString().slice(0, 10);
    const inv = await issueInvoice(sql, {
      tenantId,
      customerId: c.id,
      dueDate,
      items: pkgs.map((p) => ({
        description: `${p.name} (${p.billing_interval})`,
        quantity: 1,
        unit_kes: p.price_kes,
        package_id: p.package_id,
        service_id: p.service_id,
      })),
    });
    created.push({ customerId: c.id, id: inv.id, number: inv.number, amount_kes: inv.amount_kes, dueDate });
  }
  return created;
}
