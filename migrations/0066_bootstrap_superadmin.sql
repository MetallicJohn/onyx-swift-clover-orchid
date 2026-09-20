-- Track whether the first-install platform Superadmin still uses the bootstrap password.
-- Existing operator_profiles rows stay false. Only the bootstrap account is set true at create time.
-- Additive. Does not fail if operator_profiles has not been created yet.

do $$
begin
  if to_regclass('public.operator_profiles') is null then
    return;
  end if;
  alter table operator_profiles
    add column if not exists is_default_password boolean not null default false;
exception
  when duplicate_column then null;
  when undefined_table then null;
end $$;
