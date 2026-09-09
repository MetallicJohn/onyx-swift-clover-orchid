# Billing

Invoice status ≠ service status.

Services: pending / active / grace / suspended / terminated.

Invoices: issued / due / overdue / paid / partial.

## Automatic access

The access policy runs on the billing cron, on every console session (throttled to 2 minutes), and immediately on RADIUS accounting and payment callbacks.

| Trigger | Effect |
|---|---|
| Invoice past due, inside `grace_days` | Service → `grace` (still online) |
| Invoice past due + grace | Service → `suspended`, MikroTik disable queued |
| `period_end` elapsed (+ grace) | Service → `grace` then `suspended` (`time`) |
| `bundle_used_mb` ≥ package `bundle_mb` | Service → `suspended` (`bundle`) |
| Hotspot voucher clock | Voucher expired, service terminated |
| Confirmed payment | Paid-through date extends by interval/validity, bundle resets. Restores unless another invoice is still overdue. |

Ledger credits are written on confirmed payment. Customer statements should sum `customer_ledger`, not a cached balance field.

RADIUS accounting (`POST /api/v1/radius/accounting/{slug}`) updates usage. A new `session_id` is treated as an increment; repeats of the same id are snapshots (delta from the previous octets).
