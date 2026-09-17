-- Continuing-client / migration onboarding: preserve existing expiry as the
-- first-renewal billing anchor. Import date never becomes the paid-through date.

alter table services add column if not exists onboarding_type text not null default 'new';
alter table services add column if not exists subscription_start_date date;
alter table services add column if not exists billing_anchor_date date;
alter table services add column if not exists send_onboarding_notification boolean not null default false;
alter table services add column if not exists import_source text not null default '';
alter table services add column if not exists import_batch_id text;
alter table services add column if not exists first_renewal_invoiced_at timestamptz;

do $$ begin
  alter table services drop constraint if exists services_onboarding_type_check;
  alter table services add constraint services_onboarding_type_check
    check (onboarding_type in ('new','continuing','reactivation'));
exception when others then null;
end $$;

create index if not exists services_billing_anchor_idx
  on services (tenant_id, billing_anchor_date)
  where deleted_at is null and billing_anchor_date is not null;
create index if not exists services_import_batch_idx
  on services (tenant_id, import_batch_id)
  where import_batch_id is not null;
