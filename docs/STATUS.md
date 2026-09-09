# What is real vs simulated

## Functional (proven in tests)

| Capability | Proof |
|---|---|
| Multi-tenant isolation | App queries are tenant-scoped. PostgreSQL RLS (`0013_rls.sql`) hides other tenants when the session role is not a superuser. CI re-runs this against Postgres 16. |
| M-Pesa callback + idempotency | Duplicate Daraja callbacks confirm once. Amount mismatch goes to reconciliation and does not insert a payment. Duplicate payment references are rejected. Invoice ledger debit + payment credit net to zero. |
| WireGuard keys | Real X25519 keypairs. Peers compute the same 32-byte shared secret. Private keys are sealed at rest. Live kernel handshake is **not** run in CI. |
| MikroTik agent | Enroll token + generated WG keys. Service commands auto-queue. Destructive `raw.script` stays `proposed` until approve, then is pulled. Approval writes `audit_logs`. Pull marks the router connected. |
| Billing lifecycle | Overdue past `grace_days` suspends. Inside grace → `grace`. Expired `period_end` suspends (`time`). Data cap suspends (`bundle`). Confirmed payment extends the period, resets usage, restores unless another invoice is still overdue. |
| Secrets | No published `gridline-dev-secret-change-me`. Production or any `DATABASE_URL` requires `APP_SECRET`. |

## Simulated / architecture-only

- Live M-Pesa till (needs real Daraja credentials + public callback URL)
- Live SMS (sandbox unless a provider key is set)
- Email send (queued; Resend only if `RESEND_API_KEY` is set)
- FreeRADIUS daemon
- GenieACS / TR-069 session
- Native mobile apps
- Stripe
- Kernel WireGuard handshake on a real NIC
- Captive portal for hotspot vouchers

Preview (PGLite) connects as a superuser, so RLS is not enforced there. CI and production Postgres apply it. Connect `DATABASE_URL` as a non-superuser.
