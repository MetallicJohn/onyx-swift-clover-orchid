-- Company date format: used on console pages, invoices/statements, and SMS.
-- Default dd/mm/yy (e.g. 16/09/26) so expiry and due dates match across the product.
alter table tenants add column if not exists date_format text not null default 'dd/mm/yy';
update tenants set date_format = 'dd/mm/yy' where date_format is null or btrim(date_format) = '';
