-- Hub-and-spoke WireGuard: one controller keypair per ISP, client keys stay on routers.

alter table tenants add column if not exists wg_public text not null default '';
alter table tenants add column if not exists wg_private_ref text not null default '';
alter table tenants add column if not exists wg_endpoint_host text not null default '';
alter table tenants add column if not exists wg_listen_port integer not null default 51820;
alter table tenants add column if not exists wg_network text not null default '10.200.0.0/24';
alter table tenants add column if not exists wg_address text not null default '10.200.0.1/24';

create unique index if not exists wireguard_peers_router_uq
  on wireguard_peers (router_id) where router_id is not null;
