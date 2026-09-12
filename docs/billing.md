# Billing

Invoice status ≠ service status.

Services: pending / active / grace / suspended / terminated.

Invoices: issued / due / overdue / partial / paid.

## Customer invoices

- Issued from the customer’s packages (line items). A custom line is still allowed.
- Optional Kenya VAT 16% is **exclusive** of package price. Toggle it on Billing. Off by default so listed prices stay as-is.
- Partial payments credit `paid_kes` and set status to `partial` until the remainder is cleared.
- Outstanding, statements, and aging use the remaining balance, not the original total.
- Confirmed **full** payment of an invoice extends the paid-through date and restores service unless another invoice is still overdue. A partial does not restore.

## Platform subscription (Settings → Plan)

ISP Solutions charges the ISP tenant. Stripe is not used.

- Trial is immediate (14 days) and can be used **once per email or phone**. A second ISP with the same email or mobile does not get another trial — they must pick a paid plan.
- Starter / Growth issue a platform invoice (`SUB-…`). The plan does **not** change until that invoice is paid in full via M-Pesa (STK to the company phone) or a recorded receipt.
- Cancelling a pending paid invoice while the trial is still running keeps the original trial dates. After a trial has been used, switching back to trial is blocked.

## Automatic access

The access policy runs on the billing cron, on every console session (throttled to 2 minutes), and immediately on RADIUS accounting and payment callbacks.

| Trigger | Effect |
|---|---|
| Invoice past due, inside `grace_days` | Service → `grace` (still online) |
| Staff or eligible customer grants Grace Period | Temporary access until a **fixed** expiry. `period_end` / renewal date does not move. Unpaid invoices stay unpaid. |
| Invoice past due + grace | Service → `suspended`, MikroTik disable queued |
| `period_end` elapsed (+ grace) | Service → `grace` then `suspended` (`time`) |
| `bundle_used_mb` ≥ package `bundle_mb` | Service → `suspended` (`bundle`) |
| Hotspot voucher clock | Voucher expired, service terminated |
| Confirmed **full** payment | Paid-through date extends by interval/validity, bundle resets. Restores unless another invoice is still overdue. |

Ledger credits are written on confirmed payment. Customer statements should sum `customer_ledger`, not a cached balance field.

Grace Period is access-only. It never creates revenue, marks an invoice paid, changes package price, or adds days to the next paid period. Staff grant/extend/revoke live on Services. Eligibility for the customer portal is Settings → Grace period.

RADIUS accounting (`POST /api/v1/radius/accounting/{slug}`) updates usage. A new `session_id` is treated as an increment; repeats of the same id are snapshots (delta from the previous octets).
