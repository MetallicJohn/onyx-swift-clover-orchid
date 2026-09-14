-- Recycle Bin: archive customers and services instead of destroying them.
-- Live queries must filter deleted_at is null. Purged rows leave the bin but
-- may remain as tombstones when invoices, payments, or ledger rows still exist.

alter table customers add column if not exists deleted_by text not null default '';
alter table customers add column if not exists deleted_by_label text not null default '';
alter table customers add column if not exists deletion_reason text not null default '';
alter table customers add column if not exists deletion_source text not null default '';
alter table customers add column if not exists original_status text not null default '';
alter table customers add column if not exists restore_metadata text not null default '';
alter table customers add column if not exists purged_at timestamptz;
alter table customers add column if not exists purged_by text not null default '';
alter table customers add column if not exists purged_by_label text not null default '';

alter table services add column if not exists deleted_at timestamptz;
alter table services add column if not exists deleted_by text not null default '';
alter table services add column if not exists deleted_by_label text not null default '';
alter table services add column if not exists deletion_reason text not null default '';
alter table services add column if not exists deletion_source text not null default '';
alter table services add column if not exists original_status text not null default '';
alter table services add column if not exists restore_metadata text not null default '';
alter table services add column if not exists purged_at timestamptz;
alter table services add column if not exists purged_by text not null default '';
alter table services add column if not exists purged_by_label text not null default '';

create index if not exists customers_recycle_idx
  on customers (tenant_id, deleted_at desc)
  where deleted_at is not null and purged_at is null;

create index if not exists services_recycle_idx
  on services (tenant_id, deleted_at desc)
  where deleted_at is not null and purged_at is null;

create index if not exists services_alive_idx
  on services (tenant_id, created_at desc)
  where deleted_at is null;
