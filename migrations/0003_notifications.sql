-- Notifications module — templates + delivery log. Independent of billing tables.

create table if not exists notification_templates (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  event_code text not null,
  channel text not null,
  subject text not null default '',
  body text not null,
  enabled boolean not null default true,
  unique (tenant_id, event_code, channel)
);
create index if not exists notification_templates_tenant_idx on notification_templates (tenant_id);

create table if not exists notification_logs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text,
  event_code text not null,
  channel text not null,
  entity_id text not null default '',
  subject text not null default '',
  body text not null,
  destination text not null default '',
  status text not null default 'sent',
  created_at timestamptz not null default now()
);
create index if not exists notification_logs_tenant_idx on notification_logs (tenant_id, created_at desc);
create unique index if not exists notification_logs_dedupe_idx
  on notification_logs (tenant_id, event_code, entity_id, channel);
