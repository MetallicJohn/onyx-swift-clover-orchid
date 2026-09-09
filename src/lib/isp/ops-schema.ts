type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const _STATEMENTS = [
  `alter table routers add column if not exists enroll_token text not null default ''`,
  `alter table routers add column if not exists wg_public text not null default ''`,
  `alter table routers add column if not exists wg_address text not null default ''`,
  `alter table routers add column if not exists agent_version text not null default ''`,
  `alter table routers add column if not exists api_user text not null default 'gridline'`,
  `alter table routers add column if not exists api_password text not null default ''`,
  `alter table routers add column if not exists api_port integer not null default 443`,
  `alter table routers add column if not exists api_host text not null default ''`,
  `create table if not exists payment_providers (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    kind text not null,
    label text not null,
    enabled boolean not null default true,
    sandbox boolean not null default true,
    unique (tenant_id, kind)
  )`,
  `alter table payment_providers add column if not exists client_id text not null default ''`,
  `alter table payment_providers add column if not exists client_secret text not null default ''`,
  `alter table payment_providers add column if not exists till_number text not null default ''`,
  `alter table payment_providers add column if not exists passkey text not null default ''`,
  `alter table payment_providers add column if not exists stk_type text not null default 'paybill'`,
  `alter table tenants add column if not exists public_base_url text not null default ''`,
  `create table if not exists payment_webhooks (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    provider text not null,
    checkout_id text not null default '',
    payload text not null default '',
    status text not null default 'received',
    created_at timestamptz not null default now()
  )`,
  `create table if not exists payment_intents (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    invoice_id text not null references invoices(id),
    customer_id text not null references customers(id),
    provider text not null,
    amount_kes integer not null,
    phone text not null default '',
    checkout_id text not null,
    status text not null default 'pending',
    created_at timestamptz not null default now()
  )`,
  `create table if not exists radius_accounts (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    service_id text not null references services(id) on delete cascade,
    username text not null,
    password text not null,
    framed_ip text not null default '',
    group_name text not null default 'pppoe',
    enabled boolean not null default true,
    unique (tenant_id, username)
  )`,
  `create table if not exists radius_sessions (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    username text not null,
    framed_ip text not null default '',
    nas_ip text not null default '',
    bytes_in bigint not null default 0,
    bytes_out bigint not null default 0,
    started_at timestamptz not null default now(),
    stopped_at timestamptz
  )`,
  `create table if not exists ip_pools (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    name text not null,
    cidr text not null,
    next_host integer not null default 10
  )`,
  `create table if not exists hotspot_vouchers (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    package_id text not null references packages(id),
    code text not null,
    hours integer not null default 24,
    status text not null default 'unused',
    created_at timestamptz not null default now(),
    unique (tenant_id, code)
  )`,
  `create table if not exists agent_commands (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    router_id text not null references routers(id) on delete cascade,
    kind text not null,
    payload text not null default '{}',
    status text not null default 'queued',
    created_at timestamptz not null default now(),
    acked_at timestamptz
  )`,
  `alter table agent_commands add column if not exists result text not null default ''`,
  `create table if not exists portal_otps (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    customer_id text not null references customers(id) on delete cascade,
    phone text not null,
    code text not null,
    expires_at timestamptz not null,
    used boolean not null default false
  )`,
  `create table if not exists portal_sessions (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    customer_id text not null references customers(id) on delete cascade,
    token text not null unique,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists cpe_devices (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    serial text not null,
    product_class text not null default 'Router',
    ssid text not null default '',
    status text not null default 'online',
    customer_id text,
    last_inform timestamptz not null default now(),
    unique (tenant_id, serial)
  )`,
  `create table if not exists loyalty_accounts (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    customer_id text not null references customers(id) on delete cascade,
    points integer not null default 0,
    unique (tenant_id, customer_id)
  )`,
  `create table if not exists referrals (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    referrer_id text not null references customers(id) on delete cascade,
    referee_name text not null,
    referee_phone text not null,
    status text not null default 'pending',
    points integer not null default 200,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists resellers (
    id text primary key,
    tenant_id text not null references tenants(id) on delete cascade,
    name text not null,
    phone text not null default '',
    commission_pct integer not null default 10,
    status text not null default 'active',
    created_at timestamptz not null default now()
  )`,
];

export async function ensureOpsSchema(_sql: Sql) {
  /* M0.5: schema is applied only via versioned migrations (0001–0006). */
}
