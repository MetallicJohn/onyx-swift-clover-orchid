-- Tenant branding for invoices and statements (per-ISP, never hardcoded).

alter table tenants add column if not exists address text not null default '';
alter table tenants add column if not exists website text not null default '';
alter table tenants add column if not exists tax_pin text not null default '';
alter table tenants add column if not exists invoice_footer text not null default 'Thank you for your business.';
alter table tenants add column if not exists invoice_notes text not null default '';
alter table tenants add column if not exists brand_color text not null default '';
alter table tenants add column if not exists bank_name text not null default '';
alter table tenants add column if not exists bank_account text not null default '';
alter table tenants add column if not exists bank_branch text not null default '';
