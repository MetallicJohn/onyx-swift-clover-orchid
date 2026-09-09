-- GenieACS NBI adapter (daemon stays in its own container).
alter table tenants add column if not exists acs_nbi_url text not null default '';
alter table tenants add column if not exists acs_nbi_user text not null default '';
alter table tenants add column if not exists acs_nbi_pass_ref text not null default '';
alter table tenants add column if not exists acs_oui text not null default '';

alter table cpe_devices add column if not exists manufacturer_oui text not null default '';
alter table cpe_devices add column if not exists acs_device_id text not null default '';
alter table cpe_devices add column if not exists last_inform_raw text not null default '';

alter table acs_tasks add column if not exists acs_task_id text not null default '';
alter table acs_tasks add column if not exists dispatched_at timestamptz;
