-- Prompt 3: audit rows are append-only. Tenant administrators cannot update or delete them.
-- Rollback: drop trigger audit_logs_no_update on audit_logs; drop function audit_logs_append_only();

create or replace function audit_logs_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;

drop trigger if exists audit_logs_no_update on audit_logs;
create trigger audit_logs_no_update
  before update or delete on audit_logs
  for each row execute function audit_logs_append_only();
