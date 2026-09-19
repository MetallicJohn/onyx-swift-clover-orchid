-- Router management plane: enrollment states, sealed credentials, WireGuard/API/agent health.
-- Additive. Does not touch GenieACS, RADIUS, billing, or customer WAN.

alter table routers add column if not exists serial_number text not null default '';
alter table routers add column if not exists board_name text not null default '';
alter table routers add column if not exists architecture text not null default '';
alter table routers add column if not exists enroll_state text not null default 'PENDING';
alter table routers add column if not exists last_handshake_at timestamptz;
alter table routers add column if not exists wg_rx_bytes bigint not null default 0;
alter table routers add column if not exists wg_tx_bytes bigint not null default 0;
alter table routers add column if not exists api_verified_at timestamptz;
alter table routers add column if not exists api_last_error text not null default '';
alter table routers add column if not exists last_api_check_at timestamptz;
alter table routers add column if not exists agent_last_ok_at timestamptz;
alter table routers add column if not exists agent_last_fail_at timestamptz;
alter table routers add column if not exists agent_fail_count integer not null default 0;
alter table routers add column if not exists last_error text not null default '';

alter table routers alter column api_user set default 'ispsolutions-agent';
alter table routers alter column api_port set default 8728;

create unique index if not exists routers_tenant_overlay_uq
  on routers (tenant_id, wg_address)
  where wg_address <> '' and archived_at is null;

create table if not exists router_enrollments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null references routers(id) on delete cascade,
  state text not null,
  actor_user_id text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists router_enrollments_router_idx
  on router_enrollments (router_id, created_at desc);

create table if not exists router_credentials (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null references routers(id) on delete cascade,
  kind text not null,
  secret_sealed text not null default '',
  rotated_at timestamptz not null default now(),
  unique (router_id, kind)
);

create table if not exists router_health_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null references routers(id) on delete cascade,
  wireguard text not null default 'unknown',
  api text not null default 'unknown',
  agent text not null default 'unknown',
  handshake_age_sec integer not null default -1,
  cpu_pct integer not null default 0,
  uptime_hours integer not null default 0,
  memory_pct integer not null default 0,
  last_error text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists router_health_snapshots_router_idx
  on router_health_snapshots (router_id, created_at desc);

alter table wireguard_peers add column if not exists last_handshake_at timestamptz;
alter table wireguard_peers add column if not exists rx_bytes bigint not null default 0;
alter table wireguard_peers add column if not exists tx_bytes bigint not null default 0;
