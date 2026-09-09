-- Customer invoice desk (line items, VAT, partials) and platform SaaS invoices.

alter table tenants add column if not exists vat_enabled boolean not null default false;
alter table tenants add column if not exists vat_rate_pct integer not null default 16;

alter table invoices add column if not exists subtotal_kes integer not null default 0;
alter table invoices add column if not exists tax_kes integer not null default 0;
alter table invoices add column if not exists tax_rate integer not null default 0;
alter table invoices add column if not exists paid_kes integer not null default 0;
alter table invoices add column if not exists notes text not null default '';

update invoices set subtotal_kes = amount_kes where subtotal_kes = 0;
update invoices set paid_kes = amount_kes where status = 'paid' and paid_kes = 0;

create table if not exists invoice_items (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  invoice_id text not null references invoices(id) on delete cascade,
  description text not null,
  quantity integer not null default 1,
  unit_kes integer not null,
  amount_kes integer not null,
  package_id text,
  service_id text
);
create index if not exists invoice_items_invoice_idx on invoice_items (invoice_id);

alter table tenant_subscriptions add column if not exists pending_plan text not null default '';
alter table tenant_subscriptions add column if not exists pending_invoice_id text not null default '';

create table if not exists saas_invoices (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  number text not null,
  plan text not null,
  amount_kes integer not null,
  status text not null default 'issued',
  due_date date not null,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  unique (tenant_id, number)
);
create index if not exists saas_invoices_tenant_idx on saas_invoices (tenant_id, issued_at desc);

create table if not exists saas_payments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  invoice_id text not null references saas_invoices(id),
  provider text not null,
  amount_kes integer not null,
  reference text not null,
  status text not null default 'confirmed',
  paid_at timestamptz not null default now(),
  unique (tenant_id, reference)
);
create index if not exists saas_payments_tenant_idx on saas_payments (tenant_id, paid_at desc);

create table if not exists saas_payment_intents (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  invoice_id text not null references saas_invoices(id),
  provider text not null,
  amount_kes integer not null,
  phone text not null default '',
  checkout_id text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists saas_payment_intents_checkout_idx on saas_payment_intents (tenant_id, checkout_id);

do $$
begin
  grant select, insert, update, delete on all tables in schema public to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table invoice_items enable row level security;
  alter table invoice_items force row level security;
  drop policy if exists tenant_isolation on invoice_items;
  create policy tenant_isolation on invoice_items
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );

  alter table saas_invoices enable row level security;
  alter table saas_invoices force row level security;
  drop policy if exists tenant_isolation on saas_invoices;
  create policy tenant_isolation on saas_invoices
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );

  alter table saas_payments enable row level security;
  alter table saas_payments force row level security;
  drop policy if exists tenant_isolation on saas_payments;
  create policy tenant_isolation on saas_payments
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );

  alter table saas_payment_intents enable row level security;
  alter table saas_payment_intents force row level security;
  drop policy if exists tenant_isolation on saas_payment_intents;
  create policy tenant_isolation on saas_payment_intents
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );
end $$;
