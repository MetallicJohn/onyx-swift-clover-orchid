# Security

## AuthN / AuthZ
Better Auth sessions. Server functions use `authMiddleware`. Authorization is permission-based (`src/lib/isp/rbac.ts`), not role-name string compares in UI.

Technician: tickets/jobs only. Finance: invoices/payments. Network engineer: routers/RADIUS. Owner/admin: all.

Sign-in CSRF uses Better Auth `trustedOrigins`. Custom domains are allowed when the browser Origin matches the request host (or a saved tenant `public_base_url`). Cross-site Origins are still rejected. Do not set `disableCSRFCheck`.


## Secrets
Sealed at rest (`enc:v1:`). Never returned to the browser. Redacted in API DTOs.
`APP_SECRET` or `BETTER_AUTH_SECRET` is required in production and whenever `DATABASE_URL` is set. There is no published development default.

## Row-level security
Tenant-owned tables have `ENABLE` + `FORCE ROW LEVEL SECURITY`. Policies allow `app.bypass_rls=on` (migrations/bootstrap) or `tenant_id = current_setting('app.tenant_id')`. `requireWorkspace`, webhooks, and the agent set the GUC after resolving the tenant.

## Payments
Frontend cannot confirm a live STK. Webhooks are tenant-slug addressed; duplicate callbacks are idempotent.

## Agent
Enroll token is a capability. Router list does not return enroll tokens. Copy-script is the one-time reveal.

## OWASP notes (M0.5)
SQL is parameterized. XSS: React escaping. CSRF: same-site middleware (`assertSameSiteRequest`). SSRF: MikroTik REST only to configured `api_host` / WG address. Command injection: RouterOS values are quoted via `rosQuote`. Do not log secrets.
