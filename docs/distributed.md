# Distributed deployment

Same application codebase for a single VPS and for a later split. Move a service by changing endpoints in `ispsolutions.env`, not by forking the app.

## Architecture

```
                    operators / customers
                            |
                         Caddy :80/:443
                            |
              Application VPS (web + optional Redis + workers)
                 |          |           |            |
                 |          |           |            +-- WireGuard hub :51820 (host)
                 |          |           |
                 |          |           +-- MikroTik REST via WG overlay 10.200.0.0/24
                 |          |
                 |          +-- GenieACS NBI (private)
                 |          +-- FreeRADIUS REST callback
                 |
        PostgreSQL VPS          Network-services VPS         Collector VPS
        :5432 private           Mongo + GenieACS             snapshots via
                                FreeRADIUS :1812/1813        /api/internal/traffic
                                cwmp-edge :7551-7999
```

Frontend never talks to Postgres, Redis, Mongo, RADIUS UDP, or GenieACS NBI.

## Stages

| Stage | Where | Compose |
|---|---|---|
| 1 Single VPS | Everything | `deploy/vps/docker-compose.yml` or `compose.single-vps.yml` |
| 2 App + data | Web/Caddy/Redis/workers vs Postgres + RADIUS + GenieACS | `compose.application.yml` + `compose.database.yml` + `compose.network-services.yml` |
| 3 Full split | Plus dedicated workers, collectors, optional Redis bind | `compose.workers.yml` + `compose.traffic-collector.yml` |

Preview (no `DATABASE_URL`) still uses PGLite. Vercel still uses Neon + `/api/v1/cron/billing` (enqueue then process inline).

## Environment

Role examples live in `deploy/vps/env/*.env.example`. Required in production: `APP_SECRET` (or `BETTER_AUTH_SECRET`), `DATABASE_URL`. Everything else degrades when unset — it does **not** silently become `localhost` or `http://web:3000`.

| Variable | Single VPS | Split |
|---|---|---|
| `DATABASE_URL` | `postgres://…@postgres:5432/ispsolutions` | private IP / VPN of DB VPS |
| `DATABASE_SSL_MODE` | `disable` | `require` or `verify-full` |
| `REDIS_URL` | `redis://:pass@redis:6379/0` | Redis VPS or keep on app VPS |
| `ISPSOLUTIONS_INTERNAL_URL` | `http://web:3000` | `http://<app-private>:3000` |
| `GENIEACS_NBI_URL` | `http://genieacs:7557` | `http://<net-private>:7557` |
| `RADIUS_HOST` | `freeradius` | network VPS address |
| `INTERNAL_SERVICE_TOKEN` | shared | shared, rotate together |
| `MONGODB_URL` | optional probe | optional; GenieACS owns Mongo |

Secrets stay in `ispsolutions.env` (mode 600). Never log them.

## Adapters

| Service | Module | Notes |
|---|---|---|
| PostgreSQL | `src/lib/db.ts` + `postgresPoolOptions` | one pool, SSL, timeouts, RLS unchanged |
| Redis | `src/lib/isp/redis.ts` | optional; in-memory if unset |
| Jobs | `src/lib/isp/jobs.ts` | Postgres queue, idempotency, SKIP LOCKED |
| RADIUS | `src/lib/isp/radius-rest.ts` | host/ports from env; REST still in-app |
| GenieACS | `src/lib/isp/acs.ts`, `acs-nbi.ts` | NBI URL from tenant row then env |
| Traffic | `src/lib/isp/traffic-collector.ts` | Redis live + minute/hourly/daily; dashboard falls back to `radius_sessions` |
| MikroTik | `src/lib/isp/mikrotik.ts` | `MIKROTIK_API_TIMEOUT` |
| Health | `/api/v1/health` live, `/api/v1/ready` deps | degraded ≠ false success |

Workers apply the same `applyRls` rules as web handlers. Remote Postgres does not bypass RLS.

## Internal APIs

Authenticated with `Authorization: Bearer $INTERNAL_SERVICE_TOKEN` (or `ACS_EDGE_TOKEN`).

- `POST /api/internal/jobs` — claim and run queued jobs
- `GET /api/internal/jobs` — queue depth
- `POST /api/internal/traffic` — snapshot RADIUS sessions (optional `action`: `router-poll`, `aggregate`, `retain`)
- `GET /api/internal/traffic` — collector freshness
- existing `GET /api/internal/acs-ports`, `POST /api/internal/acs-auth`

Caddy blocks `/api/internal*` on the public hostname. Sidecars and workers use `ISPSOLUTIONS_INTERNAL_URL` on the Docker/VPN network.

## Health

- Liveness `GET /api/v1/health` — process + database
- Readiness `GET /api/v1/ready` — database required; Redis/GenieACS/Mongo/collector are reported and may mark `degraded`
- Optional `HEALTHCHECK_TOKEN` on ready

Statuses: `ok`, `error`, `not_configured`, `stale`, `degraded`. Missing Redis is `not_configured`, not a failed deploy.

## Security and firewall

Prefer WireGuard (`10.200.0.0/24`) or the provider private network between VPS servers.

