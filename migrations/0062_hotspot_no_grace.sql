-- Hotspot access is time-based. Billing grace and business credit do not apply.
update packages
set
  grace_days = 0,
  tier = 'residential',
  business_credit_enabled = false,
  max_credit_kes = 0,
  credit_warning_kes = 0,
  allow_service_continuity_after_expiry = false,
  send_credit_limit_warning = false,
  credit_days_limit = 0
where access_method = 'hotspot';
