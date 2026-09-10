# What is real vs simulated

## Functional (proven in tests)

| Capability | Proof |
|---|---|
| Multi-tenant isolation | App queries are tenant-scoped. PostgreSQL RLS (`0013_rls.sql`) hides other tenants when the session role is not a superuser. CI re-runs this against Postgres 16. |
| M-Pesa callback + idempotency | Duplicate Daraja callbacks confirm once. Amount mismatch goes to reconciliation and does not insert a payment. Duplicate payment references are rejected. Invoice ledger debit + payment credit net to zero. |
| Paybill / till C2B | Every C2B hit is stored. Unknown bill refs stay unmatched on Reports for finance to assign. Proven in `incoming-payments.test.ts`. Live till needs a public Daraja confirmation URL. |
| WireGuard keys | Real X25519 keypairs. Peers compute the same 32-byte shared secret. Private keys are sealed at rest. Hub `wg-gridline.conf` + MikroTik enroll script with endpoint. Live kernel handshake is **not** run in CI. |
| MikroTik agent | Enroll token + generated WG keys. Service commands auto-queue. Destructive `raw.script` stays `proposed` until approve, then is pulled. Approval writes `audit_logs`. Pull marks the router connected. |
| Billing lifecycle | Overdue past `grace_days` suspends. Inside grace → `grace`. Expired `period_end` suspends (`time`). Data cap suspends (`bundle`). Full payment extends the period, resets usage, restores unless another invoice is still overdue. Partials do not restore. Optional exclusive VAT. Platform plans activate after M-Pesa, not on click. |
| FreeRADIUS REST | Authorize / authenticate / accounting over HTTPS with a per-tenant API key. rlm_rest JSON. Suspended, expired, and FUP users are Access-Reject. Sidecar daemon on VPS compose (UDP 1812/1813). |
| Churn score | Logistic scoring from service state, invoices, payments, and tickets. Reasons are listed. Not a trained neural net. |
| Password reset | Operator/superadmin email reset (hashed token, 30 min). Portal password + SMS reset. Admin/staff can set a password. Email sends only with Resend; otherwise the link is shown. |
| Custom domain login | Same-origin Origin/Host match plus tenant `public_base_url`. CSRF stays on. Proven in `auth-origins.test.ts`. |
| Invoice / statement PDFs | pdfkit A4 from live billing + ledger. Tenant-branded. View/download/print/email. |
| VPS publish | Docker Compose + Caddy + Postgres. First install, then auto-pull of `main`. Platform deploy remains Vercel. |
| Secrets | No published `gridline-dev-secret-change-me`. Production or any `DATABASE_URL` requires `APP_SECRET`. |

## Simulated / architecture-only

- Live M-Pesa till (needs real Daraja credentials + public callback URL)
- Live SMS (sandbox unless a provider key is set)
- Email send (queued; Resend only if `RESEND_API_KEY` is set)
- FreeRADIUS UDP handshake on a physical NAS (adapter + compose sidecar are real; sandbox has no daemon)
- GenieACS TR-069 on a physical CPE (NBI adapter + compose sidecar are real; sandbox has no daemon)
- Native mobile apps
- Stripe
- Kernel WireGuard handshake on a real NIC
- Captive portal for hotspot vouchers

Preview (PGLite) connects as a superuser, so RLS is not enforced there. CI and production Postgres apply it. Connect `DATABASE_URL` as a non-superuser.
