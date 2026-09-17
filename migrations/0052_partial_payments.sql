-- Optional, off-by-default partial payments. Pro-rata validity is granted only
-- when a confirmed payment meets the effective minimum percentage.

create table if not exists partial_payment_policies (
  tenant_id text primary key references tenants(id) on delete cascade,
  enabled_default boolean not null default false,
  default_min_pct integer not null default 50,
  allow_customer_override boolean not null default true,
  allow_service_override boolean not null default true,
  min_pct integer not null default 10,
  max_pct integer not null default 90,
  can_activate_new boolean not null default true,
  can_restore_expired boolean not null default true,
  can_renew_active boolean not null default false,
  can_extend_active boolean not null default false,
  requires_approval boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint partial_payment_policies_bounds check (
    min_pct >= 1 and max_pct <= 100 and min_pct <= max_pct
    and default_min_pct >= min_pct and default_min_pct <= max_pct
  )
);

alter table customers add column if not exists partial_enabled boolean;
alter table customers add column if not exists partial_min_pct integer;
alter table customers add column if not exists partial_notes text not null default '';
alter table customers add column if not exists partial_enabled_by text;
alter table customers add column if not exists partial_enabled_at timestamptz;
alter table customers add column if not exists partial_updated_at timestamptz;

alter table services add column if not exists partial_enabled boolean;
alter table services add column if not exists partial_min_pct integer;
alter table services add column if not exists partial_method text not null default 'pro_rata';
alter table services add column if not exists activation_mode text not null default 'after_payment';
alter table services add column if not exists last_partial_payment_id text;
alter table services add column if not exists last_partial_validity_ms bigint not null default 0;
alter table services add column if not exists last_partial_pct integer not null default 0;

alter table invoices add column if not exists access_granted_ms bigint not null default 0;

do $$
begin
  update services
    set activation_mode = 'active'
  where activation_mode = 'after_payment'
    and status = 'active'
    and coalesce(suspend_reason, '') <> 'awaiting_payment';
exception
  when undefined_column then null;
end $$;

create table if not exists partial_payment_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  service_id text references services(id) on delete set null,
  invoice_id text references invoices(id) on delete set null,
  payment_id text not null,
  service_account_number text not null default '',
  amount_kes integer not null,
  full_amount_kes integer not null,
  paid_kes integer not null default 0,
  required_pct integer not null,
  actual_pct integer not null,
  minimum_kes integer not null,
  qualifies boolean not null default false,
  validity_ms bigint not null default 0,
  validity_days integer not null default 0,
  previous_expiry timestamptz,
  new_expiry timestamptz,
  reference text not null default '',
  provider text not null default '',
  outcome text not null,
  approval_status text not null default 'none',
  approved_by text,
  approved_at timestamptz,
  blocked_reason text not null default '',
  created_at timestamptz not null default now(),
  constraint partial_payment_events_outcome check (
    outcome in ('posted','activated','restored','extended','below_minimum','blocked','pending_approval')
  ),
  constraint partial_payment_events_approval check (
    approval_status in ('none','pending','approved','rejected')
  )
);
create unique index if not exists partial_payment_events_payment_uidx
  on partial_payment_events (tenant_id, payment_id);
create index if not exists partial_payment_events_tenant_idx
  on partial_payment_events (tenant_id, created_at desc);
create index if not exists partial_payment_events_service_idx
  on partial_payment_events (tenant_id, service_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_partial_method_check'
  ) then
    alter table services add constraint services_partial_method_check
      check (partial_method in ('pro_rata'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'services_activation_mode_check'
  ) then
    alter table services add constraint services_activation_mode_check
      check (activation_mode in ('active','after_payment','after_partial'));
  end if;
exception
  when undefined_column then null;
end $$;

do $$
begin
  grant select, insert, update, delete on partial_payment_policies to ispsolutions;
  grant select, insert, update, delete on partial_payment_events to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['partial_payment_policies','partial_payment_events']
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
