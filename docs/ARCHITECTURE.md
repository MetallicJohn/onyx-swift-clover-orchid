# Gridline architecture (living)

Last updated: 2026-09-09 — CR-003 access-service + command approval.

## Authoritative backend

**TanStack Start + TypeScript + PostgreSQL/PGLite is the only production application backend.**

`artifacts/isp-saas/backend` (Django) is **legacy/reference**. Do not add production models there. Useful ideas (permission codes, tenant settings) were adapted into `src/lib/isp/rbac.ts` and tenant context.

## Shape

Modular monolith. Domains talk through `emit` / `on` (`src/lib/isp/events.ts`).

```
Payments ──emit──► payment.confirmed ──► Access, Loyalty, Notifications
Services ──emit──► service.changed ──► RADIUS, MikroTik agent
```

STK adapters register by kind (`src/lib/isp/providers.ts`).

## Tenant context

Active tenant is stored in `user_active_tenant` and **must be a membership**. Switching is explicit (`switchTenant`). First-login bootstrap persists the first membership, then never silently re-picks with `LIMIT 1`.

## Schema

Versioned SQL only: `migrations/0001_*.sql` … `0006_hardening.sql`. Request handlers do not `CREATE TABLE` / `ALTER TABLE`.

## Secrets

`src/lib/isp/secrets.ts` — AES-256-GCM (`enc:v1:`). Decrypt only server-side. APIs return hints.

## Payments

Live STK is confirmed only by provider callback or a successful provider query. Simulated `ws_*` checkouts cannot confirm on a live provider. Duplicate `payments.reference` is unique per tenant.

## Network

SaaS → WireGuard (real X25519 keys) → agent pull → MikroTik REST/script. FreeRADIUS and GenieACS remain **external** services; this app holds adapters and desired state only.
