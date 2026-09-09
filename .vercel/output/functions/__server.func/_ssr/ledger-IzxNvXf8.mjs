import { b as nid } from "./rls-stkZtAMF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/ledger-IzxNvXf8.js
async function recordLedger(sql, opts) {
	await sql`insert into customer_ledger
    (id, tenant_id, customer_id, entry_type, debit_kes, credit_kes, ref_type, ref_id, memo)
    values (
      ${nid("led")}, ${opts.tenantId}, ${opts.customerId}, ${opts.entryType},
      ${opts.debitKes ?? 0}, ${opts.creditKes ?? 0}, ${opts.refType ?? ""}, ${opts.refId ?? ""}, ${opts.memo ?? ""}
    )`;
}
async function allocatePayment(sql, opts) {
	await sql`insert into payment_allocations (id, tenant_id, payment_id, invoice_id, amount_kes)
    values (${nid("alc")}, ${opts.tenantId}, ${opts.paymentId}, ${opts.invoiceId}, ${opts.amountKes})`;
}
//#endregion
export { recordLedger as n, allocatePayment as t };
