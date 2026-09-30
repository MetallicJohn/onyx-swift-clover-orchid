-- Enquiries and leads. A lead is not a customer and is never counted as one.
-- Conversion keeps the lead row and points it at the customer and service it created.

create table if not exists lead_sources (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index if not exists lead_sources_tenant_idx on lead_sources (tenant_id, sort_order, name);

create table if not exists lead_sequences (
  tenant_id text primary key references tenants(id) on delete cascade,
  next_n integer not null default 1
);

create table if not exists leads (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  lead_number text not null,
  name text not null,
  phone text not null default '',
  alternative_phone text not null default '',
  email text not null default '',
  identifier text not null default '',
  lead_source text not null default 'Other',
  lead_type text not null default 'individual',
  status text not null default 'new',
  coverage_status text not null default 'unknown',
  coverage_checked_at timestamptz,
  coverage_checked_by text not null default '',
  coverage_notes text not null default '',
  interested_package_id text references packages(id) on delete set null,
  interested_service_type text not null default '',
  latitude double precision,
  longitude double precision,
  county text not null default '',
  town text not null default '',
  area text not null default '',
  building text not null default '',
  physical_address text not null default '',
  location_notes text not null default '',
  preferred_contact_method text not null default 'phone',
  assigned_to text not null default '',
  next_follow_up_at timestamptz,
  installation_status text not null default 'not_scheduled',
  scheduled_installation_at timestamptz,
  completed_installation_at timestamptz,
  assigned_technician text not null default '',
  installation_notes text not null default '',
  notes text not null default '',
  lost_reason text not null default '',
  converted_at timestamptz,
  converted_by text not null default '',
  customer_id text references customers(id) on delete set null,
  service_id text references services(id) on delete set null,
  conversion_status text not null default 'open',
  converted_customer_label text not null default '',
  archived_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, lead_number),
  constraint leads_latitude check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint leads_longitude check (longitude is null or (longitude >= -180 and longitude <= 180)),
  constraint leads_status check (status in (
    'new', 'contacted', 'qualified', 'coverage_check', 'installation_pending',
    'installation_scheduled', 'installation_completed', 'confirmed', 'converted',
    'lost', 'cancelled', 'duplicate', 'not_interested', 'outside_coverage'
  )),
  constraint leads_coverage check (coverage_status in (
    'unknown', 'covered', 'potentially_covered', 'requires_survey', 'outside_coverage'
  )),
  constraint leads_installation check (installation_status in (
    'not_scheduled', 'scheduled', 'in_progress', 'completed', 'failed', 'cancelled'
  )),
  constraint leads_conversion check (conversion_status in ('open', 'converted')),
  constraint leads_type check (lead_type in ('individual', 'business')),
  constraint leads_contact check (preferred_contact_method in ('phone', 'whatsapp', 'sms', 'email'))
);
create index if not exists leads_tenant_status_idx on leads (tenant_id, status, created_at desc);
create index if not exists leads_tenant_phone_idx on leads (tenant_id, phone);
create index if not exists leads_tenant_follow_idx on leads (tenant_id, next_follow_up_at);
create index if not exists leads_tenant_number_idx on leads (tenant_id, lead_number);
create index if not exists leads_tenant_area_idx on leads (tenant_id, area);

create table if not exists lead_activities (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  lead_id text not null references leads(id) on delete cascade,
  activity_type text not null,
  body text not null default '',
  actor_id text not null default '',
  created_at timestamptz not null default now(),
  constraint lead_activities_type check (activity_type in (
    'NOTE', 'CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'MEETING', 'COVERAGE_CHECK',
    'SITE_SURVEY', 'INSTALLATION', 'FOLLOW_UP', 'STATUS_CHANGE', 'CONVERSION'
  ))
);
create index if not exists lead_activities_lead_idx on lead_activities (tenant_id, lead_id, created_at desc);

do $$
begin
  grant select, insert, update, delete on lead_sources to ispsolutions;
  grant select, insert, update, delete on lead_sequences to ispsolutions;
  grant select, insert, update, delete on leads to ispsolutions;
  grant select, insert, update, delete on lead_activities to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['lead_sources', 'lead_sequences', 'leads', 'lead_activities']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (
           current_setting(''app.bypass_rls'', true) = ''on''
           or tenant_id = current_setting(''app.tenant_id'', true)
         )
         with check (
           current_setting(''app.bypass_rls'', true) = ''on''
           or tenant_id = current_setting(''app.tenant_id'', true)
         )',
      t
    );
  end loop;
end $$;
