-- Devices (GenieACS) is part of trial so the console page is available from day one.
-- Catalog insert in 0026 used ON CONFLICT DO NOTHING, so existing rows stayed without the flag.

update saas_plans
set entitlements = (coalesce(nullif(btrim(entitlements), ''), '{}')::jsonb || '{"genieacs":true}'::jsonb)::text,
    updated_at = now()
where code = 'trial';

update tenant_subscriptions
set entitlements = (coalesce(nullif(btrim(entitlements), ''), '{}')::jsonb || '{"genieacs":true}'::jsonb)::text
where plan = 'trial';

-- Starter and above already include genieacs in the catalog. Fill snapshots that omitted the key.
update tenant_subscriptions s
set entitlements = (coalesce(nullif(btrim(s.entitlements), ''), '{}')::jsonb || '{"genieacs":true}'::jsonb)::text
from saas_plans p
where p.code = s.plan
  and s.plan <> 'trial'
  and (coalesce(nullif(btrim(p.entitlements), ''), '{}')::jsonb ->> 'genieacs') = 'true'
  and not (coalesce(nullif(btrim(s.entitlements), ''), '{}')::jsonb ? 'genieacs');
