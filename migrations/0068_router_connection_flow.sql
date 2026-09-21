-- Dual-key WireGuard and API rotation. Keep the previous live credential until
-- the new handshake/API login is verified. Additive. No customer/billing/ACS data.
alter table routers add column if not exists wg_public_previous text not null default '';
alter table routers add column if not exists wg_private_ref_previous text not null default '';
alter table routers add column if not exists api_password_previous text not null default '';

comment on column routers.wg_public_previous is 'Previous WireGuard public key kept on the hub until the new handshake is verified.';
comment on column routers.api_password_previous is 'Previous sealed API password kept until the new login succeeds.';
