-- Row-level security for tenant-owned tables.
-- App queries set app.tenant_id. Migrations/bootstrap set app.bypass_rls=on.
-- The gridline role is a non-superuser used by tests (and PGLite after SET ROLE).
-- Superusers still bypass RLS; production DATABASE_URL must not be a superuser.

do $$
begin
  begin
    create role gridline nologin nosuperuser nobypassrls;
  exception
    when duplicate_object then null;
    when insufficient_privilege then null;
  end;
end $$;

grant usage on schema public to gridline;
grant select, insert, update, delete on all tables in schema public to gridline;
alter default privileges in schema public grant select, insert, update, delete on tables to gridline;

create unique index if not exists routers_enroll_token_uq
  on routers (enroll_token) where enroll_token is not null and enroll_token <> '';

do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('tenant_members', 'user_active_tenant', 'saas_trial_claims')
  loop
    execute format('alter table %I enable row level security', r.table_name);
    execute format('alter table %I force row level security', r.table_name);
    execute format('drop policy if exists tenant_isolation on %I', r.table_name);
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
      r.table_name
    );
  end loop;
end $$;
