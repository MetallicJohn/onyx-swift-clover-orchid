-- Operator profiles, hashed OTP challenges, and SMS delivery log.
-- Does not alter Better Auth identity tables (user/account/session).

create table if not exists operator_profiles (
  user_id text primary key references "user" (id) on delete cascade,
  phone text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  display_name text not null default '',
  status text not null default 'ACTIVE',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  last_login_at timestamptz,
  last_login_ip text not null default '',
  password_changed_at timestamptz,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists operator_profiles_phone_idx on operator_profiles (phone) where phone <> '';
create index if not exists operator_profiles_status_idx on operator_profiles (status);

create table if not exists otp_challenges (
  id text primary key,
  user_id text,
  tenant_id text,
  purpose text not null,
  phone text not null default '',
  email text not null default '',
  otp_hash text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  used_at timestamptz,
  request_ip text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists otp_challenges_user_idx on otp_challenges (user_id, purpose, created_at desc);
create index if not exists otp_challenges_email_idx on otp_challenges (email, purpose, created_at desc);
create index if not exists otp_challenges_phone_idx on otp_challenges (phone, purpose, created_at desc);

create table if not exists sms_messages (
  id text primary key,
  tenant_id text,
  user_id text,
  phone text not null,
  provider text not null default '',
  sender_id text not null default '',
  message_type text not null,
  purpose text not null default '',
  provider_message_id text not null default '',
  status text not null,
  error_code text not null default '',
  error_message_sanitized text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists sms_messages_created_idx on sms_messages (created_at desc);
create index if not exists sms_messages_user_idx on sms_messages (user_id, created_at desc);

insert into platform_settings (key, value) values
  ('saas_sms_provider', 'africastalking'),
  ('saas_sms_api_url', ''),
  ('saas_sms_api_key', ''),
  ('saas_sms_api_secret', ''),
  ('saas_sms_username', ''),
  ('saas_sms_sender_id', ''),
  ('saas_sms_country', '254'),
  ('saas_sms_enabled', 'false'),
  ('saas_sms_otp_enabled', 'true'),
  ('saas_sms_notify_enabled', 'true'),
  ('saas_sms_otp_template', 'Your ISP Solutions verification code is {{otp}}. It expires in {{minutes}} minutes. Do not share this code with anyone.'),
  ('saas_sms_otp_ttl_minutes', '5'),
  ('saas_sms_otp_max_attempts', '5'),
  ('saas_sms_reset_per_hour', '5')
on conflict (key) do nothing;

do $$
begin
  begin
    grant select, insert, update, delete on table operator_profiles to ispsolutions;
    grant select, insert, update, delete on table otp_challenges to ispsolutions;
    grant select, insert, update, delete on table sms_messages to ispsolutions;
  exception
    when undefined_object then null;
    when insufficient_privilege then null;
  end;
end $$;

alter table otp_challenges enable row level security;
alter table otp_challenges force row level security;
drop policy if exists tenant_isolation on otp_challenges;
create policy tenant_isolation on otp_challenges
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

alter table sms_messages enable row level security;
alter table sms_messages force row level security;
drop policy if exists tenant_isolation on sms_messages;
create policy tenant_isolation on sms_messages
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
