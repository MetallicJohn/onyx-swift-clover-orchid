-- Per-tenant UI typeface. Allowlisted ids only (see src/lib/theme/fonts.ts).
-- Body/UI uses --font-sans; tables and money stay IBM Plex Mono.

alter table tenants add column if not exists theme_font text not null default 'outfit';

update tenants set theme_font = 'outfit' where theme_font is null or theme_font = '';
