-- API payment reconciliation fields. Original bill_ref is never overwritten.
alter table incoming_payments add column if not exists normalized_bill_ref text not null default '';
alter table incoming_payments add column if not exists failure_reason text not null default '';
alter table incoming_payments add column if not exists match_method text not null default '';
alter table incoming_payments add column if not exists processed_at timestamptz;
alter table incoming_payments add column if not exists processed_by text not null default '';
alter table incoming_payments add column if not exists payload_hash text not null default '';
alter table incoming_payments add column if not exists currency text not null default 'KES';
alter table incoming_payments add column if not exists reversal_of text not null default '';

create index if not exists incoming_payments_norm_idx on incoming_payments (tenant_id, normalized_bill_ref);
create index if not exists incoming_payments_channel_idx on incoming_payments (tenant_id, channel, trans_time desc);
create index if not exists incoming_payments_provider_idx on incoming_payments (tenant_id, provider, trans_time desc);
create index if not exists incoming_payments_customer_idx on incoming_payments (tenant_id, customer_id);
create index if not exists incoming_payments_received_idx on incoming_payments (tenant_id, trans_time desc, status);
