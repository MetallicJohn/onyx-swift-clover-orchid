-- GenieACS device management: assignment, inventory facts, task verification.
-- Reuses cpe_devices + acs_tasks. Does not duplicate customers or services.

alter table cpe_devices alter column last_inform drop not null;
alter table cpe_devices alter column last_inform set default null;
alter table cpe_devices alter column status set default 'unknown';

alter table cpe_devices add column if not exists manufacturer text not null default '';
alter table cpe_devices add column if not exists model text not null default '';
alter table cpe_devices add column if not exists mac_address text not null default '';
alter table cpe_devices add column if not exists ip_address text not null default '';
alter table cpe_devices add column if not exists device_type text not null default 'cpe';
alter table cpe_devices add column if not exists notes text not null default '';
alter table cpe_devices add column if not exists source text not null default 'nbi';
alter table cpe_devices add column if not exists hardware_version text not null default '';
alter table cpe_devices add column if not exists software_version text not null default '';
alter table cpe_devices add column if not exists vendor_profile text not null default '';
alter table cpe_devices add column if not exists assigned_at timestamptz;
alter table cpe_devices add column if not exists assigned_by text not null default '';
alter table cpe_devices add column if not exists assigned_by_label text not null default '';
alter table cpe_devices add column if not exists last_task_status text not null default '';
alter table cpe_devices add column if not exists last_task_error text not null default '';
alter table cpe_devices add column if not exists last_optical_at timestamptz;
alter table cpe_devices add column if not exists last_wifi_at timestamptz;
alter table cpe_devices add column if not exists last_scan_at timestamptz;
alter table cpe_devices add column if not exists wifi_snapshot text not null default '{}';
alter table cpe_devices add column if not exists optical_snapshot text not null default '{}';

update cpe_devices
   set model = product_class
 where coalesce(model, '') = '' and coalesce(product_class, '') <> '';

create unique index if not exists cpe_devices_service_uniq
  on cpe_devices (tenant_id, service_id)
  where service_id is not null;
create index if not exists cpe_devices_customer_idx on cpe_devices (tenant_id, customer_id);
create index if not exists cpe_devices_status_idx on cpe_devices (tenant_id, status);
create index if not exists cpe_devices_type_idx on cpe_devices (tenant_id, device_type);
create index if not exists cpe_devices_acs_id_idx on cpe_devices (tenant_id, acs_device_id);

alter table acs_tasks add column if not exists actor_id text not null default '';
alter table acs_tasks add column if not exists actor_label text not null default '';
alter table acs_tasks add column if not exists nbi_accepted boolean not null default false;
alter table acs_tasks add column if not exists verified_at timestamptz;
alter table acs_tasks add column if not exists verified_value text not null default '';
alter table acs_tasks add column if not exists error_message text not null default '';
alter table acs_tasks add column if not exists phase text not null default '';
