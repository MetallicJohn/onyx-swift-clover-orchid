alter table tickets add column if not exists assigned_to text not null default '';
alter table tickets add column if not exists due_at timestamptz;
alter table tickets add column if not exists resolution text not null default '';

create table if not exists ticket_comments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  ticket_id text not null references tickets(id) on delete cascade,
  author_id text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_comments_ticket_idx on ticket_comments (ticket_id, created_at);

create table if not exists acs_tasks (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  cpe_id text not null references cpe_devices(id) on delete cascade,
  kind text not null,
  payload text not null default '{}',
  status text not null default 'queued',
  result text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists acs_tasks_tenant_idx on acs_tasks (tenant_id, created_at desc);

alter table customers add column if not exists reseller_id text references resellers(id) on delete set null;

create table if not exists tenant_subscriptions (
  id text primary key,
  tenant_id text not null unique references tenants(id) on delete cascade,
  plan text not null default 'trial',
  status text not null default 'trial',
  max_customers integer not null default 50,
  max_routers integer not null default 5,
  monthly_kes integer not null default 0,
  period_end timestamptz
);

create table if not exists ai_scripts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  prompt text not null,
  script text not null,
  model text not null default 'template',
  created_at timestamptz not null default now()
);
