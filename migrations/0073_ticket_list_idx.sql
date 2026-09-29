-- Ticket desk lists the newest tickets for one tenant, with optional status filters.
create index if not exists tickets_tenant_created_idx on tickets (tenant_id, created_at desc);
