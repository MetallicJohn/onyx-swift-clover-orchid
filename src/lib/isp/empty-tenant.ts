type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** ISP records that belong to customers/network — not login, plan, or payment-rail settings. */
export const TENANT_BUSINESS_TABLES = [
  "acs_tasks",
  "incoming_payments",
  "payment_allocations",
  "customer_ledger",
  "payment_intents",
  "payment_webhooks",
  "invoice_items",
  "payments",
  "invoices",
  "partial_payment_events",
  "business_credit_events",
  "radius_auth_events",
  "radius_sessions",
  "interface_metrics",
  "router_metrics",
  "traffic_daily",
  "traffic_hourly",
  "traffic_minute",
  "traffic_samples",
  "job_queue",
  "radius_accounts",
  "agent_commands",
  "router_provision_events",
  "router_config_versions",
  "router_pool_assignments",
  "wireguard_peers",
  "hotspot_vouchers",
  "hotspot_purchases",
  "hotspot_deployments",
  "hotspot_portal_settings",
  "ip_addresses",
  "ip_pools",
  "portal_otps",
  "portal_sessions",
  "loyalty_transactions",
  "loyalty_accounts",
  "referrals",
  "reseller_transactions",
  "reseller_wallets",
  "reseller_otps",
  "reseller_sessions",
  "ticket_comments",
  "tickets",
  "cpe_devices",
  "service_provisioning",
  "customer_tag_assignments",
  "customer_tags",
  "comm_recipients",
  "comm_campaigns",
  "comm_templates",
  "services",
  "customers",
  "resellers",
  "packages",
  "routers",
  "tenant_router_provisioning",
  "audit_logs",
  "notification_logs",
  "customer_inbox",
  "email_outbox",
  "ai_scripts",
  "tenant_branches",
] as const;

export function nairobiDate(at: Date | string = new Date()) {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Add whole calendar days on the Africa/Nairobi date, not on the UTC date. */
export function addNairobiDays(days: number, from: Date | string = new Date()) {
  const raw = typeof from === "string" ? from.trim() : "";
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : nairobiDate(from);
  if (!ymd) return "";
  const noon = new Date(`${ymd}T12:00:00+03:00`);
  if (Number.isNaN(noon.getTime())) return "";
  noon.setTime(noon.getTime() + Math.round(days) * 86400_000);
  return nairobiDate(noon);
}

export async function emptyTenantBusinessData(sql: Sql, tenantId: string) {
  if (!tenantId) return { cleared: 0 };
  let cleared = 0;
  for (const table of TENANT_BUSINESS_TABLES) {
    try {
      const rows = await sql.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
      cleared += Array.isArray(rows) ? rows.length : 0;
    } catch {
      /* table may not exist yet on a partial migrate */
    }
  }
  return { cleared };
}

export async function emptySeededTenantsCreatedOn(
  sql: Sql,
  tenantId: string,
  day = nairobiDate(),
) {
  const [ten] = await sql<{ demo_seeded: boolean; created_at: string }>`
    select demo_seeded, created_at::text as created_at from tenants where id = ${tenantId}`;
  if (!ten?.demo_seeded) return { emptied: false };
  if (process.env.NODE_ENV === "production") return { emptied: false };
  if (nairobiDate(ten.created_at) !== day) return { emptied: false };
  await emptyTenantBusinessData(sql, tenantId);
  await sql`update tenants set demo_seeded = false where id = ${tenantId}`;
  return { emptied: true };
}
