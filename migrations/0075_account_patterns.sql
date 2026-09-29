-- Flexible account-number setup. Existing numbers and the legacy allocator stay.
-- Customer IDs (customer_id_settings) are not changed.

alter table customer_account_settings add column if not exists mode text not null default 'legacy';
alter table customer_account_settings add column if not exists pattern text not null default '';
alter table customer_account_settings add column if not exists assign_on text not null default 'service';
alter table customer_account_settings add column if not exists seq_scope text not null default 'tenant';
alter table customer_account_settings add column if not exists increment_by integer not null default 1;
alter table customer_account_settings add column if not exists reset_policy text not null default 'never';
alter table customer_account_settings add column if not exists min_length integer not null default 1;
alter table customer_account_settings add column if not exists max_length integer not null default 32;
alter table customer_account_settings add column if not exists charset text not null default 'alnum';
alter table customer_account_settings add column if not exists type_codes text not null default '';
alter table customer_account_settings add column if not exists service_codes text not null default '';
alter table customer_account_settings add column if not exists branch_codes text not null default '';
alter table customer_account_settings add column if not exists area_codes text not null default '';
alter table customer_account_settings add column if not exists default_branch text not null default '';
alter table customer_account_settings add column if not exists config_version integer not null default 1;
alter table customer_account_settings add column if not exists import_preserve boolean not null default true;

create table if not exists account_sequences (
  tenant_id text not null references tenants(id) on delete cascade,
  scope_key text not null,
  next_n integer not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, scope_key)
);

create table if not exists account_number_reservations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  kind text not null,
  value text not null,
  value_end text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  constraint account_reservation_kind check (kind in ('number', 'range', 'prefix'))
);

create table if not exists account_number_history (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  entity_type text not null default 'service',
  entity_id text not null default '',
  account_number text not null,
  previous_number text not null default '',
  source text not null default 'automatic',
  mode text not null default '',
  pattern text not null default '',
  config_version integer not null default 1,
  actor_id text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists account_number_history_tenant_idx
  on account_number_history (tenant_id, created_at desc);

create table if not exists account_number_versions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  version integer not null,
  mode text not null default '',
  pattern text not null default '',
  snapshot text not null default '',
  actor_id text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);

create table if not exists account_number_aliases (
  tenant_id text not null references tenants(id) on delete cascade,
  alias text not null,
  account_number text not null,
  entity_type text not null default 'service',
  entity_id text not null default '',
  created_at timestamptz not null default now(),
  primary key (tenant_id, alias)
);

do $$
begin
  grant select, insert, update, delete on account_sequences to ispsolutions;
  grant select, insert, update, delete on account_number_reservations to ispsolutions;
  grant select, insert, update, delete on account_number_history to ispsolutions;
  grant select, insert, update, delete on account_number_versions to ispsolutions;
  grant select, insert, update, delete on account_number_aliases to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'account_sequences',
    'account_number_reservations',
    'account_number_history',
    'account_number_versions',
    'account_number_aliases'
  ]
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
