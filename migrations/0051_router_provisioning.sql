-- MikroTik router provisioning: hashed bootstrap tokens, config versions,
-- events, IP pool assignments, and per-tenant settings.

alter table routers add column if not exists model text not null default '';
alter table routers add column if not exists ros_version text not null default '';
alter table routers add column if not exists site_pop text not null default '';
alter table routers add column if not exists management_ip text not null default '';
alter table routers add column if not exists provisioning_status text not null default 'pending';
alter table routers add column if not exists provision_token_hash text not null default '';
alter table routers add column if not exists provision_token_hint text not null default '';
alter table routers add column if not exists provision_token_expires_at timestamptz;
alter table routers add column if not exists provision_token_revoked_at timestamptz;
alter table routers add column if not exists provisioned_at timestamptz;
alter table routers add column if not exists config_version integer not null default 0;

update routers set site_pop = location where site_pop = '' and location <> '';

create unique index if not exists routers_provision_token_hash_uq
  on routers (provision_token_hash)
  where provision_token_hash <> '';

create unique index if not exists routers_wg_address_uq
  on routers (tenant_id, wg_address)
  where wg_address <> '';

create table if not exists tenant_router_provisioning (
  tenant_id text primary key references tenants(id) on delete cascade,
  enabled boolean not null default true,
  token_ttl_hours integer not null default 72,
  require_https boolean not null default true,
  allow_pool_push boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists router_config_versions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null references routers(id) on delete cascade,
  version integer not null,
  kind text not null,
  script text not null,
  checksum text not null,
  generated_by text not null default '',
  created_at timestamptz not null default now(),
  unique (router_id, version)
);
create index if not exists router_config_versions_tenant_idx
  on router_config_versions (tenant_id, router_id, version desc);

create table if not exists router_provision_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null references routers(id) on delete cascade,
  event text not null,
  actor_user_id text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists router_provision_events_router_idx
  on router_provision_events (tenant_id, router_id, created_at desc);

create table if not exists router_pool_assignments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null references routers(id) on delete cascade,
  pool_id text not null references ip_pools(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (router_id, pool_id)
);
create index if not exists router_pool_assignments_tenant_idx
  on router_pool_assignments (tenant_id, router_id);

do $$
begin
  grant select, insert, update, delete on table tenant_router_provisioning to ispsolutions;
  grant select, insert, update, delete on table router_config_versions to ispsolutions;
  grant select, insert, update, delete on table router_provision_events to ispsolutions;
  grant select, insert, update, delete on table router_pool_assignments to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenant_router_provisioning',
    'router_config_versions',
    'router_provision_events',
    'router_pool_assignments'
  ]
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
