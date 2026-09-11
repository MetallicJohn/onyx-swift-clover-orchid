-- Bulk communications campaigns. Recipients are resolved server-side from customers/services.

create table if not exists comm_templates (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  category text not null,
  name text not null,
  body text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists comm_templates_tenant_idx on comm_templates (tenant_id, category);

create table if not exists comm_campaigns (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null default '',
  category text not null,
  body text not null,
  template_id text,
  filter_json text not null default '{}',
  extras_json text not null default '{}',
  sender_id text not null default '',
  provider text not null default '',
  created_by text not null default '',
  created_by_label text not null default '',
  status text not null default 'queued',
  recipient_count integer not null default 0,
  valid_count integer not null default 0,
  skipped_count integer not null default 0,
  sms_parts integer not null default 1,
  sms_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  restore_of text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint comm_campaigns_status check (status in ('queued','sending','sent','failed'))
);
create index if not exists comm_campaigns_tenant_idx on comm_campaigns (tenant_id, created_at desc);
create index if not exists comm_campaigns_status_idx on comm_campaigns (tenant_id, status);

create table if not exists comm_recipients (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  campaign_id text not null references comm_campaigns(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  phone text not null default '',
  body text not null default '',
  status text not null default 'queued',
  detail text not null default '',
  sms_parts integer not null default 1,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint comm_recipients_status check (status in ('queued','sent','failed','skipped')),
  unique (campaign_id, customer_id)
);
create index if not exists comm_recipients_campaign_idx on comm_recipients (campaign_id, status);
create index if not exists comm_recipients_tenant_idx on comm_recipients (tenant_id, campaign_id);

do $$
begin
  grant select, insert, update, delete on comm_templates to gridline;
  grant select, insert, update, delete on comm_campaigns to gridline;
  grant select, insert, update, delete on comm_recipients to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['comm_templates','comm_campaigns','comm_recipients']
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
