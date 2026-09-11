-- Staff- and customer-granted grace periods. Does not change period_end / billing.
-- Automatic package.grace_days remains the default access window; these rows
-- record a fixed expiry so cron cannot keep extending access.

create table if not exists grace_policies (
  tenant_id text primary key references tenants(id) on delete cascade,
  staff_max_days integer not null default 14,
  staff_preset_days text not null default '1,2,3,5,7',
  allow_custom_days boolean not null default true,
  customer_self_service boolean not null default true,
  customer_max_days integer not null default 3,
  customer_preset_days text not null default '1,2,3',
  customer_max_uses_per_period integer not null default 1,
  customer_min_account_days integer not null default 30,
  customer_require_prior_payment boolean not null default true,
  customer_block_if_already_grace boolean not null default true,
  customer_cooldown_days integer not null default 30,
  notify_nearing_hours integer not null default 24,
  updated_at timestamptz not null default now(),
  constraint grace_policies_staff_max check (staff_max_days >= 1 and staff_max_days <= 30),
  constraint grace_policies_customer_max check (customer_max_days >= 1 and customer_max_days <= 30)
);

create table if not exists service_grace_periods (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  service_id text not null references services(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  days_granted integer not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'active',
  granted_by_type text not null,
  granted_by_user_id text,
  granted_by_label text not null default '',
  reason text not null default '',
  revoked_at timestamptz,
  revoked_by_user_id text,
  revoked_reason text not null default '',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint service_grace_days_positive check (days_granted > 0 and days_granted <= 30),
  constraint service_grace_status check (status in ('active','expired','revoked','consumed')),
  constraint service_grace_actor check (granted_by_type in ('staff','customer','system'))
);
create index if not exists service_grace_tenant_idx on service_grace_periods (tenant_id, status);
create index if not exists service_grace_service_idx on service_grace_periods (tenant_id, service_id);
create unique index if not exists service_grace_one_active
  on service_grace_periods (tenant_id, service_id) where status = 'active';

create table if not exists service_grace_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  grace_id text not null references service_grace_periods(id) on delete cascade,
  service_id text not null,
  action text not null,
  days integer not null default 0,
  previous_expires_at timestamptz,
  new_expires_at timestamptz,
  actor_type text not null default 'system',
  actor_id text,
  reason text not null default '',
  created_at timestamptz not null default now(),
  constraint service_grace_event_action check (action in ('granted','extended','revoked','expired','consumed'))
);
create index if not exists service_grace_events_tenant_idx on service_grace_events (tenant_id, created_at desc);
create index if not exists service_grace_events_grace_idx on service_grace_events (grace_id);

do $$
begin
  grant select, insert, update, delete on grace_policies to gridline;
  grant select, insert, update, delete on service_grace_periods to gridline;
  grant select, insert, update, delete on service_grace_events to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['grace_policies','service_grace_periods','service_grace_events']
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
