-- Tenant-scoped KRA eTIMS OSCU settings. Communication keys are sealed, never plaintext.
-- Existing invoices stay not_applicable and are not submitted retroactively.

create table if not exists etims_settings (
  tenant_id text primary key references tenants(id) on delete cascade,
  enabled boolean not null default false,
  environment text not null default 'sandbox',
  kra_pin text not null default '',
  branch_id text not null default '',
  device_serial text not null default '',
  comm_key_sealed text not null default '',
  status text not null default 'not_initialized',
  sdc_id text not null default '',
  mrc_no text not null default '',
  trade_name text not null default '',
  branch_name text not null default '',
  default_item_cd text not null default '',
  default_item_cls_cd text not null default '',
  default_tax_ty_cd text not null default '',
  default_qty_unit_cd text not null default '',
  default_pkg_unit_cd text not null default '',
  initialized_at timestamptz,
  last_success_at timestamptz,
  last_error text not null default '',
  last_error_at timestamptz,
  production_confirmed_at timestamptz,
  next_invc_no integer not null default 1,
  init_lock_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint etims_settings_environment_chk check (environment in ('sandbox', 'production')),
  constraint etims_settings_status_chk check (status in ('not_initialized', 'initialized', 'error'))
);

create table if not exists etims_item_maps (
  tenant_id text not null references tenants(id) on delete cascade,
  package_id text not null references packages(id) on delete cascade,
  item_cd text not null default '',
  item_cls_cd text not null default '',
  tax_ty_cd text not null default '',
  qty_unit_cd text not null default '',
  pkg_unit_cd text not null default '',
  updated_at timestamptz not null default now(),
  primary key (tenant_id, package_id)
);

alter table invoices add column if not exists etims_status text not null default 'not_applicable';
alter table invoices add column if not exists etims_invc_no integer;
alter table invoices add column if not exists etims_org_invc_no integer;
alter table invoices add column if not exists etims_rcpt_no text not null default '';
alter table invoices add column if not exists etims_intrl_data text not null default '';
alter table invoices add column if not exists etims_rcpt_sign text not null default '';
alter table invoices add column if not exists etims_sdc_datetime text not null default '';
alter table invoices add column if not exists etims_qr_url text not null default '';
alter table invoices add column if not exists etims_submitted_at timestamptz;
alter table invoices add column if not exists etims_error text not null default '';

alter table customers add column if not exists kra_pin text not null default '';

create index if not exists invoices_etims_status_idx on invoices (tenant_id, etims_status);

do $$
begin
  grant select, insert, update, delete on etims_settings to ispsolutions;
  grant select, insert, update, delete on etims_item_maps to ispsolutions;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['etims_settings', 'etims_item_maps']
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
