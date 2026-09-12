-- Per-ISP customer account number format. Stored on the customer so invoices,
-- payments, RADIUS, and tickets keep working if the format later changes.

alter table customers add column if not exists account_number text not null default '';

create unique index if not exists customers_account_number_uq
  on customers (tenant_id, account_number)
  where account_number <> '';

alter table audit_logs add column if not exists details text not null default '';

create table if not exists customer_account_settings (
  tenant_id text primary key references tenants(id) on delete cascade,
  enabled boolean not null default false,
  prefix text not null default 'CUS',
  suffix text not null default '',
  separator text not null default '',
  start_n integer not null default 1000,
  next_n integer not null default 1000,
  digits integer not null default 4,
  allow_manual boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint customer_account_prefix check (prefix ~ '^[A-Z0-9]{0,12}$'),
  constraint customer_account_suffix check (suffix ~ '^[A-Z0-9]{0,12}$'),
  constraint customer_account_separator check (separator in ('', '-', '/')),
  constraint customer_account_digits check (digits >= 1 and digits <= 8),
  constraint customer_account_start check (start_n >= 0 and start_n <= 99999999),
  constraint customer_account_next check (next_n >= 0 and next_n <= 99999999)
);

do $$
begin
  grant select, insert, update, delete on customer_account_settings to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table customer_account_settings enable row level security;
  alter table customer_account_settings force row level security;
  drop policy if exists tenant_isolation on customer_account_settings;
  create policy tenant_isolation on customer_account_settings
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
