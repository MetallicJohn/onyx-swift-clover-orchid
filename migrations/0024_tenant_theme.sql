-- Per-tenant appearance / white-label branding.
-- Defaults match the current ISP Solutions console (teal on dark ink).

alter table tenants add column if not exists theme_preset text not null default 'teal';
alter table tenants add column if not exists theme_appearance text not null default 'dark';
alter table tenants add column if not exists theme_primary text not null default '';
alter table tenants add column if not exists theme_secondary text not null default '';
alter table tenants add column if not exists theme_accent text not null default '';
alter table tenants add column if not exists theme_logo text not null default '';
alter table tenants add column if not exists theme_favicon text not null default '';
alter table tenants add column if not exists theme_display_name text not null default '';
alter table tenants add column if not exists theme_brand_login boolean not null default true;
alter table tenants add column if not exists theme_brand_portal boolean not null default true;

update tenants set theme_preset = 'teal' where theme_preset is null or theme_preset = '';
update tenants set theme_appearance = 'dark' where theme_appearance is null or theme_appearance = '';
