-- Letter prefix/suffix can increment alphabetically. Permanent flags keep a token fixed.

alter table customer_account_settings add column if not exists prefix_permanent boolean not null default true;
alter table customer_account_settings add column if not exists suffix_permanent boolean not null default true;
alter table customer_account_settings add column if not exists next_prefix_n integer not null default 0;
alter table customer_account_settings add column if not exists next_suffix_n integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customer_account_next_prefix'
  ) then
    alter table customer_account_settings
      add constraint customer_account_next_prefix check (next_prefix_n >= 0 and next_prefix_n <= 99999999);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'customer_account_next_suffix'
  ) then
    alter table customer_account_settings
      add constraint customer_account_next_suffix check (next_suffix_n >= 0 and next_suffix_n <= 99999999);
  end if;
end $$;
