import { likeNeedle } from "./customer-desk-format.ts";
import { cidrSpan, ipv4InCidr, parseIpv4, parseV4Cidr } from "./ipam.ts";

export { likeNeedle };

export const ROUTER_DESK_PAGE_SIZE = 50;

export const POOL_ACCESS_TYPES = ["pppoe", "static", "hotspot", "other"] as const;
export type PoolAccessType = (typeof POOL_ACCESS_TYPES)[number] | "";

export const POOL_STATUSES = ["active", "disabled", "archived"] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

export type RouterDeskStatus = "all" | "online" | "offline" | "awaiting" | "disabled" | "archived";

export type RouterDeskFilters = {
  q: string;
  status: RouterDeskStatus;
  location: string;
  vendor: string;
  hasPools: boolean;
  hasServices: boolean;
  page: number;
  pageSize: number;
};

export const EMPTY_ROUTER_FILTERS: RouterDeskFilters = {
  q: "",
  status: "all",
  location: "",
  vendor: "",
  hasPools: false,
  hasServices: false,
  page: 1,
  pageSize: ROUTER_DESK_PAGE_SIZE,
};

export type RouterDeskRow = {
  id: string;
  name: string;
  identity: string;
  management_ip: string;
  model: string;
  vendor: string;
  site_pop: string;
  location: string;
  role: string;
  wg_status: string;
  provisioning_status: string;
  reachability: string;
  online: boolean;
  enabled: boolean;
  archived: boolean;
  last_seen: string | null;
  pool_count: number;
  service_count: number;
  customer_count: number;
};

export type RouterDeskCounters = {
  total: number;
  online: number;
  awaiting: number;
  disabled: number;
};

export type PoolDraft = {
  name: string;
  code?: string;
  cidr: string;
  gateway?: string;
  first_ip?: string;
  last_ip?: string;
  access_type?: string;
  vlan_id?: number | string | null;
  site_pop?: string;
  description?: string;
  status?: string;
  dns_servers?: string;
  package_id?: string;
};

export type NormalizedPoolDraft = {
  name: string;
  code: string;
  cidr: string;
  gateway: string;
  first_ip: string;
  last_ip: string;
  access_type: PoolAccessType;
  vlan_id: number | null;
  site_pop: string;
  description: string;
  status: PoolStatus;
  dns_servers: string;
  package_id: string;
  first_int: number;
  last_int: number;
  next_host: number;
};

export function routerRecordPath(id: string, extra?: { tab?: string; action?: string }) {
  const params = new URLSearchParams();
  if (extra?.tab) params.set("tab", extra.tab);
  if (extra?.action) params.set("action", extra.action);
  const q = params.toString();
  return q ? `/app/routers/${id}?${q}` : `/app/routers/${id}`;
}

export function normalizeRouterDeskQuery(raw: Partial<RouterDeskFilters> | null | undefined): RouterDeskFilters {
  const page = Math.max(1, Math.round(Number(raw?.page) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.round(Number(raw?.pageSize) || ROUTER_DESK_PAGE_SIZE)));
  const status = raw?.status;
  return {
    q: String(raw?.q || "").trim().slice(0, 80),
    status:
      status === "online" ||
      status === "offline" ||
      status === "awaiting" ||
      status === "disabled" ||
      status === "archived"
        ? status
        : "all",
    location: String(raw?.location || "").trim().slice(0, 80),
    vendor: String(raw?.vendor || "").trim().slice(0, 80),
    hasPools: Boolean(raw?.hasPools),
    hasServices: Boolean(raw?.hasServices),
    page,
    pageSize,
  };
}

export function activeRouterFilterCount(q: RouterDeskFilters) {
  return (
    (q.status !== "all" ? 1 : 0) +
    (q.location ? 1 : 0) +
    (q.vendor ? 1 : 0) +
    (q.hasPools ? 1 : 0) +
    (q.hasServices ? 1 : 0)
  );
}

export function poolUsage(total: number, used: number) {
  const size = Math.max(0, total);
  const taken = Math.max(0, Math.min(used, size));
  return { total: size, used: taken, available: Math.max(0, size - taken) };
}

function asAccess(raw: string | undefined): PoolAccessType {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "pppoe" || v === "static" || v === "hotspot" || v === "other") return v;
  return "";
}

function asStatus(raw: string | undefined): PoolStatus {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "disabled" || v === "archived") return v;
  return "active";
}

export function validatePoolDraft(input: PoolDraft): NormalizedPoolDraft {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Pool name is required");
  const cidr = String(input.cidr || "").trim();
  parseV4Cidr(cidr);
  const span = cidrSpan(cidr);
  const gateway = String(input.gateway || "").trim();
  if (gateway) {
    parseIpv4(gateway);
    if (!ipv4InCidr(gateway, cidr)) throw new Error("Gateway must belong to the pool network");
  }
  let first = String(input.first_ip || "").trim();
  let last = String(input.last_ip || "").trim();
  if (!first) first = formatFromInt(span.firstHost);
  if (!last) last = formatFromInt(span.lastHost);
  const firstInt = parseIpv4(first);
  const lastInt = parseIpv4(last);
  if (firstInt > lastInt) throw new Error("Start IP must not exceed end IP");
  if (firstInt < span.network || lastInt > span.broadcast) {
    throw new Error("Start and end IP must belong to the CIDR");
  }
  const vlanRaw = input.vlan_id;
  let vlan_id: number | null = null;
  if (vlanRaw !== undefined && vlanRaw !== null && String(vlanRaw).trim() !== "") {
    const n = Number(vlanRaw);
    if (!Number.isInteger(n) || n < 1 || n > 4094) throw new Error("VLAN ID must be 1–4094");
    vlan_id = n;
  }
  const nextHost = Math.min(254, Math.max(1, (firstInt & 255) || 10));
  return {
    name,
    code: String(input.code || "").trim().slice(0, 40),
    cidr,
    gateway,
    first_ip: first,
    last_ip: last,
    access_type: asAccess(input.access_type),
    vlan_id,
    site_pop: String(input.site_pop || "").trim().slice(0, 80),
    description: String(input.description || "").trim().slice(0, 500),
    status: asStatus(input.status),
    dns_servers: String(input.dns_servers || "").trim().slice(0, 200),
    package_id: String(input.package_id || "").trim(),
    first_int: firstInt,
    last_int: lastInt,
    next_host: nextHost,
  };
}

function formatFromInt(n: number) {
  const x = n >>> 0;
  return [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join(".");
}

export function rangeOverlaps(aFirst: number, aLast: number, bFirst: number, bLast: number) {
  return aFirst <= bLast && bFirst <= aLast;
}

export function listPayloadHasSecrets(payload: unknown) {
  return /wg_private|private_key|provision_token_hash|enroll_token|api_password|enc:v1:/i.test(
    JSON.stringify(payload),
  );
}
