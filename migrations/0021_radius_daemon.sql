-- NAS shared secret for the FreeRADIUS sidecar (UDP 1812/1813).
alter table tenants add column if not exists radius_nas_secret text not null default '';
