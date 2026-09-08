create table if not exists customer_inbox (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  subject text not null default '',
  body text not null,
  event_code text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists customer_inbox_cust_idx on customer_inbox (tenant_id, customer_id, created_at desc);

create table if not exists email_outbox (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  to_addr text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists email_outbox_tenant_idx on email_outbox (tenant_id, created_at desc);
