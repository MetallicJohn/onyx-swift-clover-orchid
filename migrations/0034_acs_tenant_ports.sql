-- Per-tenant TR-069 port + ACS enablement. One GenieACS; unique public CWMP port per ISP.

alter table acs_isp_credentials add column if not exists enabled boolean not null default true;
alter table acs_isp_credentials add column if not exists cwmp_port integer;
alter table acs_isp_credentials add column if not exists public_host text not null default '';
alter table acs_isp_credentials add column if not exists password_rotated_at timestamptz;
alter table acs_isp_credentials add column if not exists last_verified_at timestamptz;
alter table acs_isp_credentials add column if not exists last_verify_ok boolean;
alter table acs_isp_credentials add column if not exists last_verify_error text not null default '';
alter table acs_isp_credentials add column if not exists created_at timestamptz not null default now();

create unique index if not exists acs_isp_cwmp_port_uq
  on acs_isp_credentials (cwmp_port)
  where cwmp_port is not null;

create unique index if not exists acs_isp_username_uq
  on acs_isp_credentials (username)
  where username <> '';

insert into platform_settings (key, value, updated_at) values
  ('acs_public_host', '', now()),
  ('acs_dns_host', '', now()),
  ('acs_port_start', '7551', now()),
  ('acs_port_end', '7999', now())
on conflict (key) do nothing;

-- Existing credential rows keep their username/password; assign sequential ports in the default range.
with ranked as (
  select tenant_id, 7550 + row_number() over (order by created_at, tenant_id) as next_port
  from acs_isp_credentials
  where cwmp_port is null
)
update acs_isp_credentials c
set cwmp_port = r.next_port
from ranked r
where c.tenant_id = r.tenant_id
  and c.cwmp_port is null
  and r.next_port between 7551 and 7999
  and r.next_port not in (7547, 7557, 7567);
