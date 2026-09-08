alter table hotspot_vouchers add column if not exists expires_at timestamptz;
alter table hotspot_vouchers add column if not exists used_at timestamptz;
alter table hotspot_vouchers add column if not exists service_id text references services(id) on delete set null;
alter table hotspot_vouchers add column if not exists customer_id text references customers(id) on delete set null;
