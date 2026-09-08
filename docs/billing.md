# Billing

Invoice status ≠ service status.

Services: pending / active / grace / suspended / terminated (throttled/blocked reserved).

Invoices: issued / due / overdue / paid / partial.

Payment received emits `payment.confirmed` → restore eligible services. Grace days live on packages.

Ledger credits are written on confirmed payment. Customer statements should sum `customer_ledger`, not a cached balance field.
