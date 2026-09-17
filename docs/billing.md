# Billing

Invoice status ≠ service status.

Services: pending / active / grace / suspended / terminated.

Invoices: issued / due / overdue / partial / paid.

## Customer invoices

- Issued from the customer’s packages (line items). A custom line is still allowed.
- Optional Kenya VAT 16% is **exclusive** of package price. Toggle it on Billing. Off by default so listed prices stay as-is.
- Partial payments credit `paid_kes` and set status to `partial` until the remainder is cleared.
- Outstanding, statements, and aging use the remaining balance, not the original total.
- Confirmed **full** payment of an invoice extends the paid-through date and restores service unless another invoice is still overdue.
- **Partial payment** is off by default (Settings → Partial payments). When enabled for that customer or service, a qualifying percentage of **that service's** invoice can activate or restore **only that line**, with pro-rata validity rounded down. After-full-payment services still need the invoice paid in full. A below-minimum payment posts to the ledger and does not grant access. The remaining balance stays on the same invoice.
- **Business credit** is off unless the package tier is Business or Enterprise, credit is enabled, and a maximum outstanding in KES is set. Max 0 is not unlimited. The service stays Active after expiry (`business_credit`) while that service's unpaid invoices plus ledger debits stay below the maximum. Invoices continue on the billing interval (daily, weekly, monthly, quarterly, yearly) and unpaid periods stack. At or above the maximum the service suspends (`credit_limit`) and RADIUS/MikroTik are disabled. Payment is allocated to the selected service account only. Residential lines on the same customer still expire normally.
- **Continuing clients / migration** keep the expiry already paid in the previous system. That date is stored as `period_end` and `billing_anchor_date`. The first renewal invoice is not created on import; the billing cycle waits until that date, then uses it as the due date. After the first invoice, the package interval applies. Onboarding SMS is off unless staff opt in. Extra services on the same customer get their own account number and expiry.

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
| Qualifying **partial** payment (policy on) | Pro-rata validity, rounded down, on the selected service only. Remaining balance stays on the same invoice. Below-minimum payments post and do not restore. |
| Business credit (configured) | Service stays Active after expiry while outstanding < maximum. Invoices stack. Warning SMS at the threshold. At the maximum: suspend `credit_limit`, RADIUS disable. Payment restores only that service if outstanding falls below the maximum. Manual, fraud, security, bundle, and staff-expiry are never auto-restored. |

Ledger credits are written on confirmed payment. Customer statements should sum `customer_ledger`, not a cached balance field.

Grace Period is access-only. It never creates revenue, marks an invoice paid, changes package price, or adds days to the next paid period. Staff grant/extend/revoke live on Services. Eligibility for the customer portal is Settings → Grace period.

RADIUS accounting (`POST /api/v1/radius/accounting/{slug}`) updates usage. A new `session_id` is treated as an increment; repeats of the same id are snapshots (delta from the previous octets).
