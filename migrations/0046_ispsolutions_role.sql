-- Rename the non-superuser RLS role and router API default from gridline to ispsolutions.
-- Fresh installs already create `ispsolutions` in 0013_rls.sql. Existing databases
-- that still have `gridline` are renamed here.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'gridline')
     and not exists (select 1 from pg_roles where rolname = 'ispsolutions') then
    alter role gridline rename to ispsolutions;
  end if;
  begin
    create role ispsolutions nologin nosuperuser nobypassrls;
  exception
    when duplicate_object then null;
    when insufficient_privilege then null;
  end;
end $$;

grant usage on schema public to ispsolutions;
grant select, insert, update, delete on all tables in schema public to ispsolutions;
alter default privileges in schema public grant select, insert, update, delete on tables to ispsolutions;

alter table routers alter column api_user set default 'ispsolutions';
