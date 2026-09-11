-- Simple one-word customer labels. Tenant-scoped. No extra attributes.

create table if not exists customer_tags (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index if not exists customer_tags_tenant_idx on customer_tags (tenant_id, name);

create table if not exists customer_tag_assignments (
  tenant_id text not null references tenants(id) on delete cascade,
  customer_id text not null references customers(id) on delete cascade,
  tag_id text not null references customer_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, customer_id, tag_id)
);
create index if not exists customer_tag_assignments_tag_idx on customer_tag_assignments (tenant_id, tag_id);
create index if not exists customer_tag_assignments_cust_idx on customer_tag_assignments (tenant_id, customer_id);

do $$
begin
  grant select, insert, update, delete on customer_tags to gridline;
  grant select, insert, update, delete on customer_tag_assignments to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['customer_tags','customer_tag_assignments']
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
