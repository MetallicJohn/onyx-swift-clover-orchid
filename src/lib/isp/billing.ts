import { nid } from "@/lib/utils";
import { recordLedger } from "./ledger";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
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

export async function issueInvoice(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    amountKes: number;
    dueDate: string;
  },
) {
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = ${opts.tenantId}`;
  const number = `INV-${String(1000 + (n ?? 0) + 1)}`;
  const id = nid("inv");
  await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
    values (${id}, ${opts.tenantId}, ${opts.customerId}, ${number}, ${opts.amountKes}, 'issued', ${opts.dueDate})`;
  await recordLedger(sql, {
    tenantId: opts.tenantId,
    customerId: opts.customerId,
    entryType: "invoice",
    debitKes: opts.amountKes,
    refType: "invoice",
    refId: id,
    memo: number,
  });
  return { id, number };
}

export async function generateRecurringInvoices(
  sql: Sql,
  tenantId: string,
  issue: (customerId: string, amountKes: number, dueDate: string) => Promise<void>,
) {
  const customers = await sql<{ id: string }>`
    select distinct c.id from customers c
    join services s on s.customer_id = c.id
    where c.tenant_id = ${tenantId} and s.tenant_id = ${tenantId} and s.status in ('active','grace')`;
  let created = 0;
  for (const c of customers) {
    const pkgs = await sql<{ price_kes: number; billing_interval: string }>`
      select p.price_kes, p.billing_interval from services s
      join packages p on p.id = s.package_id
      where s.tenant_id = ${tenantId} and s.customer_id = ${c.id} and s.status in ('active','grace')`;
    if (!pkgs[0]) continue;
    const amount = pkgs.reduce((sum, p) => sum + p.price_kes, 0);
    const interval = pkgs[0].billing_interval;
    const unpaid = await sql<{ id: string }>`
      select id from invoices where tenant_id = ${tenantId} and customer_id = ${c.id}
      and status in ('issued','due','overdue') limit 1`;
    const [last] = await sql<{ issued_at: string }>`
      select issued_at::text as issued_at from invoices
      where tenant_id = ${tenantId} and customer_id = ${c.id}
      order by issued_at desc limit 1`;
    if (!needsRecurringInvoice({ hasUnpaid: Boolean(unpaid[0]), lastIssuedAt: last?.issued_at ?? null, interval })) {
      continue;
    }
    const due = new Date();
    due.setDate(due.getDate() + Math.min(intervalDays(interval), 14));
    await issue(c.id, amount, due.toISOString().slice(0, 10));
    created += 1;
  }
  return created;
}
