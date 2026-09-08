alter table payment_intents add column if not exists fail_reason text not null default '';
alter table radius_accounts add column if not exists rate_limit text not null default '';
