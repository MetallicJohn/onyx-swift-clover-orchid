-- Platform operators (Gridline superadmin) and grants for the gridline test role.

create table if not exists platform_admins (
  user_id text primary key,
  created_at timestamptz not null default now()
);

do $$
begin
  grant select, insert, update, delete on platform_admins to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;
