-- Superadmin / SaaS Management Console: database-driven plans, entitlements,
-- subscription lifecycle, platform audit, settings, infra telemetry, support access.
-- saas_plans already exists (0006) with id PK + unique code.

alter table saas_plans add column if not exists description text not null default '';
alter table saas_plans add column if not exists monthly_kes integer not null default 0;
alter table saas_plans add column if not exists annual_kes integer not null default 0;
alter table saas_plans add column if not exists trial_days integer not null default 0;
alter table saas_plans add column if not exists max_customers integer not null default 50;
alter table saas_plans add column if not exists max_routers integer not null default 5;
alter table saas_plans add column if not exists max_services integer not null default 0;
alter table saas_plans add column if not exists max_admins integer not null default 0;
alter table saas_plans add column if not exists max_storage_gb integer not null default 0;
alter table saas_plans add column if not exists api_requests_per_day integer not null default 0;
alter table saas_plans add column if not exists support_level text not null default 'community';
alter table saas_plans add column if not exists entitlements text not null default '{}';
alter table saas_plans add column if not exists status text not null default 'active';
alter table saas_plans add column if not exists sort_order integer not null default 0;
alter table saas_plans add column if not exists updated_at timestamptz not null default now();

insert into saas_plans (
  id, code, name, description, monthly_kes, annual_kes, trial_days,
  max_customers, max_routers, max_services, max_admins, max_storage_gb, api_requests_per_day,
  support_level, entitlements, status, sort_order
) values
  (
    'plan_trial', 'trial', 'Trial', '14 days to onboard your first sites.',
    0, 0, 14, 50, 5, 50, 3, 5, 1000, 'community',
    '{"pppoe":true,"hotspot":true,"static_ip":true,"radius":true,"mikrotik":true,"reports":true,"customer_portal":true}',
    'active', 10
  ),
  (
    'plan_starter', 'starter', 'Starter', 'Single-POP operators and neighbourhood ISPs.',
    4999, 49990, 0, 500, 20, 500, 8, 20, 5000, 'email',
    '{"pppoe":true,"hotspot":true,"static_ip":true,"radius":true,"mikrotik":true,"genieacs":true,"sms":true,"reports":true,"customer_portal":true,"technician":true,"api_access":true}',
    'active', 20
  ),
  (
    'plan_growth', 'growth', 'Growth', 'Multi-POP with room to scale.',
    14999, 149990, 0, 5000, 100, 5000, 25, 100, 25000, 'priority',
    '{"pppoe":true,"hotspot":true,"static_ip":true,"radius":true,"mikrotik":true,"genieacs":true,"whatsapp":true,"sms":true,"reports":true,"customer_portal":true,"reseller":true,"technician":true,"ai_assistant":true,"api_access":true}',
    'active', 30
  ),
  (
    'plan_professional', 'professional', 'Professional', 'Regional operators with SLA-backed support.',
    29999, 299990, 0, 20000, 250, 20000, 60, 250, 100000, 'sla',
    '{"pppoe":true,"hotspot":true,"static_ip":true,"radius":true,"mikrotik":true,"genieacs":true,"whatsapp":true,"sms":true,"reports":true,"customer_portal":true,"reseller":true,"technician":true,"ai_assistant":true,"api_access":true}',
    'active', 40
  ),
  (
    'plan_enterprise', 'enterprise', 'Enterprise', 'National footprints and custom limits.',
    79999, 799990, 0, 100000, 1000, 0, 0, 1000, 0, 'dedicated',
    '{"pppoe":true,"hotspot":true,"static_ip":true,"radius":true,"mikrotik":true,"genieacs":true,"whatsapp":true,"sms":true,"reports":true,"customer_portal":true,"reseller":true,"technician":true,"ai_assistant":true,"api_access":true}',
    'active', 50
  )
on conflict (code) do nothing;

