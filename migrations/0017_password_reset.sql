-- Operator / superadmin password reset tokens and optional customer portal passwords.

alter table customers add column if not exists portal_password text not null default '';

create table if not exists password_resets (
  id text primary key,
  audience text not null,
  email text not null default '',
  phone text not null default '',
  user_id text,
  tenant_id text references tenants(id) on delete cascade,
  customer_id text references customers(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists password_resets_email_idx on password_resets (email, created_at desc);
create index if not exists password_resets_hash_idx on password_resets (token_hash);

do $$
begin
  begin
    grant select, insert, update, delete on table password_resets to gridline;
  exception
    when undefined_object then null;
    when insufficient_privilege then null;
  end;
end $$;

alter table password_resets enable row level security;
alter table password_resets force row level security;
drop policy if exists tenant_isolation on password_resets;
create policy tenant_isolation on password_resets
  using (
    current_setting('app.bypass_rls', true) = 'on'
    or (
      tenant_id is not null
      and tenant_id = current_setting('app.tenant_id', true)
    )
  )
  with check (
    current_setting('app.bypass_rls', true) = 'on'
    or (
      tenant_id is not null
      and tenant_id = current_setting('app.tenant_id', true)
    )
  );
