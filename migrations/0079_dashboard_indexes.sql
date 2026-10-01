-- Dashboard aggregates: tenant-scoped payments, invoices, services, tickets, live sessions.
create index if not exists payments_dashboard_idx on payments (tenant_id, status, paid_at desc);
create index if not exists invoices_dashboard_idx on invoices (tenant_id, status, due_date);
create index if not exists services_dashboard_status_idx on services (tenant_id, status) where deleted_at is null;
create index if not exists tickets_dashboard_open_idx on tickets (tenant_id, status, priority);
create index if not exists radius_sessions_open_idx on radius_sessions (tenant_id) where stopped_at is null;
