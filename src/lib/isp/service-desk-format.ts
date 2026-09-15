import { likeNeedle } from "./customer-desk-format.ts";
import type { AccessMethod, ServiceRow, ServiceStatus } from "./types.ts";

export { likeNeedle };

export const SERVICE_DESK_PAGE_SIZE = 50;
export const SERVICE_DESK_EXPIRING_DAYS = 7;

export type ServiceDeskStatusFilter =
  | "all"
  | "active"
  | "pending"
  | "expired"
  | "grace"
  | "suspended"
  | "terminated";

export type ServiceDeskAccess = "all" | "pppoe" | "static" | "hotspot";
export type ServiceDeskBilling = "all" | "clear" | "due" | "overdue";
export type ServiceDeskSort =
  | "created"
  | "customer"
  | "service"
  | "package"
  | "access"
  | "status"
  | "expiry"
  | "location"
  | "router"
  | "outstanding"
  | "last_activity";
export type ServiceDeskDir = "asc" | "desc";
export type ServiceDisplayStatus = "pending" | "active" | "grace" | "expired" | "suspended" | "terminated";

export type ServiceDeskFilters = {
  q: string;
  status: ServiceDeskStatusFilter;
  access: ServiceDeskAccess;
  packageName: string;
  customerId: string;
  location: string;
  routerId: string;
  poolId: string;
  billing: ServiceDeskBilling;
  expiringSoon: boolean;
  onGrace: boolean;
  overdue: boolean;
  sort: ServiceDeskSort;
  dir: ServiceDeskDir;
  page: number;
  pageSize: number;
};

export type ServiceDeskRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  account_number: string;
  location: string;
  package_id: string;
  package_name: string;
  access_method: AccessMethod;
  username: string | null;
  static_ip: string | null;
  framed_ip: string;
  mac_address: string;
  status: ServiceStatus;
  display_status: ServiceDisplayStatus;
  created_at: string;
  period_end: string | null;
  access_until: string | null;
  expiry_source: string;
  bundle_used_mb: number;
  bundle_mb: number;
  suspend_reason: string;
  notes: string;
  download_mbps: number;
  upload_mbps: number;
  grace_active: boolean;
  grace_expires_at: string | null;
  router_id: string;
  router_name: string;
  pool_id: string;
  pool_name: string;
  assigned_ip: string;
  provision_overall: string;
  balance_kes: number;
  overdue: boolean;
  last_activity: string | null;
  session_online: boolean;
  identity: string;
};

export type ServiceDeskCounters = {
  total: number;
  active: number;
  pending: number;
  expired: number;
  suspended: number;
  grace: number;
};

export type ServiceDeskOption = { id: string; name: string };

export type ServiceDeskResult = {
  services: ServiceDeskRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  counters: ServiceDeskCounters;
  packages: string[];
  packageOptions: Array<{ id: string; name: string; access_method: string }>;
  locations: string[];
  routers: ServiceDeskOption[];
  pools: ServiceDeskOption[];
  customers: ServiceDeskOption[];
};

export const EMPTY_SERVICE_FILTERS: ServiceDeskFilters = {
  q: "",
  status: "all",
  access: "all",
  packageName: "",
  customerId: "",
  location: "",
  routerId: "",
  poolId: "",
  billing: "all",
  expiringSoon: false,
  onGrace: false,
  overdue: false,
  sort: "created",
  dir: "desc",
  page: 1,
  pageSize: SERVICE_DESK_PAGE_SIZE,
};

const STATUSES = new Set<ServiceDeskStatusFilter>([
  "all",
  "active",
  "pending",
  "expired",
  "grace",
  "suspended",
  "terminated",
]);
const ACCESS = new Set<ServiceDeskAccess>(["all", "pppoe", "static", "hotspot"]);
const BILLING = new Set<ServiceDeskBilling>(["all", "clear", "due", "overdue"]);
const SORTS = new Set<ServiceDeskSort>([
  "created",
  "customer",
  "service",
  "package",
  "access",
  "status",
  "expiry",
  "location",
  "router",
  "outstanding",
  "last_activity",
]);

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown) {
  return value === true || value === "true" || value === "1";
}

