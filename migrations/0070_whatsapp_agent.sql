-- WhatsApp customer-service channel. Additive. Does not change billing, RADIUS, or customer rows.

create table if not exists whatsapp_agent_settings (
  tenant_id text primary key references tenants(id) on delete cascade,
  enabled boolean not null default false,
  ai_enabled boolean not null default false,
  read_only_enabled boolean not null default true,
  connection_actions_enabled boolean not null default false,
  cpe_actions_enabled boolean not null default false,
  password_actions_enabled boolean not null default false,
  service_actions_enabled boolean not null default false,
  kill_switch boolean not null default false,
  link_mode text not null default 'web',
  otp_ttl_seconds integer not null default 300,
  level2_ttl_seconds integer not null default 600,
  business_hours text not null default '',
  handoff_phone text not null default '',
  actions_json text not null default '',
  webhook_secret text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_web_sessions (
  tenant_id text primary key references tenants(id) on delete cascade,
  status text not null default 'disconnected',
  phone_e164 text not null default '',
  qr_text text not null default '',
  auth_sealed text not null default '',
  last_error text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_conversations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text,
  phone_e164 text not null,
  status text not null default 'open',
  verification_level integer not null default 0,
  verification_expires_at timestamptz,
  pending_action_id text,
  automation_paused boolean not null default false,
  otp_failures integer not null default 0,
  level2_blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create unique index if not exists whatsapp_conversations_phone_uq on whatsapp_conversations (tenant_id, phone_e164);

create table if not exists whatsapp_messages (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  conversation_id text not null,
  provider text not null,
  provider_message_id text not null,
  direction text not null,
  message_type text not null default 'text',
  content text not null default '',
  intent text not null default '',
  processing_status text not null default 'received',
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, provider_message_id)
);
create index if not exists whatsapp_messages_conversation_idx on whatsapp_messages (conversation_id, created_at);

create table if not exists whatsapp_action_requests (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text,
  conversation_id text not null,
  message_id text not null default '',
  action text not null,
  parameters text not null default '{}',
  verification_level integer not null default 0,
  status text not null,
  confirmation_nonce text not null default '',
  confirmation_expires_at timestamptz,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  result_code text not null default '',
  error_code text not null default '',
  result_text text not null default ''
);
create index if not exists whatsapp_actions_customer_idx on whatsapp_action_requests (tenant_id, customer_id, requested_at desc);

create table if not exists whatsapp_otp_challenges (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null,
  conversation_id text not null,
  action_context text not null default '',
  otp_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_otp_customer_idx on whatsapp_otp_challenges (tenant_id, customer_id, created_at desc);

create table if not exists whatsapp_security_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  kind text not null,
  phone_e164 text not null default '',
  customer_id text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_security_phone_idx on whatsapp_security_events (tenant_id, phone_e164, created_at desc);

grant select, insert, update, delete on
  whatsapp_agent_settings, whatsapp_web_sessions, whatsapp_conversations, whatsapp_messages,
  whatsapp_action_requests, whatsapp_otp_challenges, whatsapp_security_events
  to ispsolutions;

do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname like 'whatsapp_%'
  loop
    execute format('alter table %I enable row level security', r.table_name);
    execute format('alter table %I force row level security', r.table_name);
    execute format('drop policy if exists tenant_isolation on %I', r.table_name);
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
      r.table_name
    );
  end loop;
end $$;
