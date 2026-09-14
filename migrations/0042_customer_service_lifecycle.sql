-- Customer notes, archive (so invoices/payments survive), service notes,
-- and stop financial rows from cascading away when a customer is removed.

alter table customers add column if not exists notes text not null default '';
alter table customers add column if not exists deleted_at timestamptz;
alter table services add column if not exists notes text not null default '';

create index if not exists customers_alive_idx
  on customers (tenant_id, created_at desc)
  where deleted_at is null;

do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'customers'::regclass
      and c.conrelid::regclass::text in ('invoices', 'payments', 'customer_ledger')
  loop
    execute format('alter table %s drop constraint if exists %I', r.tbl, r.conname);
  end loop;

  begin
    alter table invoices
      add constraint invoices_customer_id_fkey
      foreign key (customer_id) references customers(id) on delete restrict;
  exception when duplicate_object then null;
  end;

  begin
    alter table payments
      add constraint payments_customer_id_fkey
      foreign key (customer_id) references customers(id) on delete restrict;
  exception when duplicate_object then null;
  end;

  begin
    alter table customer_ledger
      add constraint customer_ledger_customer_id_fkey
      foreign key (customer_id) references customers(id) on delete restrict;
  exception when duplicate_object then null;
  end;
end $$;
