-- Re-apply tenant isolation to every table that has tenant_id.
-- Catches router_enrollments / router_credentials / router_health_snapshots
-- (0064) and any later tenant-owned table that forgot ENABLE+FORCE RLS.
-- Additive. Does not drop data, constraints, or tables.
-- Per-table exceptions so one grant/policy failure cannot abort deploy.

do $$
begin
  grant select, insert, update, delete on
    router_enrollments, router_credentials, router_health_snapshots
    to ispsolutions;
exception
  when undefined_object then null;
  when undefined_table then null;
  when insufficient_privilege then null;
end $$;

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
    begin
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
    exception
      when others then
        raise notice '0067 skip %: %', r.table_name, sqlerrm;
    end;
  end loop;
end $$;
