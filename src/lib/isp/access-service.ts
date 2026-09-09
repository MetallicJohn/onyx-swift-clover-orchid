import { nid } from "../utils.ts";
import { enqueueAgentCommand } from "./agent";
import { emit } from "./events";
import { nextIpv4 } from "./ipam";
import { syncRadiusAccount } from "./radius";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

async function loadService(sql: Sql, tenantId: string, serviceId: string) {
  const [svc] = await sql<{
    id: string;
    customer_id: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    status: string;
    package_name: string;
    download_mbps: number;
    upload_mbps: number;
  }>`select s.id, s.customer_id, s.access_method, s.username, s.static_ip, s.status,
            p.name as package_name, p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  return svc ?? null;
}

export async function allocateStaticIp(sql: Sql, tenantId: string, serviceId: string, customerId: string) {
  const [pool] = await sql<{ id: string; cidr: string; next_host: number }>`
    select id, cidr, next_host from ip_pools where tenant_id = ${tenantId} order by name limit 1`;
  if (!pool) throw new Error("No IP pool configured");
  let host = pool.next_host || 20;
  for (let i = 0; i < 80; i += 1) {
    const { address, nextHost } = nextIpv4(pool.cidr, host);
    host = nextHost;
    const taken = await sql<{ id: string }>`select id from ip_addresses where tenant_id = ${tenantId} and address = ${address}`;
    const onService = await sql<{ id: string }>`select id from services where tenant_id = ${tenantId} and static_ip = ${address}`;
    if (taken[0] || onService[0]) continue;
    await sql`insert into ip_addresses (id, tenant_id, pool_id, address, family, status, service_id, customer_id)
      values (${nid("ip")}, ${tenantId}, ${pool.id}, ${address}, 'ipv4', 'assigned', ${serviceId}, ${customerId})`;
    await sql`update ip_pools set next_host = ${host} where id = ${pool.id}`;
    await sql`update services set static_ip = ${address} where id = ${serviceId} and tenant_id = ${tenantId}`;
    return address;
  }
  throw new Error("IP pool exhausted");
}

export async function rotateServicePassword(sql: Sql, tenantId: string, serviceId: string) {
  const svc = await loadService(sql, tenantId, serviceId);
  if (!svc) throw new Error("Service not found");
  const password = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const radius = await syncRadiusAccount(sql, tenantId, { ...svc, password });
  await emit(sql, { type: "service.changed", tenantId, payload: { ...svc, password } });
  return { username: radius.username, password };
}

export async function disconnectSession(sql: Sql, tenantId: string, serviceId: string) {
  const svc = await loadService(sql, tenantId, serviceId);
  if (!svc) throw new Error("Service not found");
  const kind = `${svc.access_method === "static" ? "static" : svc.access_method}.disconnect`;
  await enqueueAgentCommand(sql, tenantId, kind, {
    username: svc.username,
    static_ip: svc.static_ip,
    service_id: svc.id,
  });
  if (svc.username) {
    await sql`update radius_sessions set stopped_at = now()
      where tenant_id = ${tenantId} and username = ${svc.username} and stopped_at is null`;
  }
  return { kind };
}
