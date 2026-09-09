-- FreeRADIUS REST adapter: per-tenant API key, NAS IP on routers, auth event log.
-- The daemon stays external. Gridline is authorize / accounting over HTTP.

alter table tenants add column if not exists radius_api_key text not null default '';

alter table routers add column if not exists nas_ip text not null default '';
alter table routers add column if not exists radius_secret text not null default '';

create table if not exists radius_auth_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  username text not null default '',
  nas_ip text not null default '',
  result text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists radius_auth_events_tenant_idx on radius_auth_events (tenant_id, created_at desc);

do $$
begin
  begin
    grant select, insert, update, delete on table radius_auth_events to gridline;
  exception
    when undefined_object then null;
    when insufficient_privilege then null;
  end;
end $$;

alter table radius_auth_events enable row level security;
alter table radius_auth_events force row level security;
drop policy if exists tenant_isolation on radius_auth_events;
create policy tenant_isolation on radius_auth_events
  using (
    current_setting('app.bypass_rls', true) = 'on'
    or tenant_id = current_setting('app.tenant_id', true)
  )
  with check (
    current_setting('app.bypass_rls', true) = 'on'
    or tenant_id = current_setting('app.tenant_id', true)
  );
