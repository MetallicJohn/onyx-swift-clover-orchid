import { backfillServiceAccountNumbers } from "./account-numbers";
import { nid } from "../utils.ts";
import { enrollFields, wgAddressForIndex } from "./agent";
import { emptySeededTenantsCreatedOn } from "./empty-tenant";
import { ensureTenantHub, syncRouterWgPeer } from "./wireguard";
import { emit } from "./events";
import { getMessagingSettings } from "./messaging";
import { ensureOpsSchema } from "./ops-schema";

export { awardLoyalty } from "./loyalty";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function provisionServiceAccess(sql: Sql, tenantId: string, serviceId: string) {
  await ensureOpsSchema(sql);
  const [svc] = await sql<{
    id: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    status: string;
    suspend_reason: string;
    package_name: string;
    download_mbps: number;
    upload_mbps: number;
  }>`select s.id, s.access_method, s.username, s.static_ip, s.status, coalesce(s.suspend_reason,'') as suspend_reason, p.name as package_name, p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId} and s.deleted_at is null`;
  if (!svc) return null;
  await emit(sql, { type: "service.changed", tenantId, payload: { ...svc } });
  const [radius] = await sql<{ username: string; password: string; enabled: boolean }>`
    select username, password, enabled from radius_accounts
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  return radius ?? null;
}

export async function restoreCustomerAccess(sql: Sql, tenantId: string, customerId: string, serviceId?: string) {
  const { grantPaidPeriod } = await import("./access-policy.ts");
  const { consumeActiveGrantsForCustomer, consumeActiveGrantsForService } = await import("./grace.ts");
  await grantPaidPeriod(sql, tenantId, customerId, new Date(), serviceId);
  if (serviceId) await consumeActiveGrantsForService(sql, tenantId, serviceId);
  else await consumeActiveGrantsForCustomer(sql, tenantId, customerId);
  if (serviceId) {
    await sql`update services set status = 'active', suspend_reason = ''
      where id = ${serviceId} and customer_id = ${customerId} and tenant_id = ${tenantId}
        and deleted_at is null and status in ('grace','suspended','pending')`;
    await provisionServiceAccess(sql, tenantId, serviceId);
    return;
  }
  await sql`update services set status = 'active', suspend_reason = ''
    where customer_id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null and status in ('grace','suspended','pending')`;
  const svcs = await sql<{ id: string }>`select id from services where tenant_id = ${tenantId} and customer_id = ${customerId} and deleted_at is null`;
  for (const s of svcs) await provisionServiceAccess(sql, tenantId, s.id);
}

export async function seedOpsForTenant(sql: Sql, tenantId: string) {
  await ensureOpsSchema(sql);
  await emptySeededTenantsCreatedOn(sql, tenantId);
  await getMessagingSettings(sql, tenantId);
  try {
    await backfillServiceAccountNumbers(sql, tenantId);
  } catch {
    /* account numbers apply after 0050; ignore on unmigrated previews */
  }

  const providers = [
    { kind: "mpesa", label: "M-Pesa Daraja" },
    { kind: "kopokopo", label: "Kopo Kopo" },
    { kind: "airtel", label: "Airtel Money" },
    { kind: "bank", label: "Bank transfer" },
  ];
  const existing = await sql<{ kind: string }>`
    select kind from payment_providers where tenant_id = ${tenantId}`;
  const have = new Set(existing.map((row) => row.kind));
  for (const p of providers) {
    if (have.has(p.kind)) continue;
    await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox)
      values (${nid("prv")}, ${tenantId}, ${p.kind}, ${p.label}, true, true)`;
  }

  const routers = await sql<{
    id: string;
    name: string;
    enroll_token: string;
    wg_public: string | null;
    wg_address: string | null;
  }>`
    select id, name, enroll_token, wg_public, wg_address from routers where tenant_id = ${tenantId}`;
  await ensureTenantHub(sql, tenantId);
  let i = 0;
  for (const r of routers) {
    i += 1;
    if (r.enroll_token) continue;
    const address = r.wg_address || wgAddressForIndex(i);
    const enroll = enrollFields(r.name, address);
    if (r.wg_public) {
      await sql`update routers set enroll_token = ${enroll.token} where id = ${r.id} and tenant_id = ${tenantId}`;
      continue;
    }
    await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}, wg_address = ${address}, agent_version = '0.2.0'
      where id = ${r.id} and tenant_id = ${tenantId} and coalesce(wg_public, '') = ''`;
    await syncRouterWgPeer(sql, tenantId, {
      id: r.id,
      wg_public: enroll.wg_public,
      wg_private_ref: enroll.wg_private_sealed,
      wg_address: address,
    });
  }
}
