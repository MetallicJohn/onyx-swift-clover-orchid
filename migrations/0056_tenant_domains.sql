-- Tenant public domains: central app URL, per-ISP subdomains, and verified custom hosts.
-- Resolver never invents a hostname. Unverified custom domains are never selected.

create table if not exists tenant_domains (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  hostname text not null,
  kind text not null,
  subdomain_slug text not null default '',
  domain_status text not null default 'pending',
  dns_status text not null default 'pending',
  https_status text not null default 'pending',
  is_primary boolean not null default false,
  is_active boolean not null default false,
  is_verified boolean not null default false,
  verification_token text not null default '',
  verification_txt_name text not null default '',
  verification_txt_expected text not null default '',
  verification_txt_actual text not null default '',
  dns_target text not null default '',
  dns_verified_at timestamptz,
  https_verified_at timestamptz,
  verified_at timestamptz,
  verified_by text not null default '',
  certificate_subject text not null default '',
  certificate_issuer text not null default '',
  certificate_expires_at timestamptz,
  last_checked_at timestamptz,
  last_error text not null default '',
  https_failure_reason text not null default '',
  verification_attempts integer not null default 0,
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_domains_kind_chk check (kind in ('system', 'subdomain', 'custom')),
  constraint tenant_domains_dns_chk check (dns_status in ('pending', 'verified', 'failed')),
  constraint tenant_domains_https_chk check (https_status in ('pending', 'verified', 'failed', 'expired'))
);

create unique index if not exists tenant_domains_hostname_uq
  on tenant_domains (lower(hostname));
create unique index if not exists tenant_domains_primary_uq
  on tenant_domains (tenant_id)
  where is_primary and is_active and domain_status = 'active';
create index if not exists tenant_domains_tenant_idx
  on tenant_domains (tenant_id, kind, domain_status);
create index if not exists tenant_domains_status_idx
  on tenant_domains (domain_status, is_active);

insert into platform_settings (key, value) values
  ('app_public_url', ''),
  ('tenant_subdomain_base', ''),
  ('central_domain_only', 'false')
on conflict (key) do nothing;

do $$
begin
  grant select, insert, update, delete on table tenant_domains to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
begin
  alter table tenant_domains enable row level security;
  alter table tenant_domains force row level security;
  drop policy if exists tenant_isolation on tenant_domains;
  create policy tenant_isolation on tenant_domains
    using (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    )
    with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );
end $$;
