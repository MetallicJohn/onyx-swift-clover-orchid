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
Frontend cannot confirm a live STK. Duplicate callbacks are idempotent. The tenant slug in the webhook URL is public (it is also the subdomain) and is not a credential.

Kopo Kopo signs the raw body with HMAC-SHA256 using the OAuth client secret. `POST /api/webhooks/kopokopo/:slug` rejects the request unless `X-KopoKopo-Signature` matches. Daraja does not sign callbacks, so M-Pesa still depends on the unguessable checkout id plus the amount and receipt checks in `callback-validate`. Do not treat the slug as authentication for either provider.

## Agent
Enroll token is a capability. Router list does not return enroll tokens. Copy-script is the one-time reveal.

## ACS / TR-069
CPE → ACS is HTTP digest against the per-ISP ACS username and password. Connection-request login is a separate secret written onto the ONU. NBI, Mongo, and the ACS auth endpoint stay on the private network (not published). Informs are not written to `audit_logs`. Optional HTTPS ACS URLs default off so existing OLT profiles keep working. URL lock rewrites the ONU ACS URL on inform so it cannot be redirected.

## OWASP notes (M0.5)
SQL is parameterized. XSS: React escaping. CSRF: `assertSameSiteRequest` blocks scripted cross-site calls. A state-changing request with no `Sec-Fetch-Site` must also send a same-host `Origin` or `Referer`, or a bearer token. SSRF: MikroTik REST only to configured `api_host` / WG address (collectors never take a URL from the client). Command injection: RouterOS values are quoted via `rosQuote`. Do not log secrets. Traffic Redis keys are tenant-prefixed; unmapped sessions are not attributed.

Responses set `X-Content-Type-Options`, `Referrer-Policy`, and a Content-Security-Policy. The public Caddy site also sets `X-Frame-Options` and `frame-ancestors 'self'`. The app itself does not set those framing headers, so the preview iframe can still load.

Rate limits use Redis `INCR` with a TTL when Redis is configured, so the cap is shared across instances. Without Redis, the in-process window is pruned so idle keys do not accumulate.

## Service-to-service
`INTERNAL_SERVICE_TOKEN` (or `ACS_EDGE_TOKEN`) on `/api/internal/*`. Caddy returns 404 for that prefix on the public hostname. Postgres, Redis, Mongo, and GenieACS NBI bind privately. Structured logs redact password/token/secret keys (`src/lib/isp/obs.ts`).

## Production deploy
Do not publish from Grok or an untested branch. GitHub Actions `publish-vps` SSHs only after green `checks` on `main`, using repo secrets (`VPS_HOST`, `VPS_SSH_KEY`). The VPS updater backs up Postgres before rebuild and rolls back the previous SHA if `/api/v1/health` fails. The deploy key never belongs in the app env file.