export function normalizeServiceDeskQuery(
  raw?: Partial<ServiceDeskFilters> | Record<string, unknown> | null,
): ServiceDeskFilters {
  const src = raw && typeof raw === "object" ? raw : {};
  const status = asString((src as ServiceDeskFilters).status) as ServiceDeskStatusFilter;
  const access = asString((src as ServiceDeskFilters).access) as ServiceDeskAccess;
  const billing = asString((src as ServiceDeskFilters).billing) as ServiceDeskBilling;
  const sort = asString((src as ServiceDeskFilters).sort) as ServiceDeskSort;
  const dir = asString((src as ServiceDeskFilters).dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Math.floor(Number((src as ServiceDeskFilters).page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number((src as ServiceDeskFilters).pageSize) || SERVICE_DESK_PAGE_SIZE)));
  return {
    q: asString((src as ServiceDeskFilters).q).trim(),
    status: STATUSES.has(status) ? status : "all",
    access: ACCESS.has(access) ? access : "all",
    packageName: asString((src as ServiceDeskFilters).packageName).trim(),
    customerId: asString((src as ServiceDeskFilters).customerId).trim(),
    location: asString((src as ServiceDeskFilters).location).trim(),
    routerId: asString((src as ServiceDeskFilters).routerId).trim(),
    poolId: asString((src as ServiceDeskFilters).poolId).trim(),
    billing: BILLING.has(billing) ? billing : "all",
    expiringSoon: asBool((src as ServiceDeskFilters).expiringSoon),
    onGrace: asBool((src as ServiceDeskFilters).onGrace),
    overdue: asBool((src as ServiceDeskFilters).overdue),
    sort: SORTS.has(sort) ? sort : "created",
    dir,
    page,
    pageSize,
  };
}

export function hasActiveServiceFilters(q: ServiceDeskFilters) {
  return Boolean(
    q.q ||
      q.status !== "all" ||
      q.access !== "all" ||
      q.packageName ||
      q.customerId ||
      q.location ||
      q.routerId ||
      q.poolId ||
      q.billing !== "all" ||
      q.expiringSoon ||
      q.onGrace ||
      q.overdue,
  );
}

export function activeServiceFilterCount(q: ServiceDeskFilters) {
  let n = 0;
  if (q.q) n += 1;
  if (q.status !== "all") n += 1;
  if (q.access !== "all") n += 1;
  if (q.packageName) n += 1;
  if (q.customerId) n += 1;
  if (q.location) n += 1;
  if (q.routerId) n += 1;
  if (q.poolId) n += 1;
  if (q.billing !== "all") n += 1;
  if (q.expiringSoon) n += 1;
  if (q.onGrace) n += 1;
  if (q.overdue && q.billing !== "overdue") n += 1;
  return n;
}

export function isAccessExpired(
  row: { status: string; period_end: string | null; access_until: string | null },
  now = Date.now(),
) {
  if (row.status === "active" || row.status === "grace" || row.status === "pending") return false;
  const end = Date.parse(row.access_until || row.period_end || "");
  return Number.isFinite(end) && end < now;
}

export function displayServiceStatus(
  row: { status: string; period_end: string | null; access_until: string | null; grace_active?: boolean },
  now = Date.now(),
): ServiceDisplayStatus {
  if (row.status === "grace" || row.grace_active) return "grace";
  if (row.status === "pending") return "pending";
  if (row.status === "active") return "active";
  if (isAccessExpired(row, now)) return "expired";
  if (row.status === "terminated") return "terminated";
  if (row.status === "suspended") return "suspended";
  return "pending";
}

export function serviceStatusLabel(status: string) {
  if (status === "grace") return "Grace Period";
  if (status === "expired") return "Expired";
  if (status === "pending") return "Pending";
  if (status === "terminated") return "Terminated";
  if (status === "suspended") return "Suspended";
  if (status === "active") return "Active";
  return status || "—";
}

export function suspendReasonLabel(reason: string) {
  const value = String(reason || "").trim();
  if (!value) return "";
  if (value === "time") return "Expiry";
  if (value === "invoice") return "Non-payment";
  if (value === "bundle") return "Data cap";
  if (value === "manual") return "Staff action";
  if (value === "expired_by_staff_date_change") return "Staff expiry date";
  if (value === "terminated") return "Terminated";
  return value.replaceAll("_", " ");
}

export function networkIdentity(row: {
  access_method: string;
  username: string | null;
  static_ip: string | null;
  framed_ip?: string | null;
}) {
  if (row.access_method === "static") return row.static_ip || row.framed_ip || "";
  return row.username || row.static_ip || row.framed_ip || "";
}

export function speedLabel(down: number, up: number) {
  if (!down && !up) return "—";
  return `${down}/${up} Mbps`;
}

export function sessionLabel(online: boolean, lastActivity: string | null) {
  if (online) return "Online";
  if (lastActivity) return "Offline";
  return "No session";
}

export function serviceRecordPath(id: string) {
  return `/app/services/${id}`;
}

