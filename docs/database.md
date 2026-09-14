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

| 0044_acs_tr069_security.sql | ACS URL scheme, CPE digest, URL lock |
| 0045_jobs_and_traffic.sql | `job_queue`, `traffic_samples`, `traffic_collectors` |

Rollback: restore DB backup from before the migration; 0006 is additive (`IF NOT EXISTS`). Runtime `CREATE TABLE` during requests is removed.

Connection pooling, TLS, and moving Postgres to another VPS: [distributed.md](distributed.md). Use a non-superuser `DATABASE_URL`. Migrations: `node scripts/migrate.mjs` (web entrypoint; workers set `SKIP_MIGRATE=1`). Backup/restore: `deploy/vps/backup.sh` / `restore.sh`. No automatic failover.
