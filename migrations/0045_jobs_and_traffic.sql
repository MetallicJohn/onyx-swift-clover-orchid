-- Durable job queue (Postgres is the source of truth) and traffic samples.
-- Workers and collectors on another VPS claim work over /api/internal/*; they
-- never bypass RLS. Redis, when present, is cache/lock only.

create table if not exists job_queue (
  id text primary key,
  tenant_id text not null default '',
  queue text not null,
  kind text not null,
  payload text not null default '{}',
  status text not null default 'queued',
  idempotency_key text not null default '',
  attempts int not null default 0,
  max_attempts int not null default 8,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text not null default '',
  last_error text not null default '',
  result text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists job_queue_idempotency_uq
  on job_queue (queue, idempotency_key)
  where idempotency_key <> '';

create index if not exists job_queue_claim_idx
  on job_queue (status, queue, run_at, created_at);

create index if not exists job_queue_tenant_idx
  on job_queue (tenant_id, created_at desc);

create table if not exists traffic_collectors (
  id text primary key,
  name text not null default '',
  last_seen timestamptz,
  last_ok_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists traffic_samples (
  id text primary key,
  tenant_id text not null,
  collector_id text not null default 'default',
  username text not null default '',
  service_id text not null default '',
  nas_ip text not null default '',
  framed_ip text not null default '',
  bytes_in bigint not null default 0,
  bytes_out bigint not null default 0,
  online boolean not null default false,
  bucket_at timestamptz not null,
  collected_at timestamptz not null default now()
);

create unique index if not exists traffic_samples_bucket_uq
  on traffic_samples (collector_id, tenant_id, username, bucket_at);

create index if not exists traffic_samples_live_idx
  on traffic_samples (tenant_id, username, collected_at desc);

do $$
begin
  grant select, insert, update, delete on job_queue to ispsolutions;
  grant select, insert, update, delete on traffic_collectors to ispsolutions;
  grant select, insert, update, delete on traffic_samples to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['job_queue','traffic_samples']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (
           current_setting(''app.bypass_rls'', true) = ''on''
           or tenant_id = current_setting(''app.tenant_id'', true)
         )
         with check (
           current_setting(''app.bypass_rls'', true) = ''on''
           or tenant_id = current_setting(''app.tenant_id'', true)
         )',
      t
    );
  end loop;
end $$;
