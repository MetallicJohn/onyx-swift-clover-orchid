# Disaster recovery

Production ISP data lives in Docker volumes on the VPS (`pgdata`, `mongodata`, `caddy_data`). Git is not a backup of customers, invoices, payments, or routers.

## What a normal update does

`sudo bash /opt/ispsolutions/deploy/vps/update.sh --apply`

1. Takes a flock so two deploys cannot run at once.
2. Starts Postgres **without recreating the volume**.
3. `pg_dump --format=custom` to `/opt/ispsolutions/backups/ispsolutions-<utc>.dump`.
4. Verifies the dump (`PGDMP` header, size, `pg_restore --list`). Stops if verification fails.
5. Records row counts (tenants, customers, services, invoices, payments, routers, …).
6. Pulls `origin/main`.
7. Scans **pending** SQL. `DROP TABLE` / `TRUNCATE` / `DROP COLUMN` / `DELETE FROM` stop the deploy. The git SHA is rolled back. The database is not touched.
8. `docker compose up -d --build` (never `down -v`).
9. Web entrypoint applies additive migrations under `pg_advisory_lock`.
10. Health check. Failed health rolls **code** back. The dump is kept; the live database is **not** auto-restored.
11. Compares row counts. An unexpected decrease is `DEPLOYMENT FAILED / MANUAL REVIEW`.

## Restore (last resort)

Do not restore a dump over a live database that still has good data.

```bash
sudo bash /opt/ispsolutions/deploy/vps/restore.sh --i-understand-this-overwrites-live-data /opt/ispsolutions/backups/ispsolutions-YYYYMMDDTHHMMSSZ.dump
```

That flag is required. Restore stops web/workers, runs `pg_restore --clean --if-exists`, then starts them again.

Older `.sql.gz` dumps from before this change are still accepted.

## What is never run in production

- `docker compose down -v`
- `prisma migrate reset`, `db reset`, truncate, drop-and-recreate
- Demo/seed customers
- Automatic emptying of `demo_seeded` tenants (`NODE_ENV=production`)
- Regenerating WireGuard keys that already exist
- Overwriting `/opt/ispsolutions/ispsolutions.env` secrets (`ensure-env.sh` only appends missing keys)

Destructive SQL can be forced only with `ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS=1` in the env file after a verified backup and a written rollback plan.

## Off-box copies

Copy `/opt/ispsolutions/backups/*.dump` and `*.meta` off the VPS (object storage or another host). Retention on the VPS is 14 days. GitHub is not a substitute.
