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
  "radius_auth_events",
  "radius_sessions",
  "radius_accounts",
  "agent_commands",
  "wireguard_peers",
  "hotspot_vouchers",
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
  "services",
  "customers",
  "resellers",
  "packages",
  "routers",
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
  if (nairobiDate(ten.created_at) !== day) return { emptied: false };
  await emptyTenantBusinessData(sql, tenantId);
  await sql`update tenants set demo_seeded = false where id = ${tenantId}`;
  return { emptied: true };
}
