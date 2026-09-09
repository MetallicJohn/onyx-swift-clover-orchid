# Milestone status (honest)

Product milestones are complete except the items you asked to skip.

| Area | Status |
|---|---|
| Foundation / RBAC / tenants | Implemented and tested |
| Customers / packages / services | Implemented and tested |
| Billing / invoices / ledger / statements | Implemented and tested — line items, optional VAT, partials, auto suspend/restore |
| Payments Daraja/Kopo | Implemented and tested (live needs real till + callback URL) |
| RADIUS desired state + REST adapter | Implemented and tested — **daemon stays external** |
| MikroTik agent + approve | Implemented and tested |
| WireGuard hub + client script | Implemented and tested — hub conf + enroll `.rsc` with endpoint; kernel handshake not verified in lab |
| VPS self-host | Docker + Caddy + Postgres installer — WireGuard on the host kernel |
| PPPoE / static / IPAM | Implemented and tested |
| Hotspot vouchers | Implemented and tested — no captive portal |
| Notifications SMS/WA/inbox | Implemented and tested — email queued |
| Tickets + field (console) | Implemented and tested — **native apps skipped** |
| Customer portal | Implemented and tested |
| GenieACS inventory + NBI adapter | Implemented and tested — **daemon is the compose sidecar, not in-process TR-069** |
| Loyalty / referrals / resellers | Implemented and tested |
| SaaS platform plans | Implemented — invoice-and-pay via M-Pesa, **Stripe skipped** |
| Reports + audit | Implemented and tested |
| Churn score | Interpretable logistic model on live billing / access / tickets — not a fitted neural net |
| Password reset | Operator + superadmin email reset; portal password + OTP reset |
| Invoice / statement PDFs | Server-side A4, tenant branding, ledger-backed totals |
| AI MikroTik | Implemented (template + xAI if key present) |
| Postgres RLS | Implemented and tested (SET ROLE / non-superuser). Preview PGLite is superuser. |
