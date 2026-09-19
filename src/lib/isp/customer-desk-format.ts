import { isKenyaMobile, normalizePhone } from "./phone.ts";

export const DESK_PAGE_SIZE = 50;
export const DESK_EXPIRING_DAYS = 7;

export type DeskCustomerStatus = "all" | "active" | "inactive" | "suspended";
export type DeskServiceStatus = "all" | "active" | "expired" | "grace" | "suspended" | "pending" | "terminated";
export type DeskAccess = "all" | "pppoe" | "static" | "hotspot";
export type DeskBilling = "all" | "clear" | "due" | "overdue";
export type DeskTagMode = "any" | "all";
export type AccountState = "active" | "inactive" | "suspended";
export type LineStatus = "active" | "grace" | "suspended" | "expired" | "pending" | "none";

export type DeskFilters = {
  q: string;
  customerStatus: DeskCustomerStatus;
  serviceStatus: DeskServiceStatus;
  access: DeskAccess;
  packageName: string;
  location: string;
  billing: DeskBilling;
  expiringSoon: boolean;
  onGrace: boolean;
  overdue: boolean;
  tagIds: string[];
  tagMode: DeskTagMode;
  page: number;
  pageSize: number;
};

export type DeskServiceLine = {
  id: string;
  access_method: string;
  status: string;
  username: string | null;
  static_ip: string | null;
  package_name: string;
  period_end: string | null;
  access_until: string | null;
};

export type DeskTag = { id: string; name: string; slug?: string; enabled: boolean; customer_count?: number };

export type DeskCustomer = {
  id: string;
  type: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  status: string;
  account_number: string;
  notes: string;
  created_at: string;
  service_count: number;
  balance_kes: number;
  overdue: boolean;
  on_grace: boolean;
  account_state: AccountState;
  line_status: LineStatus;
  service_status_summary: string;
  package_summary: string;
  package_names: string[];
  access_methods: string[];
  next_expiry: string | null;
  last_activity: string | null;
  tags: { id: string; name: string; enabled: boolean }[];
  live_service_ids: string[];
  suspended_service_ids: string[];
};

export type DeskCounters = {
  total: number;
  active: number;
  suspended: number;
  overdue: number;
};

export type DeskResult = {
  customers: DeskCustomer[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  counters: DeskCounters;
  packages: string[];
  locations: string[];
  tags: DeskTag[];
};

export const EMPTY_DESK_FILTERS: DeskFilters = {
  q: "",
  customerStatus: "all",
  serviceStatus: "all",
  access: "all",
  packageName: "",
  location: "",
  billing: "all",
  expiringSoon: false,
  onGrace: false,
  overdue: false,
  tagIds: [],
  tagMode: "any",
  page: 1,
  pageSize: DESK_PAGE_SIZE,
};

const CUSTOMER_STATUSES = new Set<DeskCustomerStatus>(["all", "active", "inactive", "suspended"]);
const SERVICE_STATUSES = new Set<DeskServiceStatus>(["all", "active", "expired", "grace", "suspended", "pending", "terminated"]);
const ACCESS = new Set<DeskAccess>(["all", "pppoe", "static", "hotspot"]);
const BILLING = new Set<DeskBilling>(["all", "clear", "due", "overdue"]);

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown) {
  return value === true || value === "true" || value === "1";
}

export function normalizeDeskQuery(raw?: Partial<DeskFilters> | Record<string, unknown> | null): DeskFilters {
  const src = raw && typeof raw === "object" ? raw : {};
  const customerStatus = asString((src as DeskFilters).customerStatus) as DeskCustomerStatus;
  const serviceStatus = asString((src as DeskFilters).serviceStatus) as DeskServiceStatus;
  const access = asString((src as DeskFilters).access) as DeskAccess;
  const billing = asString((src as DeskFilters).billing) as DeskBilling;
  const tagMode = asString((src as DeskFilters).tagMode) === "all" ? "all" : "any";
  const tagIds = Array.isArray((src as DeskFilters).tagIds)
    ? [...new Set((src as DeskFilters).tagIds.filter((id): id is string => Boolean(id)))]
    : [];
  const page = Math.max(1, Math.floor(Number((src as DeskFilters).page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number((src as DeskFilters).pageSize) || DESK_PAGE_SIZE)));
  return {
    q: asString((src as DeskFilters).q).trim(),
    customerStatus: CUSTOMER_STATUSES.has(customerStatus) ? customerStatus : "all",
    serviceStatus: SERVICE_STATUSES.has(serviceStatus) ? serviceStatus : "all",
    access: ACCESS.has(access) ? access : "all",
    packageName: asString((src as DeskFilters).packageName).trim(),
    location: asString((src as DeskFilters).location).trim(),
    billing: BILLING.has(billing) ? billing : "all",
    expiringSoon: asBool((src as DeskFilters).expiringSoon),
    onGrace: asBool((src as DeskFilters).onGrace),
    overdue: asBool((src as DeskFilters).overdue),
    tagIds,
    tagMode,
    page,
    pageSize,
  };
}