create table if not exists platform_audit_log (
  id text primary key,
  actor_user_id text not null,
  actor_email text not null default '',
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  tenant_id text,
  metadata text not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_log_created_idx on platform_audit_log (created_at desc);
create index if not exists platform_audit_log_tenant_idx on platform_audit_log (tenant_id, created_at desc);

create table if not exists platform_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

insert into platform_settings (key, value) values
  ('grace_days', '3'),
  ('past_due_days', '7'),
  ('trial_days', '14'),
  ('support_access_enabled', 'false'),
  ('support_access_minutes', '30')
on conflict (key) do nothing;

create table if not exists support_sessions (
  id text primary key,
  actor_user_id text not null,
  tenant_id text not null references tenants(id) on delete cascade,
  reason text not null,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index if not exists support_sessions_actor_idx on support_sessions (actor_user_id, status);

create table if not exists infra_nodes (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_seen timestamptz,
  cpu_pct integer,
  ram_pct integer,
  disk_pct integer,
  load_1 numeric,
  net_rx_bytes bigint,
  net_tx_bytes bigint,
  uptime_seconds integer,
  postgres_ok boolean,
  redis_ok boolean,
  genieacs_ok boolean,
  created_at timestamptz not null default now()
);
create index if not exists infra_nodes_tenant_idx on infra_nodes (tenant_id);

alter table tenant_subscriptions add column if not exists max_services integer not null default 0;
alter table tenant_subscriptions add column if not exists max_admins integer not null default 0;
alter table tenant_subscriptions add column if not exists max_storage_gb integer not null default 0;
alter table tenant_subscriptions add column if not exists api_requests_per_day integer not null default 0;
alter table tenant_subscriptions add column if not exists billing_cycle text not null default 'monthly';
alter table tenant_subscriptions add column if not exists support_level text not null default 'community';
alter table tenant_subscriptions add column if not exists entitlements text not null default '{}';
alter table tenant_subscriptions add column if not exists started_at timestamptz not null default now();
alter table tenant_subscriptions add column if not exists trial_ends_at timestamptz;
alter table tenant_subscriptions add column if not exists grace_until timestamptz;
alter table tenant_subscriptions add column if not exists cancelled_at timestamptz;

alter table tenants add column if not exists suspended_reason text not null default '';
alter table tenants add column if not exists suspended_at timestamptz;

do $$
begin
  grant select, insert, update, delete on saas_plans, platform_audit_log, platform_settings, support_sessions, infra_nodes to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table saas_plans enable row level security;
  alter table saas_plans force row level security;
  drop policy if exists saas_plans_read on saas_plans;
  create policy saas_plans_read on saas_plans for select using (true);
  drop policy if exists saas_plans_write on saas_plans;
  create policy saas_plans_write on saas_plans for all
    using (current_setting('app.bypass_rls', true) = 'on')
    with check (current_setting('app.bypass_rls', true) = 'on');

  alter table platform_audit_log enable row level security;
  alter table platform_audit_log force row level security;
  drop policy if exists platform_only on platform_audit_log;
  create policy platform_only on platform_audit_log
    using (current_setting('app.bypass_rls', true) = 'on')
    with check (current_setting('app.bypass_rls', true) = 'on');

  alter table platform_settings enable row level security;
  alter table platform_settings force row level security;
  drop policy if exists platform_only on platform_settings;
  drop policy if exists platform_settings_read on platform_settings;
  drop policy if exists platform_settings_write on platform_settings;
  create policy platform_settings_read on platform_settings for select using (true);
  create policy platform_settings_write on platform_settings for all
    using (current_setting('app.bypass_rls', true) = 'on')
    with check (current_setting('app.bypass_rls', true) = 'on');

  alter table support_sessions enable row level security;
  alter table support_sessions force row level security;
  drop policy if exists platform_only on support_sessions;
  drop policy if exists support_sessions_read on support_sessions;
  drop policy if exists support_sessions_write on support_sessions;
  create policy support_sessions_read on support_sessions for select using (true);
  create policy support_sessions_write on support_sessions for all
    using (current_setting('app.bypass_rls', true) = 'on')
    with check (current_setting('app.bypass_rls', true) = 'on');

  alter table infra_nodes enable row level security;
  alter table infra_nodes force row level security;
  drop policy if exists tenant_isolation on infra_nodes;
  create policy tenant_isolation on infra_nodes
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );
end $$;
