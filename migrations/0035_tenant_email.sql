-- Per-tenant email sending (Resend or SMTP). Isolated by tenant_id + existing RLS.

alter table messaging_settings add column if not exists payment_email boolean not null default true;
alter table messaging_settings add column if not exists billing_email boolean not null default true;
alter table messaging_settings add column if not exists email_provider text not null default 'resend';
alter table messaging_settings add column if not exists email_from_name text not null default '';
alter table messaging_settings add column if not exists email_from_address text not null default '';
alter table messaging_settings add column if not exists email_reply_to text not null default '';
alter table messaging_settings add column if not exists email_api_key text not null default '';
alter table messaging_settings add column if not exists smtp_host text not null default '';
alter table messaging_settings add column if not exists smtp_port integer not null default 587;
alter table messaging_settings add column if not exists smtp_username text not null default '';
alter table messaging_settings add column if not exists smtp_password text not null default '';
alter table messaging_settings add column if not exists smtp_secure boolean not null default false;
alter table messaging_settings add column if not exists email_sandbox boolean not null default true;

alter table email_outbox add column if not exists from_addr text not null default '';
alter table email_outbox add column if not exists customer_id text;

alter table comm_campaigns add column if not exists channel text not null default 'sms';
alter table comm_recipients add column if not exists email text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comm_campaigns_channel'
  ) then
    alter table comm_campaigns
      add constraint comm_campaigns_channel check (channel in ('sms', 'email', 'both'));
  end if;
end $$;
