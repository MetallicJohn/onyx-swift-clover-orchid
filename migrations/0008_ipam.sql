create table if not exists ip_addresses (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  pool_id text references ip_pools(id) on delete set null,
  address text not null,
  family text not null default 'ipv4',
  status text not null default 'available',
  service_id text references services(id) on delete set null,
  customer_id text references customers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, address)
);
create index if not exists ip_addresses_tenant_idx on ip_addresses (tenant_id, status);
