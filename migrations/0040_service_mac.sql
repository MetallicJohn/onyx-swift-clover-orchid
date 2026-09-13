-- Customer CPE / station MAC on each service line.
alter table services add column if not exists mac_address text not null default '';
alter table cpe_devices add column if not exists mac_address text not null default '';
