import { logEvent } from "./obs.ts";
import { metricIncr } from "./metrics.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type TrafficIdentity = {
  tenant_id: string;
  username?: string;
  framed_ip?: string;
  nas_ip?: string;
};

export type TrafficMapping = {
  tenant_id: string;
  customer_id: string;
  service_id: string;
  package_id: string;
  access_method: string;
  username: string;
  static_ip: string;
  package_name: string;
  customer_name: string;
  download_mbps: number;
  upload_mbps: number;
  bundle_used_mb: number;
  bundle_mb: number;
  router_id: string;
  router_name: string;
};

export type RouterRef = {
  id: string;
  tenant_id: string;
  name: string;
  host: string;
};

export function identityKey(row: { username?: string; service_id?: string; framed_ip?: string }) {
  const user = String(row.username || "").trim();
  if (user) return `u:${user}`;
  const svc = String(row.service_id || "").trim();
  if (svc) return `s:${svc}`;
  const ip = String(row.framed_ip || "").trim();
  if (ip) return `ip:${ip}`;
  return "";
}

function hostOf(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/\d+$/, "")
    .split("/")[0]
    .split(":")[0]
    .trim();
}

export async function loadRouterIndex(sql: Sql, tenantIds: string[]) {
  const ids = [...new Set(tenantIds.filter(Boolean))];
  const map = new Map<string, RouterRef[]>();
  if (!ids.length) return map;
  const rows = await sql.query<{
    id: string;
    tenant_id: string;
    name: string;
    wg_address: string;
    api_host: string;
  }>(
    `select id, tenant_id, name, coalesce(wg_address,'') as wg_address, coalesce(api_host,'') as api_host
     from routers where tenant_id = any($1::text[])`,
    [ids],
  );
  for (const r of rows) {
    const list = map.get(r.tenant_id) || [];
    list.push({
      id: r.id,
      tenant_id: r.tenant_id,
      name: r.name,
      host: hostOf(r.api_host) || hostOf(r.wg_address),
    });
    map.set(r.tenant_id, list);
  }
  return map;
}

export function matchRouter(index: Map<string, RouterRef[]>, tenantId: string, nasIp: string) {
  const host = hostOf(nasIp);
  if (!host) return null;
  const list = index.get(tenantId) || [];
  return list.find((r) => r.host && r.host === host) || null;
}

export async function loadServiceMaps(sql: Sql, tenantIds: string[]) {
  const ids = [...new Set(tenantIds.filter(Boolean))];
  const byUser = new Map<string, TrafficMapping>();
  const byIp = new Map<string, TrafficMapping>();
  if (!ids.length) return { byUser, byIp };
  const rows = await sql.query<{
    tenant_id: string;
    service_id: string;
    customer_id: string;
    package_id: string;
    access_method: string;
    username: string;
    static_ip: string;
    radius_username: string;
    package_name: string;
    customer_name: string;
    download_mbps: number;
    upload_mbps: number;
    bundle_used_mb: number;
    bundle_mb: number;
  }>(
    `select s.tenant_id, s.id as service_id, s.customer_id, s.package_id, s.access_method,
            coalesce(s.username,'') as username, coalesce(s.static_ip,'') as static_ip,
            coalesce(a.username,'') as radius_username,
            p.name as package_name, c.name as customer_name,
            p.download_mbps, p.upload_mbps, s.bundle_used_mb, p.bundle_mb
     from services s
     join packages p on p.id = s.package_id
     join customers c on c.id = s.customer_id
     left join radius_accounts a on a.service_id = s.id and a.tenant_id = s.tenant_id
     where s.tenant_id = any($1::text[]) and s.deleted_at is null and c.deleted_at is null`,
    [ids],
  );
  for (const r of rows) {
    const mapping: TrafficMapping = {
      tenant_id: r.tenant_id,
      customer_id: r.customer_id,
      service_id: r.service_id,
      package_id: r.package_id,
      access_method: r.access_method,
      username: r.username || r.radius_username,
      static_ip: r.static_ip,
      package_name: r.package_name,
      customer_name: r.customer_name,
      download_mbps: Number(r.download_mbps || 0),
      upload_mbps: Number(r.upload_mbps || 0),
      bundle_used_mb: Number(r.bundle_used_mb || 0),
      bundle_mb: Number(r.bundle_mb || 0),
      router_id: "",
      router_name: "",
    };
    for (const user of [r.username, r.radius_username]) {
      if (user) byUser.set(`${r.tenant_id}\0${user}`, mapping);
    }
    if (r.static_ip) byIp.set(`${r.tenant_id}\0${r.static_ip}`, mapping);
  }
  return { byUser, byIp };
}

export function mapIdentity(
  maps: { byUser: Map<string, TrafficMapping>; byIp: Map<string, TrafficMapping> },
  row: TrafficIdentity,
): TrafficMapping | null {
  const user = String(row.username || "").trim();
  if (user) {
    const hit = maps.byUser.get(`${row.tenant_id}\0${user}`);
    if (hit) return hit;
  }
  const ip = String(row.framed_ip || "").trim();
  if (ip) {
    const hit = maps.byIp.get(`${row.tenant_id}\0${ip}`);
    if (hit) return hit;
  }
  return null;
}

export function noteUnmapped(row: TrafficIdentity) {
  metricIncr("traffic.unmapped");
  logEvent("info", "traffic.unmapped", {
    operation: "traffic.map",
    category: "traffic",
    tenantId: row.tenant_id,
    result: "skipped",
  });
}
