-- ACS username and password length. Null means "use the platform default" (12).
-- Rows that already have a secret were generated as 32-character hex and stay that way until regenerated.

alter table acs_isp_credentials add column if not exists credential_length integer;

update acs_isp_credentials
  set credential_length = 32
  where credential_length is null and coalesce(password_ref, '') <> '';
