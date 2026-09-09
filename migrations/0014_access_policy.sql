-- Automatic access policy: paid-through period, data bundle, suspend reason.
-- 0 bundle_mb = unlimited. 0 validity_hours = use billing_interval.

alter table packages add column if not exists bundle_mb integer not null default 0;
alter table packages add column if not exists validity_hours integer not null default 0;

alter table services add column if not exists period_end timestamptz;
alter table services add column if not exists bundle_used_mb integer not null default 0;
alter table services add column if not exists suspend_reason text not null default '';

alter table tenants add column if not exists access_policy_ran_at timestamptz;

update services
   set period_end = created_at + interval '30 days'
 where period_end is null;
