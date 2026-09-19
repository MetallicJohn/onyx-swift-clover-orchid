-- Hotspot package duration (value + unit) and captive-portal purchases.
-- validity_hours remains a coarse fallback for non-hotspot billing math.

alter table packages add column if not exists duration_value integer not null default 0;
alter table packages add column if not exists duration_unit text not null default 'hours';

update packages
set
  duration_unit = case
    when coalesce(validity_hours, 0) <= 0 then 'hours'
    when validity_hours % 168 = 0 then 'weeks'
    when validity_hours % 24 = 0 then 'days'
    else 'hours'
  end,
  duration_value = case
    when coalesce(validity_hours, 0) <= 0 then 1
    when validity_hours % 168 = 0 then greatest(1, validity_hours / 168)
    when validity_hours % 24 = 0 then greatest(1, validity_hours / 24)
    else greatest(1, validity_hours)
  end
where coalesce(duration_value, 0) = 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'packages_duration_unit_check'
  ) then
    alter table packages add constraint packages_duration_unit_check
      check (duration_unit in ('minutes','hours','days','weeks','months'));
  end if;
end $$;

create table if not exists hotspot_purchases (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  service_id text not null references services(id) on delete cascade,
  package_id text not null references packages(id) on delete restrict,
  invoice_id text references invoices(id) on delete set null,
  intent_id text references payment_intents(id) on delete set null,
  phone text not null default '',
  amount_kes integer not null default 0,
  payment_status text not null default 'pending',
  service_status text not null default 'pending_payment',
  username text not null default '',
  password text not null default '',
  activated_at timestamptz,
  expires_at timestamptz,
  fail_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hotspot_purchases_intent_uidx
  on hotspot_purchases (tenant_id, intent_id) where intent_id is not null;
create index if not exists hotspot_purchases_tenant_idx
  on hotspot_purchases (tenant_id, created_at desc);
create index if not exists hotspot_purchases_service_idx
  on hotspot_purchases (tenant_id, service_id);
create index if not exists hotspot_purchases_phone_idx
  on hotspot_purchases (tenant_id, phone);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hotspot_purchases_payment_status_check'
  ) then
    alter table hotspot_purchases add constraint hotspot_purchases_payment_status_check
      check (payment_status in ('pending','confirmed','failed','cancelled','reversed','reconciliation_required'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'hotspot_purchases_service_status_check'
  ) then
    alter table hotspot_purchases add constraint hotspot_purchases_service_status_check
      check (service_status in ('pending_payment','active','expired','suspended','cancelled'));
  end if;
end $$;

do $$
begin
  grant select, insert, update, delete on hotspot_purchases to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table hotspot_purchases enable row level security;
  alter table hotspot_purchases force row level security;
  drop policy if exists tenant_isolation on hotspot_purchases;
  create policy tenant_isolation on hotspot_purchases
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
