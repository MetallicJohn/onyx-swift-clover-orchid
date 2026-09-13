-- PPPoE assign → RADIUS → GenieACS WAN → session → NAS easy queue.
-- Service stays pending until a RADIUS session is seen.

alter table cpe_devices add column if not exists service_id text references services(id) on delete set null;

create table if not exists service_provisioning (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  service_id text not null references services(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  cpe_id text references cpe_devices(id) on delete set null,
  router_id text references routers(id) on delete set null,
  username text not null default '',
  password_hint text not null default '',
  radius_status text not null default 'pending',
  acs_status text not null default 'pending',
  acs_task_id text not null default '',
  session_status text not null default 'pending',
  queue_status text not null default 'pending',
  framed_ip text not null default '',
  overall text not null default 'pending',
  last_error text not null default '',
  steps text not null default '[]',
  updated_at timestamptz not null default now(),
  unique (tenant_id, service_id)
);
create index if not exists service_provisioning_tenant_idx on service_provisioning (tenant_id, overall);

do $$
begin
  grant select, insert, update, delete on service_provisioning to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table service_provisioning enable row level security;
  alter table service_provisioning force row level security;
  drop policy if exists tenant_isolation on service_provisioning;
  create policy tenant_isolation on service_provisioning
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;
