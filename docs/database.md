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
| 0057_acs_service_provision.sql | Service Wi-Fi SSID/password; Inform WAN+Wi-Fi auto-provision |
| 0058_router_desk.sql | Router vendor/enabled/archive; IP pool code, gateway, range, VLAN, access type, status |
| 0045_jobs_and_traffic.sql | `job_queue`, `traffic_samples`, `traffic_collectors` |
| 0046_ispsolutions_role.sql | Rename RLS role and router API default to `ispsolutions` |
| 0047_traffic_monitoring.sql | Minute/hourly/daily telemetry, router and interface metrics |

Rollback: restore a **verified** custom dump from before the migration (`deploy/vps/restore.sh --i-understand-this-overwrites-live-data`). Do not auto-restore on a failed deploy — roll the application SHA back and keep the live data. 0006 is additive (`IF NOT EXISTS`). Runtime `CREATE TABLE` during requests is removed.

Connection pooling, TLS, and moving Postgres to another VPS: [distributed.md](distributed.md). Use a non-superuser `DATABASE_URL`. Migrations: `node scripts/migrate.mjs` (web entrypoint; workers set `SKIP_MIGRATE=1`). Pending SQL is scanned for `DROP TABLE` / `TRUNCATE` / `DELETE FROM` / `DROP COLUMN` and blocked in production. Backup/restore: `deploy/vps/backup.sh` / `restore.sh`. No automatic failover. Full procedure: [disaster-recovery.md](disaster-recovery.md).