export function likeNeedle(raw: string) {
  return `%${raw.replace(/[#%_]/g, (ch) => `#${ch}`).trim()}%`;
}

export function hasActiveDeskFilters(q: DeskFilters) {
  return Boolean(
    q.q ||
      q.customerStatus !== "all" ||
      q.serviceStatus !== "all" ||
      q.access !== "all" ||
      q.packageName ||
      q.location ||
      q.billing !== "all" ||
      q.expiringSoon ||
      q.onGrace ||
      q.overdue ||
      q.tagIds.length,
  );
}

export function activeDeskFilterCount(q: DeskFilters) {
  let n = 0;
  if (q.q) n += 1;
  if (q.customerStatus !== "all") n += 1;
  if (q.serviceStatus !== "all") n += 1;
  if (q.access !== "all") n += 1;
  if (q.packageName) n += 1;
  if (q.location) n += 1;
  if (q.billing !== "all") n += 1;
  if (q.expiringSoon) n += 1;
  if (q.onGrace) n += 1;
  if (q.overdue) n += 1;
  if (q.tagIds.length) n += 1;
  return n;
}

export function accountState(opts: { customerStatus: string; live: number; suspended: number }): AccountState {
  if (opts.customerStatus === "inactive") return "inactive";
  if (opts.live > 0) return "active";
  if (opts.suspended > 0 || opts.customerStatus === "suspended") return "suspended";
  return "inactive";
}

export function lineStatusFromLines(
  lines: Array<{ status: string; period_end: string | null; access_until: string | null }>,
  now = Date.now(),
): LineStatus {
  if (!lines.length) return "none";
  if (lines.some((s) => s.status === "active")) return "active";
  if (lines.some((s) => s.status === "grace")) return "grace";
  if (lines.some((s) => s.status === "pending")) return "pending";
  if (lines.some((s) => s.status === "suspended")) return "suspended";
  const ended = lines.some((s) => {
    const end = Date.parse(s.access_until || s.period_end || "");
    return Number.isFinite(end) && end < now;
  });
  if (ended || lines.every((s) => s.status === "terminated")) return "expired";
  return "none";
}

export function serviceStatusSummary(lines: Array<{ status: string }>) {
  if (!lines.length) return "No service";
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line.status, (counts.get(line.status) || 0) + 1);
  const order = ["active", "grace", "pending", "suspended", "terminated"];
  const parts = order
    .filter((status) => counts.get(status))
    .map((status) => `${counts.get(status)} ${status === "grace" ? "grace" : status}`);
  for (const [status, n] of counts) {
    if (!order.includes(status)) parts.push(`${n} ${status}`);
  }
  return parts.join(" · ");
}

export function packageSummary(names: string[]) {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return "No package";
  if (unique.length === 1) return unique[0];
  return `${unique[0]} +${unique.length - 1}`;
}

export function customerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

