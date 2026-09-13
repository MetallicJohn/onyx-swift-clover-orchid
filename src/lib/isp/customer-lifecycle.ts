import { enqueueAgentCommand, enqueueServiceCommand } from "./agent.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const CUSTOMER_OWNED_TABLES = [
  "payment_intents",
  "incoming_payments",
  "customer_ledger",
  "loyalty_transactions",
  "loyalty_accounts",
  "portal_otps",
  "portal_sessions",
  "customer_inbox",
] as const;

function sanitizeMac(raw: string) {
  const hex = String(raw || "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase();
  if (hex.length === 12) return hex.match(/.{2}/g)?.join(":") ?? hex;
  return String(raw || "").trim();
}

async function loadService(sql: Sql, tenantId: string, serviceId: string) {
  const [svc] = await sql<{
    id: string;
    customer_id: string;
    package_id: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    mac_address: string;
    status: string;
    package_name: string;
    download_mbps: number;
    upload_mbps: number;
  }>`select s.id, s.customer_id, s.package_id, s.access_method, s.username, s.static_ip,
            coalesce(s.mac_address,'') as mac_address, s.status, p.name as package_name,
            p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  return svc ?? null;
}

async function nasTeardown(sql: Sql, tenantId: string, svc: NonNullable<Awaited<ReturnType<typeof loadService>>>) {
  await enqueueServiceCommand(sql, tenantId, { ...svc, status: "terminated" });
  const [prov] = await sql<{ framed_ip: string; username: string }>`
    select framed_ip, username from service_provisioning
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  const framed = (prov?.framed_ip || svc.static_ip || "").trim();
  const user = svc.username || prov?.username || "";
  if (framed) {
    await enqueueAgentCommand(sql, tenantId, "queue.remove", {
      qname: `pppoe-${user}`.slice(0, 32),
      static_ip: framed,
      username: user,
      service_id: svc.id,
    });
  }
  if (user) {
    await sql`update radius_sessions set stopped_at = now()
      where tenant_id = ${tenantId} and username = ${user} and stopped_at is null`;
  }
}

/** Removes a line from the NAS and the database. The customer record is left intact. */
export async function deleteService(sql: Sql, tenantId: string, serviceId: string) {
  const svc = await loadService(sql, tenantId, serviceId);
  if (!svc) throw new Error("Service not found");
  await nasTeardown(sql, tenantId, svc);
  await sql`update ip_addresses set status = 'available', service_id = null
    where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  await sql`update cpe_devices set service_id = null
    where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  await sql`delete from services where id = ${serviceId} and tenant_id = ${tenantId}`;
  return { id: serviceId, customer_id: svc.customer_id };
}

export async function reassignService(sql: Sql, tenantId: string, serviceId: string, newCustomerId: string) {
  const svc = await loadService(sql, tenantId, serviceId);
  if (!svc) throw new Error("Service not found");
  const [cus] = await sql<{ id: string }>`
    select id from customers where id = ${newCustomerId} and tenant_id = ${tenantId}`;
  if (!cus) throw new Error("Customer not found");
  if (svc.customer_id === newCustomerId) {
    return { id: serviceId, from: svc.customer_id, to: newCustomerId };
  }
  await sql`update services set customer_id = ${newCustomerId}
    where id = ${serviceId} and tenant_id = ${tenantId}`;
  await sql`update service_provisioning set customer_id = ${newCustomerId}
    where service_id = ${serviceId} and tenant_id = ${tenantId}`;
  await sql`update cpe_devices set customer_id = ${newCustomerId}
    where service_id = ${serviceId} and tenant_id = ${tenantId}`;
  await sql`update ip_addresses set customer_id = ${newCustomerId}
    where service_id = ${serviceId} and tenant_id = ${tenantId}`;
  return { id: serviceId, from: svc.customer_id, to: newCustomerId };
}

export async function updateService(
  sql: Sql,
  tenantId: string,
  data: {
    id: string;
    package_id?: string;
    username?: string | null;
    static_ip?: string | null;
    mac_address?: string;
    customer_id?: string;
  },
) {
  const svc = await loadService(sql, tenantId, data.id);
  if (!svc) throw new Error("Service not found");
  if (data.customer_id && data.customer_id !== svc.customer_id) {
    await reassignService(sql, tenantId, data.id, data.customer_id);
  }
  let packageId = svc.package_id;
  if (data.package_id && data.package_id !== svc.package_id) {
    const [pkg] = await sql<{ id: string; access_method: string }>`
      select id, access_method from packages where id = ${data.package_id} and tenant_id = ${tenantId}`;
    if (!pkg) throw new Error("Package not found");
    packageId = pkg.id;
  }
  const username = data.username === undefined ? svc.username : data.username?.trim() || null;
  const staticIp = data.static_ip === undefined ? svc.static_ip : data.static_ip?.trim() || null;
  const mac = data.mac_address === undefined ? svc.mac_address : sanitizeMac(data.mac_address);
  await sql`update services
    set package_id = ${packageId},
        username = ${username},
        static_ip = ${staticIp},
        mac_address = ${mac}
    where id = ${data.id} and tenant_id = ${tenantId}`;
  const next = await loadService(sql, tenantId, data.id);
  if (next) await enqueueServiceCommand(sql, tenantId, next);
  return { id: data.id };
}

/** Deletes the customer and any lines still assigned to them. Reassigned lines are kept. */
export async function deleteCustomer(sql: Sql, tenantId: string, customerId: string) {
  const [cus] = await sql<{ id: string; name: string }>`
    select id, name from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!cus) throw new Error("Customer not found");
  const leftover = await sql<{ id: string }>`
    select id from services where customer_id = ${customerId} and tenant_id = ${tenantId}`;
  for (const row of leftover) {
    await deleteService(sql, tenantId, row.id);
  }
  await sql`update cpe_devices set customer_id = null, service_id = null
    where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  for (const table of CUSTOMER_OWNED_TABLES) {
    try {
      await sql.query(`delete from ${table} where tenant_id = $1 and customer_id = $2`, [tenantId, customerId]);
    } catch {
      /* table or column may not exist yet */
    }
  }
  try {
    await sql.query(`delete from referrals where tenant_id = $1 and referrer_id = $2`, [tenantId, customerId]);
  } catch {
    /* optional */
  }
  await sql`delete from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  return { id: customerId, name: cus.name, services_removed: leftover.length };
}

export async function customerTraffic(sql: Sql, tenantId: string, customerId: string) {
  const [cus] = await sql<{ id: string }>`
    select id from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!cus) throw new Error("Customer not found");
  const lines = await sql<{
    id: string;
    username: string | null;
    static_ip: string | null;
    package_name: string;
    status: string;
    access_method: string;
  }>`select s.id, s.username, s.static_ip, p.name as package_name, s.status, s.access_method
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.customer_id = ${customerId}
     order by s.created_at desc`;
  const usernames = lines.map((l) => l.username).filter((u): u is string => Boolean(u));
  const sessions = usernames.length
    ? await sql.query<{
        username: string;
        framed_ip: string;
        nas_ip: string;
        bytes_in: number;
        bytes_out: number;
        started_at: string;
        stopped_at: string | null;
      }>(
        `select username, framed_ip, nas_ip, bytes_in, bytes_out,
                started_at::text as started_at, stopped_at::text as stopped_at
         from radius_sessions
         where tenant_id = $1 and username = any($2::text[])
         order by started_at desc`,
        [tenantId, usernames],
      )
    : [];
  const liveByUser = new Map<string, (typeof sessions)[number]>();
  for (const ses of sessions) {
    if (liveByUser.has(ses.username)) continue;
    liveByUser.set(ses.username, ses);
  }
  return {
    at: new Date().toISOString(),
    source: "radius-accounting" as const,
    lines: lines.map((line) => {
      const ses = line.username ? liveByUser.get(line.username) : undefined;
      const online = Boolean(ses && !ses.stopped_at);
      return {
        service_id: line.id,
        username: line.username || "",
        package_name: line.package_name,
        status: line.status,
        access_method: line.access_method,
        online,
        framed_ip: online ? ses?.framed_ip || line.static_ip || "" : line.static_ip || "",
        nas_ip: online ? ses?.nas_ip || "" : "",
        bytes_in: online ? Number(ses?.bytes_in || 0) : 0,
        bytes_out: online ? Number(ses?.bytes_out || 0) : 0,
        started_at: online ? ses?.started_at || null : null,
      };
    }),
  };
}

export { sanitizeMac };
