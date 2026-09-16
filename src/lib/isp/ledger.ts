import { nid } from "../utils.ts";
import type { Sql } from "./events";

export async function recordLedger(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    serviceId?: string | null;
    entryType: string;
    debitKes?: number;
    creditKes?: number;
    refType?: string;
    refId?: string;
    memo?: string;
  },
) {
  await sql`insert into customer_ledger
    (id, tenant_id, customer_id, service_id, entry_type, debit_kes, credit_kes, ref_type, ref_id, memo)
    values (
      ${nid("led")}, ${opts.tenantId}, ${opts.customerId}, ${opts.serviceId || null}, ${opts.entryType},
      ${opts.debitKes ?? 0}, ${opts.creditKes ?? 0}, ${opts.refType ?? ""}, ${opts.refId ?? ""}, ${opts.memo ?? ""}
    )`;
}

export async function allocatePayment(
  sql: Sql,
  opts: { tenantId: string; paymentId: string; invoiceId: string; amountKes: number },
) {
  await sql`insert into payment_allocations (id, tenant_id, payment_id, invoice_id, amount_kes)
    values (${nid("alc")}, ${opts.tenantId}, ${opts.paymentId}, ${opts.invoiceId}, ${opts.amountKes})`;
}

export async function customerBalance(sql: Sql, tenantId: string, customerId: string) {
  const [row] = await sql<{ debit: number; credit: number }>`
    select coalesce(sum(debit_kes),0)::int as debit, coalesce(sum(credit_kes),0)::int as credit
    from customer_ledger where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  return (row?.debit ?? 0) - (row?.credit ?? 0);
}

export async function serviceBalance(sql: Sql, tenantId: string, serviceId: string) {
  const [fromLedger] = await sql<{ debit: number; credit: number }>`
    select coalesce(sum(debit_kes),0)::int as debit, coalesce(sum(credit_kes),0)::int as credit
    from customer_ledger where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  if ((fromLedger?.debit ?? 0) > 0 || (fromLedger?.credit ?? 0) > 0) {
    return (fromLedger?.debit ?? 0) - (fromLedger?.credit ?? 0);
  }
  const [fromInv] = await sql<{ n: number }>`
    select coalesce(sum(greatest(0, i.amount_kes - i.paid_kes)),0)::int as n
    from invoices i
    where i.tenant_id = ${tenantId} and i.status in ('issued','due','overdue','partial')
      and (
        i.service_id = ${serviceId}
        or exists (
          select 1 from invoice_items ii
          where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${serviceId}
        )
      )`;
  return fromInv?.n ?? 0;
}

export async function serviceOpenInvoices(
  sql: Sql,
  tenantId: string,
  customerId: string,
  serviceId: string,
) {
  return sql<{ id: string; amount_kes: number; paid_kes: number; status: string; number: string; due_date: string }>`
    select i.id, i.amount_kes, i.paid_kes, i.status, i.number, i.due_date::text as due_date
    from invoices i
    where i.tenant_id = ${tenantId} and i.customer_id = ${customerId}
      and i.status in ('issued','due','overdue','partial','sent','pending')
      and (
        i.service_id = ${serviceId}
        or exists (
          select 1 from invoice_items ii
          where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${serviceId}
        )
      )
    order by i.due_date, i.issued_at`;
}