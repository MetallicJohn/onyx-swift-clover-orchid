create table if not exists reseller_otps (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  reseller_id text not null references resellers(id) on delete cascade,
  phone text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false
);

create table if not exists reseller_sessions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  reseller_id text not null references resellers(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists reseller_sessions_token_idx on reseller_sessions (token);
