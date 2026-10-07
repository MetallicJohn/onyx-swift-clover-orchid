-- MikroTik Assistant. Router AI policy defaults off and read-only.
-- Credentials stay in router_credentials / routers.api_password. Not copied here.

alter table routers add column if not exists ai_enabled boolean not null default false;
alter table routers add column if not exists ai_read_only boolean not null default true;
alter table routers add column if not exists ai_write_enabled boolean not null default false;

create table if not exists ai_conversations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null default '',
  router_id text not null default '',
  title text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_conversations_tenant_idx on ai_conversations (tenant_id, created_at desc);

create table if not exists ai_messages (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  conversation_id text not null,
  role text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on ai_messages (tenant_id, conversation_id, created_at);

create table if not exists ai_tool_calls (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null default '',
  conversation_id text not null default '',
  request_id text not null default '',
  router_id text not null default '',
  tool_name text not null,
  risk_class text not null default 'READ',
  arguments_redacted text not null default '',
  result_redacted text not null default '',
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer not null default 0,
  error_code text not null default ''
);
create index if not exists ai_tool_calls_tenant_idx on ai_tool_calls (tenant_id, started_at desc);

do $$
declare t text;
begin
  foreach t in array array['ai_conversations', 'ai_messages', 'ai_tool_calls']
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
