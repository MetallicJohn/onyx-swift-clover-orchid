-- Track whether the first-install platform Superadmin still uses the bootstrap password.
-- Existing operator_profiles rows stay false. Only the bootstrap account is set true at create time.

alter table operator_profiles
  add column if not exists is_default_password boolean not null default false;
