-- Compact router desk: archive/disable, richer IP pools, usage fields.
-- Existing MikroTik provisioning, WireGuard, and RADIUS paths are unchanged.

alter table routers add column if not exists vendor text not null default '';
alter table routers add column if not exists enabled boolean not null default true;
alter table routers add column if not exists archived_at timestamptz;

alter table ip_pools add column if not exists code text not null default '';
alter table ip_pools add column if not exists gateway text not null default '';
alter table ip_pools add column if not exists first_ip text not null default '';
alter table ip_pools add column if not exists last_ip text not null default '';
alter table ip_pools add column if not exists access_type text not null default '';
alter table ip_pools add column if not exists vlan_id integer;
alter table ip_pools add column if not exists site_pop text not null default '';
alter table ip_pools add column if not exists description text not null default '';
alter table ip_pools add column if not exists status text not null default 'active';
alter table ip_pools add column if not exists dns_servers text not null default '';
alter table ip_pools add column if not exists package_id text;
alter table ip_pools add column if not exists archived_at timestamptz;
alter table ip_pools add column if not exists updated_at timestamptz not null default now();

create index if not exists ip_pools_tenant_status_idx on ip_pools (tenant_id, status);
create index if not exists routers_tenant_archived_idx on routers (tenant_id, archived_at);
