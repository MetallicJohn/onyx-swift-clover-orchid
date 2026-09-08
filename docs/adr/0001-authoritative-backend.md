# ADR-0001 Authoritative backend

**Status:** accepted  
**CR:** CR-001

## Context
The repo contained TanStack Start (live app) and a Django DRF skeleton under `artifacts/isp-saas/backend`.

## Decision
TanStack Start + PostgreSQL is the only production backend. Django is frozen as reference (RBAC/permission catalog ideas).

## Consequences
One source of business logic. No dual model maintenance. Network agents stay out-of-process.
