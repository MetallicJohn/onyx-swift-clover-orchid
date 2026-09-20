import { ROS_API_USER } from "../brand.ts";
import { nid } from "../utils.ts";
import { initialCommandStatus } from "./command-policy";
import { ensureOpsSchema } from "./ops-schema";
import { enrollRosScript, rosOverlayUserName } from "./routeros";
import { generateWireGuardKeypair } from "./wireguard";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export function wgAddressForIndex(i: number) {
  return `10.200.0.${(i % 250) + 2}/32`;
}

function overlayLastOctet(address: string) {
  const host = (address || "").replace(/\/\d+$/, "");
  const last = Number(host.split(".").pop());
  return Number.isInteger(last) ? last : 0;
}

export async function nextWgAddress(sql: Sql, tenantId: string) {
  const rows = await sql<{ wg_address: string }>`
    select wg_address from routers where tenant_id = ${tenantId} and wg_address <> ''`;
  const used = new Set(rows.map((r) => overlayLastOctet(r.wg_address)));
  used.add(1);
  for (let i = 2; i <= 254; i += 1) {
    if (!used.has(i)) return `10.200.0.${i}/32`;
  }
  throw new Error("WireGuard overlay 10.200.0.0/24 is full");
}

export function generateRouterApiPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Buffer.from(bytes).toString("base64url").replace(/[-_]/g, "x").slice(0, 22);
}

export function enrollFields(_name: string, wgAddress?: string) {
  const token = `agt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const keys = generateWireGuardKeypair();
  return {
    token,
    wg_public: keys.publicKey,
    wg_private_sealed: keys.privateKeySealed,
    api_user: rosOverlayUserName(wgAddress || "") || ROS_API_USER,
    api_password: generateRouterApiPassword(),
  };
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

export async function enqueuePackageProfiles(
  sql: Sql,
  tenantId: string,
  pkg: { name: string; download_mbps: number; upload_mbps: number; access_method?: string },
) {
  const routers = await sql<{ id: string }>`select id from routers where tenant_id = ${tenantId}`;
  const payload = {
    package: pkg.name,
    download_mbps: pkg.download_mbps,
    upload_mbps: pkg.upload_mbps,
    access_method: pkg.access_method || "",
  };
  const ids: string[] = [];
  for (const r of routers) {
    const id = await enqueueAgentCommand(sql, tenantId, "package.sync", payload, r.id);
    if (id) ids.push(id);
  }
  return ids;
}

export function agentPullUrl(base: string, token: string) {
  const root = (base || "").replace(/\/$/, "");
  if (!root || !token) return "";
  return `${root}/api/agent/script/${encodeURIComponent(token)}`;
}

export function agentScript(opts: {
  name: string;
  identity: string;
  token: string;
  wgPublic: string;
  wgAddress: string;
  pullUrl?: string;
  wgPrivate?: string;
  serverPublic?: string;
  endpointHost?: string;
  endpointPort?: number;
  serverAddress?: string;
  apiUser?: string;
  apiPassword?: string;
  routerId?: string;
}) {
  return enrollRosScript(opts);
}
