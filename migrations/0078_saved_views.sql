-- Personal and shared table views. A lead, ticket, or customer view is workspace
-- configuration, not a customer record. Personal rows stay on the creator.

create table if not exists saved_views (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null,
  name text not null,
  resource text not null,
  filters jsonb not null default '{}'::jsonb,
  sort jsonb not null default '{}'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  density text not null default 'comfortable',
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_views_density check (density in ('comfortable', 'compact', 'dense')),
  constraint saved_views_name_len check (char_length(name) between 1 and 80)
);

create unique index if not exists saved_views_personal_name
  on saved_views (tenant_id, user_id, resource, lower(name))
  where is_shared = false;

create unique index if not exists saved_views_shared_name
  on saved_views (tenant_id, resource, lower(name))
  where is_shared = true;

create index if not exists saved_views_list_idx
  on saved_views (tenant_id, resource, is_shared, updated_at desc);

do $$
begin
  grant select, insert, update, delete on saved_views to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

alter table saved_views enable row level security;
alter table saved_views force row level security;
drop policy if exists tenant_isolation on saved_views;
create policy tenant_isolation on saved_views
  using (
    current_setting('app.bypass_rls', true) = 'on'
    or tenant_id = current_setting('app.tenant_id', true)
  )
  with check (
    current_setting('app.bypass_rls', true) = 'on'
    or tenant_id = current_setting('app.tenant_id', true)
  );
