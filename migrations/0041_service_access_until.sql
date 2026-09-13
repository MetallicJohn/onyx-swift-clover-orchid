-- Staff-controlled access expiry, separate from billing period_end.
-- access_until is the access-control date; period_end remains paid-through / renewal.

alter table services add column if not exists access_until timestamptz;
alter table services add column if not exists expiry_source text not null default 'billing';
alter table services add column if not exists expiry_changed_by text not null default '';
alter table services add column if not exists expiry_changed_at timestamptz;
alter table services add column if not exists expiry_change_reason text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_expiry_source_check'
  ) then
    alter table services
      add constraint services_expiry_source_check
      check (expiry_source in ('billing', 'staff', 'grace'));
  end if;
exception
  when undefined_object then null;
  when duplicate_object then null;
end $$;
