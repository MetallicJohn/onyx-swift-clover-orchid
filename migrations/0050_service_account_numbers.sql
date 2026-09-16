-- Each service is its own billed account. Customer account numbers stay
-- for the profile / legacy paybill. Billing, payments, restore, and matching
-- use the service number.

alter table services add column if not exists account_number text not null default '';
alter table services add column if not exists name text not null default '';

create unique index if not exists services_account_number_uq
  on services (tenant_id, account_number)
  where account_number <> '';

create index if not exists services_account_number_idx
  on services (tenant_id, account_number)
  where account_number <> '';

alter table invoices add column if not exists service_id text;
create index if not exists invoices_service_idx on invoices (tenant_id, service_id);

alter table payments add column if not exists service_id text;
create index if not exists payments_service_idx on payments (tenant_id, service_id);

alter table customer_ledger add column if not exists service_id text;
create index if not exists customer_ledger_service_idx on customer_ledger (tenant_id, service_id);

alter table incoming_payments add column if not exists service_id text;
create index if not exists incoming_payments_service_idx on incoming_payments (tenant_id, service_id);

alter table payment_intents add column if not exists service_id text;

-- Pin existing single-service invoices to that service so restore/pay stay scoped.
update invoices i
set service_id = sub.service_id
from (
  select invoice_id, min(service_id) as service_id
  from invoice_items
  where service_id is not null and service_id <> ''
  group by invoice_id
  having count(distinct service_id) = 1
) sub
where i.id = sub.invoice_id and (i.service_id is null or i.service_id = '');

update payments p
set service_id = i.service_id
from invoices i
where i.id = p.invoice_id and p.service_id is null and i.service_id is not null;

update payment_intents pi
set service_id = i.service_id
from invoices i
where i.id = pi.invoice_id and pi.service_id is null and i.service_id is not null;

update customer_ledger l
set service_id = i.service_id
from invoices i
where l.ref_type = 'invoice' and l.ref_id = i.id and l.service_id is null and i.service_id is not null;

update customer_ledger l
set service_id = p.service_id
from payments p
where l.ref_type = 'payment' and l.ref_id = p.id and l.service_id is null and p.service_id is not null;
