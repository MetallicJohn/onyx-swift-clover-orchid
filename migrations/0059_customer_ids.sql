-- Per-ISP numeric customer IDs. Stored on customers.account_number.
-- Independent of service account numbers (customer_account_settings).
-- Existing customer identifiers are not rewritten.

create table if not exists customer_id_settings (
  tenant_id text primary key references tenants(id) on delete cascade,
  start_n integer not null default 1,
  next_n integer not null default 1,
  configured boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint customer_id_start check (start_n >= 1 and start_n <= 99999999),
  constraint customer_id_next check (next_n >= 1 and next_n <= 99999999)
);

do $$
begin
  grant select, insert, update, delete on customer_id_settings to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table customer_id_settings enable row level security;
  alter table customer_id_settings force row level security;
  drop policy if exists tenant_isolation on customer_id_settings;
  create policy tenant_isolation on customer_id_settings
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
