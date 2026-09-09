import { nid } from "../utils.ts";
import type { Sql } from "./events";

export async function recordLedger(
  sql: Sql,
  opts: {
    tenantId: string;
    customerId: string;
    entryType: string;
    debitKes?: number;
    creditKes?: number;
    refType?: string;
    refId?: string;
    memo?: string;
  },
) {
  await sql`insert into customer_ledger
    (id, tenant_id, customer_id, entry_type, debit_kes, credit_kes, ref_type, ref_id, memo)
    values (
      ${nid("led")}, ${opts.tenantId}, ${opts.customerId}, ${opts.entryType},
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
