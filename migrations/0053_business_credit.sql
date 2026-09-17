-- Business-tier credit: service stays online after expiry until a configured
-- maximum outstanding is reached. Limits are amounts, never unlimited by default.

alter table packages add column if not exists tier text not null default 'residential';
alter table packages add column if not exists business_credit_enabled boolean not null default false;
alter table packages add column if not exists max_credit_kes integer not null default 0;
alter table packages add column if not exists credit_warning_kes integer not null default 0;
alter table packages add column if not exists disconnect_when_credit_reached boolean not null default true;
alter table packages add column if not exists allow_service_continuity_after_expiry boolean not null default true;
alter table packages add column if not exists send_credit_limit_warning boolean not null default true;
alter table packages add column if not exists credit_days_limit integer not null default 0;
alter table packages add column if not exists credit_calculation_method text not null default 'outstanding_invoices';
alter table packages add column if not exists credit_terms_notes text not null default '';

do $$ begin
  alter table packages drop constraint if exists packages_tier_check;
  alter table packages add constraint packages_tier_check
    check (tier in ('residential','business','enterprise'));
exception when others then null;
end $$;

alter table customers add column if not exists business_credit_enabled boolean;
alter table customers add column if not exists business_max_credit_kes integer;
alter table customers add column if not exists business_warning_kes integer;

alter table services add column if not exists business_credit_enabled boolean;
alter table services add column if not exists business_max_credit_kes integer;
alter table services add column if not exists business_warning_kes integer;
alter table services add column if not exists last_credit_check_at timestamptz;
alter table services add column if not exists last_credit_warn_at timestamptz;
alter table services add column if not exists last_credit_warn_outstanding integer not null default 0;

create table if not exists business_credit_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  service_id text not null references services(id) on delete cascade,
  invoice_id text,
  payment_id text,
  action text not null,
  outstanding_kes integer not null default 0,
  max_credit_kes integer not null default 0,
  available_kes integer not null default 0,
  warning_kes integer not null default 0,
  previous_status text not null default '',
  new_status text not null default '',
  actor_id text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint business_credit_events_action check (action in (
    'checked','warned','limited','suspended','restored','enabled','disabled','limit_changed','invoice_issued'
  ))
);
create index if not exists business_credit_events_tenant_idx on business_credit_events (tenant_id, created_at desc);
create index if not exists business_credit_events_service_idx on business_credit_events (tenant_id, service_id, created_at desc);

do $$
begin
  grant select, insert, update, delete on business_credit_events to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['business_credit_events']
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
