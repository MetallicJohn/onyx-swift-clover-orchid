# Traffic monitoring

Telemetry answers “how is the network performing right now and historically?”
Usage accounting answers “how much should we bill?” Those stay separate.

## Architecture

```
RADIUS accounting / batched RouterOS REST / (SNMP, NetFlow stubs)
        │
        ▼
 Traffic collector  →  Redis live + short ring
        │
        ▼
 1-minute PG buckets  →  hourly / daily aggregates
        │
        ▼
 Customer drawer / router panel  (never scans live samples for billing)
```

Source priority (configurable): RADIUS accounting → RouterOS PPP/REST → SNMP → NetFlow.

The collector runs in-process via `POST /api/internal/traffic` (single VPS sidecar today). Move it later by pointing `ISPSOLUTIONS_INTERNAL_URL` at the application VPS — same contract.

## Database

| Table | Role | Retention |
|---|---|---|
| `traffic_minute` | Short-term 1-minute counters + rates | `traffic_short_hours` (default 24h) |
| `traffic_hourly` | Service / customer / router hourly rollup | `traffic_hourly_days` (default 90) |
| `traffic_daily` | Daily rollup | `traffic_daily_days` (default 730) |
| `router_metrics` | Router CPU/RAM/uptime/PPP | short-term |
| `interface_metrics` | Per-interface counters | short-term |
| `traffic_samples` | Legacy; collectors no longer insert here | purged with short-term |
| `services.bundle_used_mb` | **Billing authority** from RADIUS accounting | service lifetime |
| `radius_sessions` | Authoritative session bytes / online | session lifetime |

All new tables have `tenant_id` + RLS. Rollback: restore the pre-0047 backup; tables are additive.

## Redis

| Key | Value | TTL |
|---|---|---|
| `traffic:live:{tenant}:{username}` | Latest mapped sample + rates | 3 × realtime interval |
| `traffic:short:{tenant}:{username}` | Ring of spark points | short-term hours |
| `traffic:router:{tenant}:{routerId}` | Latest router snapshot | 3 × router interval |
| `traffic:router:short:{tenant}:{routerId}` | Short CPU/PPP ring | short-term hours |

Redis is optional. If it is down the collector still upserts minutes; the drawer falls back to RADIUS sessions and does not fake rates. Billing is unaffected.

## Collector and workers

| Job | Queue | What |
|---|---|---|
| `traffic.collect` | traffic | Snapshot RADIUS → Redis + minute |
| `traffic.router.poll` | traffic | Batched MikroTik REST per router |
| `traffic.aggregate.hourly` | traffic | Idempotent minute → hourly |
| `traffic.aggregate.daily` | traffic | Idempotent hourly → daily |
| `maintenance.retention` | maintenance | Purge by configured retention |

Sidecar `deploy/vps/collector.mjs` POSTs `{ collectorId }` to `/api/internal/traffic`. Optional `action`: `snapshot` (default), `router-poll`, `aggregate`, `retain`.

## APIs

| Endpoint | Auth | Result |
|---|---|---|
| `customerTrafficFn` | `traffic.view` | Live lines, freshness, rates if known |
| `customerTrafficHistoryFn` | `traffic.view` | Hourly aggregates only |
| `routerTelemetryFn` | `traffic.view` or `routers.read` | Stored router/interface metrics |
| `GET/POST /api/internal/traffic` | `INTERNAL_SERVICE_TOKEN` | Health / collect |

Live payload includes `timestamp`/`collected_at`, `source`, `fresh`. Missing rates are `null` (UI: “Measuring…” or “—”), never invented Mbps.

## UI

- Customer / service **Realtime traffic** drawer: download/upload, session usage, duration, last seen, router, IP, access type, spark from the Redis ring, hourly chart from `traffic_hourly`.
- **Routers** page: monitoring panel (CPU, memory, uptime, PPPoE, interfaces, mapped sessions). Stale samples are labelled stale.

## Scaling

Single VPS: compose `collector` + `worker` next to web (default).

Later:

| VPS | Runs |
|---|---|
| Application | web, Redis optional, workers optional |
| Database | Postgres |
| Network services | RADIUS, GenieACS |
| Traffic collector | `compose.traffic-collector.yml` — HTTP to app only |
| Workers | aggregation / retention |

No localhost fallbacks in production. Hosts come from env / stored `api_host` / WireGuard overlay.

## Security

MikroTik REST only to stored `api_host` or WG overlay (loopback rejected). Passwords, SNMP communities, and tokens are never logged (`obs.ts` redacts). Tenant isolation via RLS and Redis key prefixes. Unmapped sessions are not shown under another customer.

## Failure

| Failure | Behaviour |
|---|---|
| Collector down | Last Redis/minute sample ages out; drawer uses RADIUS; billing intact |
| Redis down | Minutes still persist; live cache skipped; app stays up |
| Router unreachable | Last-known metrics kept; status stale/error; no zero CPU invented |
| Duplicate collect | Minute upsert + job idempotency keys |
| Delayed RADIUS | Accounting still applies deltas on `radius_sessions.id` |

## Tests

`traffic-collector.test.ts`, `traffic-format.test.ts`, `jobs.test.ts` — ingestion, mapping, RLS, Redis ring, aggregation idempotency, billing isolation, SNMP/NetFlow stubs, batched router poll, 80-session collect.
