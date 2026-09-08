-- M0.5 architecture consolidation. Additive only. No data loss.

create table if not exists user_active_tenant (
  user_id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table routers add column if not exists api_user text not null default 'gridline';
alter table routers add column if not exists api_password text not null default '';
alter table routers add column if not exists api_port integer not null default 443;
alter table routers add column if not exists api_host text not null default '';
alter table routers add column if not exists wg_private_ref text not null default '';

alter table agent_commands add column if not exists result text not null default '';
alter table agent_commands add column if not exists requested_by text not null default '';
alter table agent_commands add column if not exists approved_by text not null default '';
alter table agent_commands add column if not exists verified_at timestamptz;

alter table payment_providers add column if not exists client_id text not null default '';
alter table payment_providers add column if not exists client_secret text not null default '';
alter table payment_providers add column if not exists till_number text not null default '';
alter table payment_providers add column if not exists passkey text not null default '';
alter table payment_providers add column if not exists stk_type text not null default 'paybill';

alter table tenants add column if not exists public_base_url text not null default '';

create table if not exists payment_webhooks (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  checkout_id text not null default '',
  payload text not null default '',
  status text not null default 'received',
  created_at timestamptz not null default now()
);

create table if not exists customer_ledger (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  entry_type text not null,
  debit_kes integer not null default 0,
  credit_kes integer not null default 0,
  ref_type text not null default '',
  ref_id text not null default '',
  memo text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists customer_ledger_tenant_idx on customer_ledger (tenant_id, customer_id, created_at);

create table if not exists payment_allocations (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  payment_id text not null references payments(id) on delete cascade,
  invoice_id text not null references invoices(id),
  amount_kes integer not null,
  created_at timestamptz not null default now()
);

create table if not exists loyalty_transactions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  delta integer not null,
  reason text not null default '',
  ref_id text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists reseller_wallets (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  reseller_id text not null references resellers(id) on delete cascade,
  balance_kes integer not null default 0,
  unique (tenant_id, reseller_id)
);

create table if not exists reseller_transactions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  reseller_id text not null references resellers(id) on delete cascade,
  delta_kes integer not null,
  reason text not null default '',
  ref_id text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists wireguard_peers (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  router_id text references routers(id) on delete cascade,
  public_key text not null,
  private_key_sealed text not null default '',
  allowed_ips text not null default '10.200.0.0/24',
  address text not null default '',
  listen_port integer not null default 13231,
  persistent_keepalive integer not null default 25,
  status text not null default 'pending',
  last_handshake timestamptz,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);

create table if not exists tenant_branches (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists saas_plans (
  id text primary key,
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