export function uniqueSmsRecipients(rows: Array<{ id: string; phone: string }>) {
  const seen = new Set<string>();
  const recipients: Array<{ id: string; phone: string }> = [];
  const skipped: Array<{ id: string; reason: "missing" | "invalid" | "duplicate" }> = [];
  for (const row of rows) {
    const phone = (row.phone || "").trim();
    if (!phone) {
      skipped.push({ id: row.id, reason: "missing" });
      continue;
    }
    if (!isKenyaMobile(phone)) {
      skipped.push({ id: row.id, reason: "invalid" });
      continue;
    }
    const key = normalizePhone(phone);
    if (seen.has(key)) {
      skipped.push({ id: row.id, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    recipients.push({ id: row.id, phone: key });
  }
  return { recipients, skipped };
}

export type ProfileTab = "overview" | "services" | "billing" | "tickets" | "messages" | "activity";
export type ProfileAction = "add-service" | "edit";
export type ProfileSearch = { tab?: ProfileTab; action?: ProfileAction };

export const PROFILE_TABS: ProfileTab[] = ["overview", "services", "billing", "tickets", "messages", "activity"];

export function normalizeProfileSearch(raw?: Record<string, unknown> | null): ProfileSearch {
  const src = raw && typeof raw === "object" ? raw : {};
  const tab = PROFILE_TABS.includes(src.tab as ProfileTab) ? (src.tab as ProfileTab) : undefined;
  const action = src.action === "add-service" || src.action === "edit" ? src.action : undefined;
  return {
    tab: tab === "overview" ? undefined : tab,
    action,
  };
}

export function accountStateLabel(state: string) {
  if (state === "inactive") return "Inactive";
  if (state === "suspended") return "Suspended";
  if (state === "archived") return "Archived";
  return "Active";
}

export function lineStatusLabel(status: LineStatus | string) {
  if (status === "grace") return "Grace Period";
  if (status === "none") return "No service";
  if (status === "expired") return "Expired";
  if (status === "pending") return "Pending";
  if (status === "terminated") return "Terminated";
  if (status === "suspended") return "Suspended";
  if (status === "active") return "Active";
  return status || "—";
}

export function deskFilterChips(
  q: DeskFilters,
  tags: Array<{ id: string; name: string }> = [],
): Array<{ id: string; label: string; patch: Partial<DeskFilters> }> {
  const chips: Array<{ id: string; label: string; patch: Partial<DeskFilters> }> = [];
  if (q.q) chips.push({ id: "q", label: `Search: ${q.q}`, patch: { q: "", page: 1 } });
  if (q.customerStatus !== "all") {
    chips.push({
      id: "customer",
      label: `Customer: ${accountStateLabel(q.customerStatus)}`,
      patch: { customerStatus: "all", page: 1 },
    });
  }
  if (q.serviceStatus !== "all") {
    chips.push({
      id: "service",
      label: `Service: ${lineStatusLabel(q.serviceStatus)}`,
      patch: { serviceStatus: "all", page: 1 },
    });
  }
  if (q.access !== "all") {
    const access = q.access === "pppoe" ? "PPPoE" : q.access === "static" ? "Static IP" : "Hotspot";
    chips.push({ id: "access", label: access, patch: { access: "all", page: 1 } });
  }
  if (q.packageName) chips.push({ id: "pkg", label: q.packageName, patch: { packageName: "", page: 1 } });
  if (q.location) chips.push({ id: "loc", label: q.location, patch: { location: "", page: 1 } });
  if (q.billing !== "all") {
    const billing = q.billing === "clear" ? "Paid up" : q.billing === "due" ? "Outstanding" : "Overdue";
    chips.push({
      id: "billing",
      label: billing,
      patch: { billing: "all", overdue: q.billing === "overdue" ? false : q.overdue, page: 1 },
    });
  }
  if (q.expiringSoon) chips.push({ id: "expiring", label: "Expiring soon", patch: { expiringSoon: false, page: 1 } });
  if (q.onGrace) chips.push({ id: "grace", label: "Grace", patch: { onGrace: false, page: 1 } });
  if (q.overdue && q.billing !== "overdue") chips.push({ id: "overdue", label: "Overdue", patch: { overdue: false, page: 1 } });
  for (const id of q.tagIds) {
    const tag = tags.find((t) => t.id === id);
    chips.push({
      id: `tag-${id}`,
      label: tag?.name || "Tag",
      patch: { tagIds: q.tagIds.filter((t) => t !== id), page: 1 },
    });
  }
  return chips;
}

export function customerRecordPath(id: string, search?: ProfileSearch) {
  const params = new URLSearchParams();
  if (search?.tab) params.set("tab", search.tab);
  if (search?.action) params.set("action", search.action);
  const q = params.toString();
  return `/app/customers/${id}${q ? `?${q}` : ""}`;
}

export function selectedCustomersCsv(rows: DeskCustomer[]) {
  const header = "name,id,phone,email,address,package,access,status,service_status,outstanding,expiry";
  const body = rows
    .map((r) =>
      [
        r.name,
        r.account_number,
        r.phone,
        r.email,
        r.address,
        r.package_names.join("|"),
        r.access_methods.join("|"),
        r.account_state,
        r.line_status,
        String(r.balance_kes),
        r.next_expiry || "",
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}\n`;
}
