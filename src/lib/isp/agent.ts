import { nid } from "@/lib/utils";
import { initialCommandStatus } from "./command-policy";
import { ensureOpsSchema } from "./ops-schema";
import { enrollRosScript } from "./routeros";
import { generateWireGuardKeypair } from "./wireguard";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export function wgAddressForIndex(i: number) {
  return `10.200.0.${(i % 250) + 2}/32`;
}

export function enrollFields(_name: string) {
  const token = `agt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const keys = generateWireGuardKeypair();
  return { token, wg_public: keys.publicKey, wg_private_sealed: keys.privateKeySealed };
}

export async function pickRouter(sql: Sql, tenantId: string) {
  const rows = await sql<{ id: string }>`
    select id from routers where tenant_id = ${tenantId}
    order by case when wg_status = 'connected' then 0 else 1 end, name
    limit 1`;
  return rows[0]?.id ?? null;
}

export async function enqueueAgentCommand(
  sql: Sql,
  tenantId: string,
  kind: string,
  payload: Record<string, unknown>,
  routerId?: string | null,
  requestedBy = "",
) {
  await ensureOpsSchema(sql);
  const rid = routerId ?? (await pickRouter(sql, tenantId));
  if (!rid) return null;
  const id = nid("cmd");
  const status = initialCommandStatus(kind);
  await sql`insert into agent_commands (id, tenant_id, router_id, kind, payload, status, requested_by)
    values (${id}, ${tenantId}, ${rid}, ${kind}, ${JSON.stringify(payload)}, ${status}, ${requestedBy})`;
  return id;
}

export async function enqueueServiceCommand(
  sql: Sql,
  tenantId: string,
  service: {
    id: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    status: string;
    package_name?: string;
    password?: string;
    download_mbps?: number;
    upload_mbps?: number;
  },
) {
  const action =
    service.status === "suspended" || service.status === "terminated" ? "disable" : "upsert";
  const kind = `${service.access_method}.${action}`;
  return enqueueAgentCommand(sql, tenantId, kind, {
    service_id: service.id,
    username: service.username,
    password: service.password || "",
    static_ip: service.static_ip,
    status: service.status,
    package: service.package_name ?? "",
    download_mbps: service.download_mbps ?? 10,
    upload_mbps: service.upload_mbps ?? 10,
  });
}

export function agentPullUrl(base: string, token: string) {
  const root = (base || "").replace(/\/$/, "");
  if (!root || !token) return "";
  return `${root}/api/agent/script?token=${encodeURIComponent(token)}`;
}

export function agentScript(opts: {
  name: string;
  identity: string;
  token: string;
  wgPublic: string;
  wgAddress: string;
  pullUrl?: string;
}) {
  return enrollRosScript(opts);
}
