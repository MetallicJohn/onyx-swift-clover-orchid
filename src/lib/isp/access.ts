import { nid } from "@/lib/utils";
import { enrollFields, wgAddressForIndex } from "./agent";
import { emit } from "./events";
import { getMessagingSettings } from "./messaging";
import { ensureOpsSchema } from "./ops-schema";
import { seedRadiusSessions } from "./radius";

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
    package_name: string;
    download_mbps: number;
    upload_mbps: number;
  }>`select s.id, s.access_method, s.username, s.static_ip, s.status, p.name as package_name, p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  if (!svc) return null;
  await emit(sql, { type: "service.changed", tenantId, payload: { ...svc } });
  const [radius] = await sql<{ username: string; password: string; enabled: boolean }>`
    select username, password, enabled from radius_accounts
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  return radius ?? null;
}

export async function restoreCustomerAccess(sql: Sql, tenantId: string, customerId: string) {
  await sql`update services set status = 'active' where customer_id = ${customerId} and tenant_id = ${tenantId} and status in ('grace','suspended','pending')`;
  const svcs = await sql<{ id: string }>`select id from services where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  for (const s of svcs) await provisionServiceAccess(sql, tenantId, s.id);
}

export async function seedOpsForTenant(sql: Sql, tenantId: string) {
  await ensureOpsSchema(sql);
  await getMessagingSettings(sql, tenantId);

  const providers = [
    { kind: "mpesa", label: "M-Pesa Daraja" },
    { kind: "kopokopo", label: "Kopo Kopo" },
    { kind: "airtel", label: "Airtel Money" },
    { kind: "bank", label: "Bank transfer" },
  ];
  for (const p of providers) {
    const hit = await sql<{ id: string }>`select id from payment_providers where tenant_id = ${tenantId} and kind = ${p.kind}`;
    if (!hit[0]) {
      await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox)
        values (${nid("prv")}, ${tenantId}, ${p.kind}, ${p.label}, true, true)`;
    }
  }

  const pool = await sql<{ id: string }>`select id from ip_pools where tenant_id = ${tenantId}`;
  if (!pool[0]) {
    await sql`insert into ip_pools (id, tenant_id, name, cidr, next_host)
      values (${nid("pool")}, ${tenantId}, 'Static customers', '102.68.10.0/24', 20)`;
  }

  const services = await sql<{ id: string }>`select id from services where tenant_id = ${tenantId}`;
  for (const s of services) await provisionServiceAccess(sql, tenantId, s.id);
  await seedRadiusSessions(sql, tenantId);

  const routers = await sql<{ id: string; name: string; enroll_token: string }>`
    select id, name, enroll_token from routers where tenant_id = ${tenantId}`;
  let i = 0;
  for (const r of routers) {
    i += 1;
    if (!r.enroll_token) {
      const enroll = enrollFields(r.name);
      await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}, wg_address = ${wgAddressForIndex(i)}, agent_version = '0.2.0'
        where id = ${r.id}`;
    }
  }

  const hsPkg = await sql<{ id: string }>`select id from packages where tenant_id = ${tenantId} and access_method = 'hotspot' limit 1`;
  const vouchers = await sql<{ n: number }>`select count(*)::int as n from hotspot_vouchers where tenant_id = ${tenantId}`;
  if (hsPkg[0] && (vouchers[0]?.n ?? 0) === 0) {
    for (let v = 1; v <= 6; v++) {
      const code = `HS-${(100000 + v).toString(36).toUpperCase()}${v}`;
      await sql`insert into hotspot_vouchers (id, tenant_id, package_id, code, hours, status)
        values (${nid("vch")}, ${tenantId}, ${hsPkg[0].id}, ${code}, 24, ${v < 3 ? "active" : "unused"})`;
    }
  }

  const cpes = await sql<{ n: number }>`select count(*)::int as n from cpe_devices where tenant_id = ${tenantId}`;
  if ((cpes[0]?.n ?? 0) === 0) {
    const cust = await sql<{ id: string }>`select id from customers where tenant_id = ${tenantId} limit 3`;
    const devices = [
      { serial: "ZTE-4G-88921", product: "F670L", ssid: "Amina-Home" },
      { serial: "HW-HG8145-1022", product: "HG8145V5", ssid: "Njeri-Office" },
      { serial: "TK-ARCHER-4410", product: "Archer C6", ssid: "Faith-WiFi" },
    ];
    for (let d = 0; d < devices.length; d++) {
      await sql`insert into cpe_devices (id, tenant_id, serial, product_class, ssid, status, customer_id)
        values (${nid("cpe")}, ${tenantId}, ${devices[d].serial}, ${devices[d].product}, ${devices[d].ssid}, 'online', ${cust[d]?.id ?? null})`;
    }
  }

  const resellers = await sql<{ n: number }>`select count(*)::int as n from resellers where tenant_id = ${tenantId}`;
  if ((resellers[0]?.n ?? 0) === 0) {
    await sql`insert into resellers (id, tenant_id, name, phone, commission_pct, status)
      values (${nid("rsl")}, ${tenantId}, 'Westlands Agent', '+254700111222', 12, 'active')`;
    await sql`insert into resellers (id, tenant_id, name, phone, commission_pct, status)
      values (${nid("rsl")}, ${tenantId}, 'Nyali Kiosk', '+254711333444', 8, 'active')`;
  }
}
