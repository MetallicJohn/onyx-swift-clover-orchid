-- Four-tier traffic monitoring: minute/hourly/daily aggregates and router
-- telemetry. Realtime samples stay in Redis. Billing usage stays on
-- radius_sessions + services.bundle_used_mb — these tables are never the
-- billing authority.

alter table traffic_collectors add column if not exists last_router_ok_at timestamptz;
alter table traffic_collectors add column if not exists samples_ok bigint not null default 0;
alter table traffic_collectors add column if not exists samples_dropped bigint not null default 0;

create table if not exists traffic_minute (
  id text primary key,
  tenant_id text not null,
  collector_id text not null default 'default',
  identity_key text not null,
  customer_id text not null default '',
  service_id text not null default '',
  package_id text not null default '',
  access_method text not null default '',
  username text not null default '',
  framed_ip text not null default '',
  nas_ip text not null default '',
  router_id text not null default '',
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  delta_in bigint not null default 0,
  delta_out bigint not null default 0,
  peak_up_bps bigint not null default 0,
  peak_down_bps bigint not null default 0,
  avg_up_bps bigint not null default 0,
  avg_down_bps bigint not null default 0,
  samples int not null default 1,
  online_ms int not null default 0,
  source text not null default 'radius-accounting',
  bucket_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists traffic_minute_bucket_uq
  on traffic_minute (tenant_id, identity_key, bucket_at);
create index if not exists traffic_minute_service_idx
  on traffic_minute (tenant_id, service_id, bucket_at desc);
create index if not exists traffic_minute_customer_idx
  on traffic_minute (tenant_id, customer_id, bucket_at desc);

create table if not exists traffic_hourly (
  id text primary key,
  tenant_id text not null,
  subject_type text not null,
  subject_id text not null,
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  peak_up_bps bigint not null default 0,
  peak_down_bps bigint not null default 0,
  avg_up_bps bigint not null default 0,
  avg_down_bps bigint not null default 0,
  online_ms bigint not null default 0,
  session_count int not null default 0,
  samples int not null default 0,
  bucket_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists traffic_hourly_bucket_uq
  on traffic_hourly (tenant_id, subject_type, subject_id, bucket_at);
create index if not exists traffic_hourly_subject_idx
  on traffic_hourly (tenant_id, subject_type, bucket_at desc);

create table if not exists traffic_daily (
  id text primary key,
  tenant_id text not null,
  subject_type text not null,
  subject_id text not null,
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  peak_up_bps bigint not null default 0,
  peak_down_bps bigint not null default 0,
  avg_up_bps bigint not null default 0,
  avg_down_bps bigint not null default 0,
  online_ms bigint not null default 0,
  session_count int not null default 0,
  samples int not null default 0,
  bucket_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists traffic_daily_bucket_uq
  on traffic_daily (tenant_id, subject_type, subject_id, bucket_at);
create index if not exists traffic_daily_subject_idx
  on traffic_daily (tenant_id, subject_type, bucket_at desc);

create table if not exists router_metrics (
  id text primary key,
  tenant_id text not null,
  router_id text not null,
  collector_id text not null default 'default',
  cpu_pct int,
  ram_pct int,
  uptime_seconds bigint,
  ppp_active int,
  customers_online int,
  source text not null default 'routeros',
  last_error text not null default '',
  bucket_at timestamptz not null,
  collected_at timestamptz not null default now()
);

create unique index if not exists router_metrics_bucket_uq
  on router_metrics (tenant_id, router_id, bucket_at);
create index if not exists router_metrics_live_idx
  on router_metrics (tenant_id, router_id, collected_at desc);

create table if not exists interface_metrics (
  id text primary key,
  tenant_id text not null,
  router_id text not null,
  interface_name text not null,
  interface_type text not null default '',
  rx_bytes bigint not null default 0,
  tx_bytes bigint not null default 0,
  rx_bps bigint,
  tx_bps bigint,
  running boolean not null default false,
  bucket_at timestamptz not null,
  collected_at timestamptz not null default now()
);

create unique index if not exists interface_metrics_bucket_uq
  on interface_metrics (tenant_id, router_id, interface_name, bucket_at);
create index if not exists interface_metrics_router_idx
  on interface_metrics (tenant_id, router_id, bucket_at desc);

do $$
begin
  grant select, insert, update, delete on traffic_minute to ispsolutions;
  grant select, insert, update, delete on traffic_hourly to ispsolutions;
  grant select, insert, update, delete on traffic_daily to ispsolutions;
  grant select, insert, update, delete on router_metrics to ispsolutions;
  grant select, insert, update, delete on interface_metrics to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['traffic_minute','traffic_hourly','traffic_daily','router_metrics','interface_metrics']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (
           current_setting(''app.bypass_rls'', true) = ''on''
           or tenant_id = current_setting(''app.tenant_id'', true)
         )
         with check (
           current_setting(''app.bypass_rls'', true) = ''on''
           or tenant_id = current_setting(''app.tenant_id'', true)
         )',
      t
    );
  end loop;
end $$;
