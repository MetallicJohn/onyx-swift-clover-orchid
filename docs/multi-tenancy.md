# Multi-tenancy

Every ISP-owned row has `tenant_id`. The server derives tenant from the authenticated user + `user_active_tenant`, never from a client-supplied tenant id on a resource mutation.

- `listMemberships` / `setActiveTenant` / `resolveActiveTenant` in `src/lib/isp/tenant-context.ts`
- Membership is re-checked on every switch
- Queries include `where tenant_id = ${context.tenantId}`
- Cross-tenant access throws `Not found` (`assertTenantMatch`)

Platform records (auth users, saas_plans) are global. ISP customers, invoices, routers, RADIUS, tickets, ACS rows are tenant-owned.

Row Level Security is **architecture-ready** (tenant_id present) but **not enabled** on PGLite. Enable RLS on Neon/Postgres in a later milestone.
