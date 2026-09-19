-- Hotspot login-page settings + deploy jobs.
-- Dashboard aggregates reuse payments, radius_sessions, and routers.
-- Indexes keep tenant-scoped live-session and payment-by-time queries off sequential scans.

create table if not exists hotspot_portal_settings (
  tenant_id text primary key references tenants(id) on delete cascade,
  title text not null default '',
  welcome text not null default '',
  primary_color text not null default '',
  background_color text not null default '',
  text_color text not null default '',
  logo_data text not null default '',
  background_image text not null default '',
  font_family text not null default 'system-ui',
  show_voucher boolean not null default true,
  show_customer boolean not null default true,
  show_packages boolean not null default true,
  terms text not null default '',
  support_phone text not null default '',
  support_email text not null default '',
  payment_instructions text not null default '',
  custom_css text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists hotspot_deployments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null references routers(id) on delete cascade,
  command_id text,
  status text not null default 'queued',
  result text not null default '',
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hotspot_deployments_tenant_idx on hotspot_deployments (tenant_id, created_at desc);

create index if not exists radius_sessions_live_idx on radius_sessions (tenant_id) where stopped_at is null;
create index if not exists radius_sessions_started_idx on radius_sessions (tenant_id, started_at desc);
create index if not exists payments_tenant_paid_idx on payments (tenant_id, paid_at desc) where status = 'confirmed';

do $$
begin
  grant select, insert, update, delete on hotspot_portal_settings to ispsolutions;
  grant select, insert, update, delete on hotspot_deployments to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table hotspot_portal_settings enable row level security;
  alter table hotspot_portal_settings force row level security;
  drop policy if exists tenant_isolation on hotspot_portal_settings;
  create policy tenant_isolation on hotspot_portal_settings
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );

  alter table hotspot_deployments enable row level security;
  alter table hotspot_deployments force row level security;
  drop policy if exists tenant_isolation on hotspot_deployments;
  create policy tenant_isolation on hotspot_deployments
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
