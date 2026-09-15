-- Customer portal: initial-password flag and customer-visible ticket replies.
alter table customers add column if not exists portal_password_is_initial boolean not null default true;

alter table ticket_comments add column if not exists is_internal boolean not null default false;
alter table ticket_comments add column if not exists author_kind text not null default 'staff';

-- Existing staff notes were never shown to customers. Keep them internal.
alter table tickets add column if not exists service_id text;

