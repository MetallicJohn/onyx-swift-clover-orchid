# Database

Authoritative migrations:

| File | Scope |
|---|---|
| 0001_auth.sql | Better Auth |
| 0002_isp.sql | tenants, customers, packages, services, invoices, payments, routers, tickets, audit |
| 0003_notifications.sql | templates + logs |
| 0004_ops.sql | providers, RADIUS, agent, hotspot, CPE, loyalty, resellers |
| 0005_messaging.sql | messaging_settings |
| 0006_hardening.sql | active tenant, ledger, allocations, WG peers, sealed secret columns, command audit |

Rollback: restore DB backup from before the migration; 0006 is additive (`IF NOT EXISTS`). Runtime `CREATE TABLE` during requests is removed.