export function serviceDeskFilterChips(
  q: ServiceDeskFilters,
  opts: { customers?: ServiceDeskOption[]; routers?: ServiceDeskOption[]; pools?: ServiceDeskOption[] } = {},
): Array<{ id: string; label: string; patch: Partial<ServiceDeskFilters> }> {
  const chips: Array<{ id: string; label: string; patch: Partial<ServiceDeskFilters> }> = [];
  if (q.q) chips.push({ id: "q", label: `Search: ${q.q}`, patch: { q: "", page: 1 } });
  if (q.status !== "all") {
    chips.push({ id: "status", label: serviceStatusLabel(q.status), patch: { status: "all", page: 1 } });
  }
  if (q.access !== "all") {
    const access = q.access === "pppoe" ? "PPPoE" : q.access === "static" ? "Static IP" : "Hotspot";
    chips.push({ id: "access", label: access, patch: { access: "all", page: 1 } });
  }
  if (q.packageName) chips.push({ id: "pkg", label: q.packageName, patch: { packageName: "", page: 1 } });
  if (q.customerId) {
    const name = opts.customers?.find((c) => c.id === q.customerId)?.name || "Customer";
    chips.push({ id: "customer", label: name, patch: { customerId: "", page: 1 } });
  }
  if (q.location) chips.push({ id: "loc", label: q.location, patch: { location: "", page: 1 } });
  if (q.routerId) {
    const name = opts.routers?.find((r) => r.id === q.routerId)?.name || "Router";
    chips.push({ id: "router", label: name, patch: { routerId: "", page: 1 } });
  }
  if (q.poolId) {
    const name = opts.pools?.find((p) => p.id === q.poolId)?.name || "IP pool";
    chips.push({ id: "pool", label: name, patch: { poolId: "", page: 1 } });
  }
  if (q.billing !== "all") {
    const billing = q.billing === "clear" ? "Paid up" : q.billing === "due" ? "Outstanding" : "Overdue";
    chips.push({
      id: "billing",
      label: billing,
      patch: { billing: "all", overdue: q.billing === "overdue" ? false : q.overdue, page: 1 },
    });
  }
  if (q.expiringSoon) chips.push({ id: "expiring", label: "Expiring soon", patch: { expiringSoon: false, page: 1 } });
  if (q.onGrace) chips.push({ id: "grace", label: "Grace Period", patch: { onGrace: false, page: 1 } });
  if (q.overdue && q.billing !== "overdue") chips.push({ id: "overdue", label: "Overdue", patch: { overdue: false, page: 1 } });
  return chips;
}

export function toServiceRow(s: ServiceDeskRow): ServiceRow {
  return {
    id: s.id,
    customer_id: s.customer_id,
    customer_name: s.customer_name,
    customer_phone: s.customer_phone,
    account_number: s.account_number,
    package_id: s.package_id,
    package_name: s.package_name,
    access_method: s.access_method,
    username: s.username,
    static_ip: s.static_ip,
    mac_address: s.mac_address,
    status: s.status,
    created_at: s.created_at,
    period_end: s.period_end,
    access_until: s.access_until,
    expiry_source: s.expiry_source,
    bundle_used_mb: s.bundle_used_mb,
    bundle_mb: s.bundle_mb,
    suspend_reason: s.suspend_reason,
    notes: s.notes,
    download_mbps: s.download_mbps,
    upload_mbps: s.upload_mbps,
    grace_active: s.grace_active,
    grace_expires_at: s.grace_expires_at,
  };
}

export function selectedServicesCsv(rows: ServiceDeskRow[]) {
  const header =
    "service_id,customer,account_number,phone,email,location,access,package,speed,identity,router,pool,status,expiry,outstanding,session";
  const body = rows
    .map((r) =>
      [
        r.id,
        r.customer_name,
        r.account_number,
        r.customer_phone,
        r.customer_email,
        r.location,
        r.access_method,
        r.package_name,
        speedLabel(r.download_mbps, r.upload_mbps),
        r.identity,
        r.router_name,
        r.pool_name,
        r.display_status,
        r.access_until || r.period_end || "",
        String(r.balance_kes),
        sessionLabel(r.session_online, r.last_activity),
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

export const SERVICE_DESK_SORT_SQL: Record<ServiceDeskSort, string> = {
  created: "s.created_at",
  customer: "c.name",
  service: "s.id",
  package: "p.name",
  access: "s.access_method",
  status: "s.status",
  expiry: "coalesce(s.access_until, s.period_end)",
  location: "c.address",
  router: "coalesce(r.name,'')",
  outstanding: "coalesce(bal.balance_kes,0)",
  last_activity: "rs.last_at",
};
