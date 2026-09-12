-- Per-ISP CWMP credentials. The OLT pushes these onto ONUs so they inform GenieACS.

create table if not exists acs_isp_credentials (
  tenant_id text primary key references tenants(id) on delete cascade,
  cwmp_url text not null default '',
  username text not null default '',
  password_ref text not null default '',
  connreq_user text not null default '',
  connreq_pass_ref text not null default '',
  inform_interval integer not null default 300,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint acs_isp_inform check (inform_interval >= 30 and inform_interval <= 86400)
);

do $$
begin
  grant select, insert, update, delete on acs_isp_credentials to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table acs_isp_credentials enable row level security;
  alter table acs_isp_credentials force row level security;
  drop policy if exists tenant_isolation on acs_isp_credentials;
  create policy tenant_isolation on acs_isp_credentials
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
