-- Random 5-character codes are the default when an ISP has not set a format.
-- Existing saved rows stay sequential (column default).

alter table customer_account_settings
  add column if not exists scheme text not null default 'sequence';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customer_account_scheme'
  ) then
    alter table customer_account_settings
      add constraint customer_account_scheme check (scheme in ('random', 'sequence'));
  end if;
end $$;
