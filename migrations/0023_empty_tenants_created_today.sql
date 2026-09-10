-- One-shot: ISPs created on 2026-09-10 (Africa/Nairobi) that still have demo seed.
-- Keeps the tenant, members, payment rails, and plan. Drops customers and network rows.
do $$
declare
  t text;
begin
  perform set_config('app.bypass_rls', 'on', false);
  for t in
    select id from tenants
    where demo_seeded = true
      and ((created_at at time zone 'Africa/Nairobi')::date) = date '2026-09-10'
  loop
    delete from acs_tasks where tenant_id = t;
    delete from incoming_payments where tenant_id = t;
    delete from payment_allocations where tenant_id = t;
    delete from customer_ledger where tenant_id = t;
    delete from payment_intents where tenant_id = t;
    delete from payment_webhooks where tenant_id = t;
    delete from invoice_items where tenant_id = t;
    delete from payments where tenant_id = t;
    delete from invoices where tenant_id = t;
    delete from radius_auth_events where tenant_id = t;
    delete from radius_sessions where tenant_id = t;
    delete from radius_accounts where tenant_id = t;
    delete from agent_commands where tenant_id = t;
    delete from wireguard_peers where tenant_id = t;
    delete from hotspot_vouchers where tenant_id = t;
    delete from ip_addresses where tenant_id = t;
    delete from ip_pools where tenant_id = t;
    delete from portal_otps where tenant_id = t;
    delete from portal_sessions where tenant_id = t;
    delete from loyalty_transactions where tenant_id = t;
    delete from loyalty_accounts where tenant_id = t;
    delete from referrals where tenant_id = t;
    delete from reseller_transactions where tenant_id = t;
    delete from reseller_wallets where tenant_id = t;
    delete from reseller_otps where tenant_id = t;
    delete from reseller_sessions where tenant_id = t;
    delete from ticket_comments where tenant_id = t;
    delete from tickets where tenant_id = t;
    delete from cpe_devices where tenant_id = t;
    delete from services where tenant_id = t;
    delete from customers where tenant_id = t;
    delete from resellers where tenant_id = t;
    delete from packages where tenant_id = t;
    delete from routers where tenant_id = t;
    delete from audit_logs where tenant_id = t;
    delete from notification_logs where tenant_id = t;
    delete from customer_inbox where tenant_id = t;
    delete from email_outbox where tenant_id = t;
    delete from ai_scripts where tenant_id = t;
    delete from tenant_branches where tenant_id = t;
    update tenants set demo_seeded = false where id = t;
  end loop;
end $$;
