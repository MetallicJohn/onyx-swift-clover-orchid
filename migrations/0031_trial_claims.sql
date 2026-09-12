-- One free trial per email or phone. Claims are platform-wide (not tenant-scoped).

create table if not exists saas_trial_claims (
  id text primary key,
  kind text not null,
  value text not null,
  tenant_id text not null,
  user_id text not null default '',
  created_at timestamptz not null default now(),
  constraint saas_trial_claims_kind check (kind in ('email', 'phone')),
  unique (kind, value)
);
create index if not exists saas_trial_claims_tenant_idx on saas_trial_claims (tenant_id);

insert into saas_trial_claims (id, kind, value, tenant_id, user_id)
select
  'trc_' || substr(md5(t.id || ':email:' || lower(u.email)), 1, 20),
  'email',
  lower(u.email),
  t.id,
  u.id
from tenants t
join tenant_members m on m.tenant_id = t.id and m.role = 'isp_owner'
join "user" u on u.id = m.user_id
join tenant_subscriptions s on s.tenant_id = t.id
where u.email <> ''
  and (s.plan = 'trial' or s.trial_ends_at is not null)
on conflict (kind, value) do nothing;

insert into saas_trial_claims (id, kind, value, tenant_id, user_id)
select
  'trc_' || substr(md5(t.id || ':phone:' || regexp_replace(t.support_phone, '\D', '', 'g')), 1, 20),
  'phone',
  case
    when length(regexp_replace(t.support_phone, '\D', '', 'g')) = 9
      and regexp_replace(t.support_phone, '\D', '', 'g') ~ '^[17]'
      then '254' || regexp_replace(t.support_phone, '\D', '', 'g')
    when length(regexp_replace(t.support_phone, '\D', '', 'g')) = 10
      and regexp_replace(t.support_phone, '\D', '', 'g') like '0%'
      then '254' || substr(regexp_replace(t.support_phone, '\D', '', 'g'), 2)
    when regexp_replace(t.support_phone, '\D', '', 'g') like '254%'
      then substr(regexp_replace(t.support_phone, '\D', '', 'g'), 1, 12)
    else regexp_replace(t.support_phone, '\D', '', 'g')
  end,
  t.id,
  coalesce((
    select m.user_id from tenant_members m
    where m.tenant_id = t.id and m.role = 'isp_owner'
    limit 1
  ), '')
from tenants t
join tenant_subscriptions s on s.tenant_id = t.id
where t.support_phone <> ''
  and (s.plan = 'trial' or s.trial_ends_at is not null)
on conflict (kind, value) do nothing;

do $$
begin
  grant select, insert, update, delete on saas_trial_claims to gridline;
exception
  when undefined_object then null;
  when insufficient_privilege then null;
end $$;

-- Platform-wide uniqueness: any tenant can *see* a claim, but can only insert
-- their own. Updates/deletes stay behind bypass so a tenant cannot wipe a used trial.
do $$
begin
  alter table saas_trial_claims enable row level security;
  alter table saas_trial_claims force row level security;
  drop policy if exists tenant_isolation on saas_trial_claims;
  drop policy if exists saas_trial_claims_select on saas_trial_claims;
  create policy saas_trial_claims_select on saas_trial_claims
    for select using (true);
  drop policy if exists saas_trial_claims_insert on saas_trial_claims;
  create policy saas_trial_claims_insert on saas_trial_claims
    for insert with check (
      current_setting('app.bypass_rls', true) = 'on'
      or tenant_id = current_setting('app.tenant_id', true)
    );
  drop policy if exists saas_trial_claims_mutate on saas_trial_claims;
  create policy saas_trial_claims_mutate on saas_trial_claims
    for update
    using (current_setting('app.bypass_rls', true) = 'on')
    with check (current_setting('app.bypass_rls', true) = 'on');
  drop policy if exists saas_trial_claims_delete on saas_trial_claims;
  create policy saas_trial_claims_delete on saas_trial_claims
    for delete using (current_setting('app.bypass_rls', true) = 'on');
end $$;
