-- Per-provider SMS gateway config. Secrets live inside this sealed JSON blob, not as one column per provider.
alter table messaging_settings add column if not exists sms_gateways text not null default '';
