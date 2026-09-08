# Security

## AuthN / AuthZ
Better Auth sessions. Server functions use `authMiddleware`. Authorization is permission-based (`src/lib/isp/rbac.ts`), not role-name string compares in UI.

Technician: tickets/jobs only. Finance: invoices/payments. Network engineer: routers/RADIUS. Owner/admin: all.

## Secrets
Sealed at rest (`enc:v1:`). Never returned to the browser. Redacted in API DTOs.

## Payments
Frontend cannot confirm a live STK. Webhooks are tenant-slug addressed; duplicate callbacks are idempotent.

## Agent
Enroll token is a capability. Router list does not return enroll tokens. Copy-script is the one-time reveal.

## OWASP notes (M0.5)
SQL is parameterized. XSS: React escaping. CSRF: same-site middleware (`assertSameSiteRequest`). SSRF: MikroTik REST only to configured `api_host` / WG address. Command injection: RouterOS values are quoted via `rosQuote`. Do not log secrets.
