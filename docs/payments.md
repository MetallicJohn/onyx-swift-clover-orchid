# Payments

Lifecycle:

```
PAYMENT_INTENT_CREATED → PENDING
  → PROVIDER_CALLBACK or PROVIDER_QUERY
  → VALIDATE + IDEMPOTENCY
  → CONFIRMED payment row
  → allocation + ledger credit
  → emit payment.confirmed
  → restore service (subscriber)
```

Failed provider ResultCode is recorded, not confirmed.

Sandbox `ws_*` checkouts may be settled only while the provider row is `sandbox=true`. Live providers require Daraja/Kopo Kopo.

Staff `recordPayment` is a finance permission for cash/bank with a unique reference — not an STK fake-confirm.

Callback evaluation (`callback-validate.ts`): matching amount + receipt confirms; 1032 cancels; other ResultCodes fail; amount mismatch goes to `reconciliation_required`; replays are idempotent.

## Paybill / till (C2B)

Daraja confirmation URL (`/api/webhooks/mpesa/:slug`) accepts both STK callbacks and C2B Pay Bill / Buy Goods payloads.

- Every hit is stored on `incoming_payments` (unique `tenant_id + trans_id`).
- Auto-match order: account number (`SLUG-xxxxxx`), invoice number, PPPoE username, then MSISDN. Ambiguous matches stay unmatched.
- Unmatched rows appear on **Reports → Paybill / Till**. Finance (`payments.reconcile`) selects them and assigns a customer (optional invoice). That writes a confirmed payment, ledger credit, and FIFO invoice allocation.
- C2B always returns `ResultCode 0` so money is never rejected at validation.
- Live C2B needs a public confirmation URL on the VPS (or tunnel) registered in Daraja.

Ledger: `customer_ledger`, `payment_allocations`. Statement should be derived from these, not a mutable balance column.

