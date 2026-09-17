# What is real vs simulated

## Functional (proven in tests)

| Capability | Proof |
|---|---|
| Multi-tenant isolation | App queries are tenant-scoped. PostgreSQL RLS (`0013_rls.sql`) hides other tenants when the session role is not a superuser. CI re-runs this against Postgres 16. |
| M-Pesa callback + idempotency | Duplicate Daraja callbacks confirm once. Amount mismatch goes to reconciliation and does not insert a payment. Duplicate payment references are rejected. Invoice ledger debit + payment credit net to zero. |
| Paybill / till C2B | Every C2B hit is stored. Unknown bill refs stay unmatched on Reports for finance to assign. Proven in `incoming-payments.test.ts`. Live till needs a public Daraja confirmation URL. |
| WireGuard keys | Real X25519 keypairs. Peers compute the same 32-byte shared secret. Private keys are sealed at rest. Hub `wg-ispsolutions.conf` + MikroTik enroll script with endpoint. Live kernel handshake is **not** run in CI. |
| MikroTik agent | Enroll token + generated WG keys. Service commands auto-queue. PCQ per package (not simple queue per customer). Destructive `raw.script` stays `proposed` until approve, then is pulled. Approval writes `audit_logs`. Pull marks the router connected. |
| MikroTik provisioning | Hashed `prv_` bootstrap tokens with TTL and revoke. Short paste script checks internet and fetches `.rsc` over HTTPS with `check-certificate=yes`. Public fetch URL comes from the domain resolver (verified custom → verified subdomain → central `app.public_url`). Placeholder hosts such as `YOUR-PUBLIC-URL` are never generated. Config versions and events stored. Unique overlay IPs. Online is not claimed without heartbeat/pull. Proof: `router-provisioning.test.ts`, `domain-resolve.test.ts`. Live kernel handshake is **not** run in CI. |
| Billing lifecycle | Overdue past `grace_days` suspends. Inside grace → `grace`. Expired `period_end` suspends (`time`) and sends Service Expired. Data cap suspends (`bundle`). Full payment extends the period, resets usage, restores unless another invoice is still overdue. Optional partial payment (off by default) grants pro-rata validity when the configured minimum % is met, for that service only. Business/enterprise packages with a configured maximum credit stay Active after expiry while that **service's** outstanding is below the limit (`business_credit`); they suspend at the limit (`credit_limit`) and invoices stack while below it. New services default expiry to today when awaiting payment, or today + package validity when started as Active. Continuing / migrated services keep the selected existing expiry as the first renewal (`billing_anchor_date`); import does not invoice or send onboarding SMS. Proof: `onboard.test.ts`, `onboard-notify.test.ts`, `onboard-import.test.ts`, `partial-payment.test.ts`, `business-credit.test.ts`. Optional exclusive VAT. Platform plans activate after M-Pesa, not on click. |
| FreeRADIUS REST | Authorize / authenticate / accounting over HTTPS with a per-tenant API key. rlm_rest JSON. Suspended, expired, and FUP users are Access-Reject. Sidecar daemon on VPS compose (UDP 1812/1813). |
| Churn score | Logistic scoring from service state, invoices, payments, and tickets. Reasons are listed. Not a trained neural net. Insights Retention tab shows suggested retention KPIs (churn, renewal, reactivation, CSAT, complaints, referrals) with this-month figures; CSAT is never invented (`retention.test.ts`). Lifetime value tab shows revenue CLV from ARPU ÷ monthly churn plus realized collections; gross margin and CAC are never invented (`clv.test.ts`). Customers desk is server-side search/filter/pagination over live records (`customer-desk.test.ts`). Services desk is server-side search/filter/pagination over live lines (`service-desk.test.ts`). Reassign Service searches the destination customer by name, phone, email, or account and does not move invoices (`reassign-format.test.ts`, `customer-lifecycle.test.ts`). GenieACS Devices assigns CPE/ONU to a customer service, queues verified NBI tasks, and does not invoice or SMS (`acs-devices.test.ts`, `acs-device-actions.test.ts`). |
| Password reset | Operator/superadmin email reset (hashed token, 30 min). Portal password + SMS reset. Admin/staff can set a password. Email sends only with Resend; otherwise the link is shown. |
| Customer portal | Phone is the username and first password (hashed, change optional). Customer-safe DTOs exclude credentials and network internals. STK is pending until callback/poll. Tickets hide internal notes. Versioned `/api/v1/portal`. Proof: `customer-portal.test.ts`. Native apps not built. |
| Custom domain login | Same-origin Origin/Host match plus verified tenant domains and `public_base_url`. CSRF stays on. Proven in `auth-origins.test.ts`. |
| Invoice / statement PDFs | pdfkit A4 from live billing + ledger. Tenant-branded. View/download/print/email. |
| VPS publish | Docker Compose + Caddy + Postgres. Deploy only after green CI on `main`: backup, pull, migrate, health, rollback. Timer fetches GitHub but does not rebuild unless `ISPSOLUTIONS_AUTO_DEPLOY=1`. Platform deploy remains Vercel. |
| Superadmin infrastructure card | CPU, RAM, and disk on the SaaS overview come from `infra_nodes` heartbeats. vCPU count and used/total bytes are not stored, so the card shows **Not available** rather than guessed capacity. Stale heartbeats keep last metrics and are labelled stale. Proof: `platform.test.ts`. |
| Secrets | No published development secret. Production or any `DATABASE_URL` requires `APP_SECRET`. |
| ACS TR-069 security | Per-ISP digest auth, sealed secrets, URL lock provision/preset, optional HTTPS URLs. NBI unpublished. Proven in `acs-security.test.ts`. Live CPE session is not run in CI. |
| Split-ready deploy | Env-validated adapters, Postgres job queue, optional Redis, compose roles, `/api/v1/ready`. Proven in `runtime-config.test.ts`, `jobs.test.ts`, `distributed.test.ts`. Live multi-VPS cutover is not run in CI. |
| Traffic monitoring | Four-tier telemetry (Redis live, minute, hourly/daily). RADIUS remains billing authority. Batched MikroTik REST. Proven in `traffic-collector.test.ts`. Live NAS/NetFlow collection is not run in CI. |

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
