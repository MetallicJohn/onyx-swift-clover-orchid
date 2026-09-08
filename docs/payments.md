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

Ledger: `customer_ledger`, `payment_allocations`. Statement should be derived from these, not a mutable balance column.