| Flow | Port | Bind |
|---|---|---|
| Public HTTPS | 80/443 | 0.0.0.0 |
| WireGuard hub | 51820/udp | 0.0.0.0 |
| RADIUS | 1812/1813 udp | 0.0.0.0 (NAS sources) |
| TR-069 | 7551-7999/tcp | 0.0.0.0 |
| Postgres | 5432 | private IP of DB VPS, allow app VPS only |
| Redis | 6379 | loopback or private, allow app/workers only |
| Mongo | 27017 | loopback on network VPS |
| GenieACS NBI | 7557 | private, allow app VPS only |
| Internal HTTP | 3000 | private, allow workers/collectors/GenieACS/FreeRADIUS |

Do not publish NBI, Mongo, Redis, or Postgres on a public interface. Rotate `INTERNAL_SERVICE_TOKEN`, RADIUS NAS secrets, and DB passwords independently.

No automatic Postgres failover. Promote a replica only with a planned cutover so billing and RADIUS accounting stay consistent.

## Single-VPS

```bash
sudo bash /opt/ispsolutions/deploy/vps/install.sh --domain ops.example.co.ke --email you@example.co.ke
# compose file: deploy/vps/docker-compose.yml
curl -fsS https://ops.example.co.ke/api/v1/health
sudo bash /opt/ispsolutions/deploy/vps/backup.sh
```

Migrate independently: `docker compose exec web node scripts/migrate.mjs` or restart web (entrypoint migrates unless `SKIP_MIGRATE=1`).

## Moving a service later

### PostgreSQL

1. Provision the DB VPS, private NIC / WG, `compose.database.yml`.
2. `POSTGRES_BIND=<private-ip>`. TLS if the path leaves a trusted LAN (`DATABASE_SSL_MODE=require`).
3. Restore `backup.sh` output (or streaming replica, then promote).
4. `node scripts/migrate.mjs` against the new URL.
5. Point `DATABASE_URL` on the app VPS; restart web/workers.
6. Confirm login, RLS (another ISP's customers hidden), billing, payments, RADIUS auth.
7. Keep the old volume until the next backup succeeds.

### Redis

1. Deploy Redis (app compose already has it, or its own VPS).
2. Set `REDIS_URL` / `REDIS_PASSWORD` / `REDIS_TLS`.
3. Restart web and workers. Queues stay in Postgres — Redis outage is degraded cache, not a billing outage.

### FreeRADIUS

1. `compose.network-services.yml` on the network VPS.
2. `ISPSOLUTIONS_URL=http://<app-private>:3000` with the tenant RADIUS API key.
3. `RADIUS_HOST=<network-vps>` on the app. MikroTik NAS still UDP 1812/1813 to that VPS.
4. Test PPPoE/static/hotspot authorize, accounting, and disconnect (agent CoA). Distinguish daemon down vs Access-Reject.

### GenieACS + Mongo

1. Move mongo + genieacs + cwmp-edge together (Mongo stays local to GenieACS).
2. Set `GENIEACS_NBI_URL` and `GENIEACS_CWMP_URL` on the app. Keep NBI private.
3. Point `ISPSOLUTIONS_INTERNAL_URL` on GenieACS/cwmp-edge at the app private URL (digest auth extension).
4. Sync from ACS, reboot a test CPE, confirm task `sent` vs CPE still pending.

### Traffic collectors

1. `compose.traffic-collector.yml` with a unique `COLLECTOR_ID`.
2. `ISPSOLUTIONS_INTERNAL_URL` + `INTERNAL_SERVICE_TOKEN`.
3. Interval via `TRAFFIC_COLLECTION_INTERVAL`. Duplicate buckets are rejected.
4. Customer traffic panel shows live / last updated / data unavailable — never estimated bps.

### Workers

1. `compose.workers.yml`. Horizontal scale with different `WORKER_ID`s.
2. Postgres `SKIP LOCKED` prevents double billing. Idempotency keys are per tenant per day for `billing.cycle`.

## Commands

```bash
# migrate (web role only)
docker compose -f deploy/vps/docker-compose.yml --env-file ispsolutions.env exec web node scripts/migrate.mjs

# backup / restore
sudo bash deploy/vps/backup.sh
sudo bash deploy/vps/restore.sh /opt/ispsolutions/backups/ispsolutions-YYYYMMDDTHHMMSSZ.sql.gz

# split example (each VPS)
docker compose -f deploy/vps/compose.database.yml --env-file ispsolutions.env up -d
docker compose -f deploy/vps/compose.network-services.yml --env-file ispsolutions.env up -d
docker compose -f deploy/vps/compose.application.yml --env-file ispsolutions.env up -d
```

## Limitations

- Redis client is a small RESP helper (PING/GET/SET/DEL/SET NX), not a full cluster client.
- No SNMP collector yet — sources are RADIUS accounting (and MikroTik REST where the agent already runs).
- No automatic multi-master Postgres.
- CoA is still the MikroTik agent path, not a `radclient` packet from this repo.
- `/api/internal/*` must stay off Caddy; split workers need `WEB_BIND` on a private address.
