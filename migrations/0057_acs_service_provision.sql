-- TR-069 auto-provision: WAN PPPoE, SSID, and Wi-Fi password from the assigned service.
-- Applied by the GenieACS ispsolutions-service provision on Inform. Empty values are not written.

alter table services add column if not exists wifi_ssid text not null default '';
alter table services add column if not exists wifi_password_ref text not null default '';

insert into platform_settings (key, value, updated_at) values
  ('acs_provision_service', 'true', now())
on conflict (key) do nothing;
