-- TR-069 security: ACS URL scheme, CPE digest auth, URL lock. Defaults keep existing
-- OLT profiles on HTTP. Digest auth and URL lock are on for new and existing installs.

insert into platform_settings (key, value, updated_at) values
  ('acs_tls', 'http', now()),
  ('acs_require_cpe_auth', 'true', now()),
  ('acs_lock_url', 'true', now())
on conflict (key) do nothing;
