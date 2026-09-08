import { nid } from "@/lib/utils";
import { enqueueServiceCommand } from "./agent";
import { getMessagingSettings } from "./messaging";
import { ensureOpsSchema } from "./ops-schema";
import { seedRadiusSessions, syncRadiusAccount } from "./radius";

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
  const radius = await syncRadiusAccount(sql, tenantId, svc);
  await enqueueServiceCommand(sql, tenantId, {
    ...svc,
    username: radius.username,
    password: radius.password,
  });
  return radius;
}

export async function restoreCustomerAccess(sql: Sql, tenantId: string, customerId: string) {
  await sql`update services set status = 'active' where customer_id = ${customerId} and tenant_id = ${tenantId} and status in ('grace','suspended','pending')`;
  const svcs = await sql<{ id: string }>`select id from services where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  for (const s of svcs) await provisionServiceAccess(sql, tenantId, s.id);
}

export async function awardLoyalty(sql: Sql, tenantId: string, customerId: string, amountKes: number) {
  await ensureOpsSchema(sql);
  const points = Math.floor(amountKes / 10);
  const existing = await sql<{ id: string; points: number }>`
    select id, points from loyalty_accounts where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  if (existing[0]) {
    await sql`update loyalty_accounts set points = ${existing[0].points + points} where id = ${existing[0].id}`;
  } else {
    await sql`insert into loyalty_accounts (id, tenant_id, customer_id, points)
      values (${nid("loy")}, ${tenantId}, ${customerId}, ${points})`;
  }
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
      const token = `agt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const wgPublic = Buffer.from(r.name + token).toString("base64").slice(0, 44);
      await sql`update routers set enroll_token = ${token}, wg_public = ${wgPublic}, wg_address = ${`10.200.0.${i + 1}/32`}, agent_version = '0.1.0'
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
