-- Change plans, approvals, and rollback records for the MikroTik Assistant.
-- Router passwords stay on routers.api_password. Plans store redacted commands only.

create table if not exists ai_change_plans (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null default '',
  conversation_id text not null default '',
  user_id text not null default '',
  objective text not null default '',
  risk text not null default 'MEDIUM',
  state text not null default 'DRAFT',
  plan_json text not null default '{}',
  block_reason text not null default '',
  parent_plan_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_change_plans_tenant_idx on ai_change_plans (tenant_id, created_at desc);

create table if not exists ai_change_approvals (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  plan_id text not null,
  user_id text not null default '',
  decision text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_change_approvals_plan_idx on ai_change_approvals (tenant_id, plan_id);

create table if not exists ai_change_executions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  plan_id text not null,
  status text not null,
  result_redacted text not null default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ai_change_executions_plan_idx on ai_change_executions (tenant_id, plan_id);

create table if not exists ai_change_verifications (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  plan_id text not null,
  status text not null,
  evidence text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_change_verifications_plan_idx on ai_change_verifications (tenant_id, plan_id);

create table if not exists ai_router_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text not null default '',
  plan_id text not null default '',
  trigger text not null default 'pre-change',
  user_id text not null default '',
  config_redacted text not null default '',
  config_hash text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_router_snapshots_plan_idx on ai_router_snapshots (tenant_id, plan_id);

do $$
declare t text;
begin
  foreach t in array array[
    'ai_change_plans',
    'ai_change_approvals',
    'ai_change_executions',
    'ai_change_verifications',
    'ai_router_snapshots'
  ]
  loop
    begin
      execute format('grant select, insert, update, delete on %I to ispsolutions', t);
    exception
      when undefined_object then null;
      when insufficient_privilege then null;
    end;
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (current_setting(''app.bypass_rls'', true) = ''on'' or tenant_id = current_setting(''app.tenant_id'', true))
         with check (current_setting(''app.bypass_rls'', true) = ''on'' or tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  end loop;
end $$;
