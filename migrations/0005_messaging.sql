-- Per-tenant SMS + WhatsApp API config and payment/billing channel preferences.

create table if not exists messaging_settings (
  tenant_id text primary key references tenants(id) on delete cascade,
  payment_sms boolean not null default true,
  payment_whatsapp boolean not null default true,
  billing_sms boolean not null default true,
  billing_whatsapp boolean not null default false,
  sms_provider text not null default 'africastalking',
  sms_sender_id text not null default '',
  sms_username text not null default '',
  sms_api_key text not null default '',
  sms_sandbox boolean not null default true,
  wa_provider text not null default 'meta',
  wa_phone_id text not null default '',
  wa_access_token text not null default '',
  wa_business_id text not null default '',
  wa_sandbox boolean not null default true,
  updated_at timestamptz not null default now()
);
