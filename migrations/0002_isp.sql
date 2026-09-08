-- Gridline ISP SaaS — multi-tenant foundation schema
-- All tenant-owned tables carry tenant_id. Access is scoped via tenant_members.user_id.

create table if not exists tenants (
  id text primary key,
  name text not null,
  slug text not null unique,
  status text not null default 'trial',
  currency text not null default 'KES',
  timezone text not null default 'Africa/Nairobi',
  support_email text not null default '',
  support_phone text not null default '',
  demo_seeded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tenant_members (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null,
  role text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists tenant_members_user_idx on tenant_members (user_id);

create table if not exists packages (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  description text not null default '',
  access_method text not null,
  download_mbps integer not null,
  upload_mbps integer not null,
  price_kes integer not null,
  billing_interval text not null default 'monthly',
  grace_days integer not null default 5,
  active boolean not null default true
);
create index if not exists packages_tenant_idx on packages (tenant_id);

create table if not exists customers (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  type text not null default 'individual',
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists customers_tenant_idx on customers (tenant_id);

create table if not exists services (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  package_id text not null references packages(id),
  access_method text not null,
  username text,
  static_ip text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists services_tenant_idx on services (tenant_id);
create index if not exists services_customer_idx on services (customer_id);

create table if not exists invoices (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  number text not null,
  amount_kes integer not null,
  status text not null,
  due_date date not null,
  issued_at timestamptz not null default now()
);
create index if not exists invoices_tenant_idx on invoices (tenant_id);

create table if not exists payments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  invoice_id text references invoices(id),
  provider text not null,
  amount_kes integer not null,
  reference text not null,
  status text not null default 'confirmed',
  paid_at timestamptz not null default now()
);
create index if not exists payments_tenant_idx on payments (tenant_id);
create unique index if not exists payments_reference_idx on payments (tenant_id, reference);

create table if not exists routers (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  location text not null default '',
  identity text not null default '',
  role text not null default 'access',
  wg_status text not null default 'connected',
  last_seen timestamptz,
  cpu_pct integer not null default 0,
  uptime_hours integer not null default 0
);
create index if not exists routers_tenant_idx on routers (tenant_id);

create table if not exists tickets (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text references customers(id) on delete set null,
  title text not null,
  category text not null,
  priority text not null default 'normal',
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists tickets_tenant_idx on tickets (tenant_id);

create table if not exists audit_logs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_tenant_idx on audit_logs (tenant_id, created_at desc);
