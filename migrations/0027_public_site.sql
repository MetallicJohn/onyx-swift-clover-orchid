-- Public marketing site: contact enquiries. Contact details live in platform_settings.

create table if not exists platform_inquiries (
  id text primary key,
  name text not null,
  company text not null default '',
  email text not null,
  phone text not null default '',
  topic text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists platform_inquiries_created_idx on platform_inquiries (created_at desc);

insert into platform_settings (key, value) values
  ('sales_email', ''),
  ('support_email', ''),
  ('contact_phone', '')
on conflict (key) do nothing;

do $$
begin
  grant select, insert, update, delete on platform_inquiries to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table platform_inquiries enable row level security;
  alter table platform_inquiries force row level security;
  drop policy if exists platform_only on platform_inquiries;
  create policy platform_inquiries_insert on platform_inquiries for insert
    with check (true);
  create policy platform_inquiries_read on platform_inquiries for select
    using (current_setting('app.bypass_rls', true) = 'on');
end $$;
