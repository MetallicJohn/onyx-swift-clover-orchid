import { nid } from "@/lib/utils";
import { enqueueAgentCommand } from "./agent";
import { mikrotikRateLimit } from "./radius-format";

export { mikrotikRateLimit, publicRadiusAccount, renderFreeRadiusUsers } from "./radius-format";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function secret() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function syncRadiusAccount(
  sql: Sql,
  tenantId: string,
  service: {
    id: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    status: string;
    download_mbps?: number;
    upload_mbps?: number;
  },
) {
  const username =
    service.username?.trim() ||
    `${service.access_method}-${service.id.slice(-6)}`;
  const enabled = service.status === "active" || service.status === "grace" || service.status === "pending";
  const group = service.access_method === "static" ? "static" : service.access_method;
  const rate = mikrotikRateLimit(service.download_mbps ?? 10, service.upload_mbps ?? 10);
  const existing = await sql<{ id: string; password: string }>`
    select id, password from radius_accounts where tenant_id = ${tenantId} and service_id = ${service.id}`;
  if (existing[0]) {
    await sql`update radius_accounts
      set username = ${username}, framed_ip = ${service.static_ip ?? ""}, group_name = ${group}, enabled = ${enabled}, rate_limit = ${rate}
      where id = ${existing[0].id}`;
    return { username, password: existing[0].password, enabled, rate_limit: rate };
  }
  const password = secret();
  await sql`insert into radius_accounts (id, tenant_id, service_id, username, password, framed_ip, group_name, enabled, rate_limit)
    values (${nid("rad")}, ${tenantId}, ${service.id}, ${username}, ${password}, ${service.static_ip ?? ""}, ${group}, ${enabled}, ${rate})`;
  return { username, password, enabled, rate_limit: rate };
}

export async function disconnectRadiusUser(sql: Sql, tenantId: string, username: string) {
  const [acc] = await sql<{
    username: string;
    group_name: string;
    service_id: string;
  }>`select username, group_name, service_id from radius_accounts
     where tenant_id = ${tenantId} and username = ${username}`;
  if (!acc) throw new Error("RADIUS user not found");
  const kind = acc.group_name === "hotspot" ? "hotspot.disable" : "pppoe.disable";
  await enqueueAgentCommand(sql, tenantId, kind, { username: acc.username, service_id: acc.service_id, status: "suspended" });
  await sql`update radius_sessions set stopped_at = now()
    where tenant_id = ${tenantId} and username = ${username} and stopped_at is null`;
  return { username: acc.username, kind };
}

export async function seedRadiusSessions(sql: Sql, tenantId: string) {
  const acc = await sql<{ username: string; framed_ip: string }>`
    select username, framed_ip from radius_accounts where tenant_id = ${tenantId} and enabled = true`;
  const existing = await sql<{ n: number }>`select count(*)::int as n from radius_sessions where tenant_id = ${tenantId}`;
  if ((existing[0]?.n ?? 0) > 0) return;
  for (const a of acc.slice(0, 4)) {
    await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
      values (${nid("ses")}, ${tenantId}, ${a.username}, ${a.framed_ip || "10.10.10." + (20 + Math.floor(Math.random() * 80))}, '10.200.0.2', ${5_000_000 + Math.floor(Math.random() * 40_000_000)}, ${1_000_000 + Math.floor(Math.random() * 8_000_000)})`;
  }
}
