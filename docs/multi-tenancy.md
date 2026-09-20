Every ISP-owned row has `tenant_id`. The server derives tenant from the authenticated user + `user_active_tenant`, never from a client-supplied tenant id on a resource mutation.

- `listMemberships` / `setActiveTenant` / `resolveActiveTenant` in `src/lib/isp/tenant-context.ts`
- Membership is re-checked on every switch
- Queries include `where tenant_id = ${context.tenantId}`
- Cross-tenant access throws `Not found` (`assertTenantMatch`)

Platform records (auth users, saas_plans) are global. ISP customers, invoices, routers, RADIUS, tickets, ACS rows are tenant-owned.

Row Level Security is **enabled and forced** on tenant-owned tables (`ENABLE` + `FORCE RLS`, policy `tenant_isolation`). Production `DATABASE_URL` must be a non-superuser (`ispsolutions`, `NOBYPASSRLS`). Each HTTP request and job run pins one Postgres client (`withDbSession`) so `app.tenant_id` / `app.bypass_rls` apply to every query in that unit of work, then those GUCs are cleared before the client returns to the pool.
