-- Every paybill / till / unmatched STK hit, including those with no matching account.
create table if not exists incoming_payments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null default 'mpesa',
  channel text not null default 'paybill',
  trans_id text not null,
  bill_ref text not null default '',
  msisdn text not null default '',
  payer_name text not null default '',
  amount_kes integer not null,
  shortcode text not null default '',
  trans_time timestamptz not null default now(),
  status text not null default 'unmatched',
  customer_id text references customers(id) on delete set null,
  invoice_id text references invoices(id) on delete set null,
  payment_id text,
  match_reason text not null default '',
  payload text not null default '',
  assigned_by text not null default '',
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, trans_id)
);
create index if not exists incoming_payments_tenant_idx on incoming_payments (tenant_id, trans_time desc);
create index if not exists incoming_payments_status_idx on incoming_payments (tenant_id, status);

do $$
begin
  alter table incoming_payments enable row level security;
  alter table incoming_payments force row level security;
  drop policy if exists tenant_isolation on incoming_payments;
  execute $p$
    create policy tenant_isolation on incoming_payments
      using (
        current_setting('app.bypass_rls', true) = 'on'
        or tenant_id = current_setting('app.tenant_id', true)
      )
      with check (
        current_setting('app.bypass_rls', true) = 'on'
        or tenant_id = current_setting('app.tenant_id', true)
      )
  $p$;
  grant select, insert, update, delete on incoming_payments to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;
