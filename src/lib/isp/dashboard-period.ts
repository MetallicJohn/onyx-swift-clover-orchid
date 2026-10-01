import { hasPermission } from "./rbac.ts";

export type DashboardPeriod = "today" | "7d" | "30d";

export type DashboardAccess = {
  payments: boolean;
  invoices: boolean;
  network: boolean;
  tickets: boolean;
  customers: boolean;
  services: boolean;
  comms: boolean;
  assign: boolean;
  settings: boolean;
  leads: boolean;
  radius: boolean;
  routers: boolean;
  /** Technician-style queue: assigned tickets and unassigned field work only. */
  assignedOnly: boolean;
};

export type RouterTone = "offline" | "critical" | "warning" | "unknown" | "healthy";

export type WorkKind = "renewal" | "overdue" | "ticket" | "churn" | "install" | "provision";
export type WorkAction = "remind" | "sms" | "assign" | "open";

export type WorkDraft = {
  id: string;
  kind: WorkKind;
  subject: string;
  context: string;
  urgency: string;
  action: WorkAction;
  actionLabel: string;
  entityId: string;
  customerId: string;
  phoneMask: string;
  href: string;
  /** Lower sorts first. Deterministic tie-break is subject, then id. */
  score: number;
};

export type DashboardOps = {
  period: DashboardPeriod;
  timezone: string;
  generatedAt: string;
  viewerName: string;
  access: DashboardAccess;
  attention: AttentionChip[];
  attentionClear: boolean;
  metrics: {
    collectedKes: number | null;
    collectedPrevKes: number | null;
    collectedHint: string;
    activeSubscribers: number | null;
    activeHint: string;
    onlineNow: number | null;
    onlineHint: string;
    outstandingKes: number | null;
    outstandingHint: string;
  };
  revenue: {
    currentLabel: string;
    previousLabel: string;
    currentTotal: number;
    previousTotal: number;
    series: Array<{ key: string; label: string; current: number; previous: number }>;
    methods: Array<{ id: string; label: string; amountKes: number; pct: number }>;
  } | null;
  network: Array<{
    id: string;
    name: string;
    location: string;
    state: RouterTone;
    detail: string;
    href: string | null;
  }> | null;
  networkMore: number;
  workQueue: WorkDraft[];
  activity: Array<{ id: string; at: string; text: string; href: string | null }>;
  setup: {
    required: boolean;
    completed: number;
    total: number;
    items: Array<{ id: string; label: string; detail: string; done: boolean; href: string; action: string }>;
  };
};

export type AttentionChip = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "critical" | "warning" | "attention";
  severity: number;
  amountKes?: number | null;
};

const DAY_MS = 86_400_000;

export function parseDashboardPeriod(value: unknown): DashboardPeriod {
  return value === "7d" || value === "30d" ? value : "today";
}

export function greetingName(full: string) {
  const token = full.trim().split(/\s+/)[0] ?? "";
  if (token.length < 2) return "";
  return token;
}

export function safeTimeZone(raw: string | null | undefined) {
  const tz = (raw || "").trim() || "Africa/Nairobi";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "Africa/Nairobi";
  }
}

export function dashboardAccess(role: string): DashboardAccess {
  const tickets = hasPermission(role, "tickets.read");
  const manageTickets = hasPermission(role, "tickets.manage");
  return {
    payments: hasPermission(role, "payments.read"),
    invoices: hasPermission(role, "invoices.read"),
    network:
      hasPermission(role, "routers.read") ||
      hasPermission(role, "traffic.view") ||
      hasPermission(role, "jobs.update"),
    tickets,
    customers: hasPermission(role, "customers.read"),
    services: hasPermission(role, "services.read"),
    comms: hasPermission(role, "communications.send"),
    assign: manageTickets,
    settings: hasPermission(role, "settings.manage"),
    leads: hasPermission(role, "leads.view"),
    radius: hasPermission(role, "radius.manage"),
    routers: hasPermission(role, "routers.read"),
    assignedOnly: hasPermission(role, "tickets.assigned.read") && !manageTickets,
  };
}

type Zoned = { y: number; m: number; d: number; h: number; min: number; s: number };

function zonedParts(date: Date, timeZone: string): Zoned {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    y: Number(bag.year),
    m: Number(bag.month),
    d: Number(bag.day),
    h: Number(bag.hour) % 24,
    min: Number(bag.minute),
    s: Number(bag.second),
  };
}

/** UTC instant for a wall-clock time in `timeZone`. */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, s: number, timeZone: string) {
  let utc = Date.UTC(y, m - 1, d, h, min, s);
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(utc), timeZone);
    const got = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    const want = Date.UTC(y, m - 1, d, h, min, s);
    if (got === want) break;
    utc += want - got;
  }
  return new Date(utc);
}

function addDays(y: number, m: number, d: number, days: number) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function fmtDay(y: number, m: number, d: number, timeZone: string) {
  const at = zonedTime(y, m, d, 12, 0, 0, timeZone);
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone }).format(at);
}

function rangeLabel(start: { y: number; m: number; d: number }, end: { y: number; m: number; d: number }, timeZone: string) {
  const a = fmtDay(start.y, start.m, start.d, timeZone);
  const b = fmtDay(end.y, end.m, end.d, timeZone);
  return a === b ? a : `${a}–${b}`;
}

export type PeriodBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
};

export type PeriodWindow = {
  period: DashboardPeriod;
  timeZone: string;
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  currentLabel: string;
  previousLabel: string;
  buckets: PeriodBucket[];
};

/**
 * Comparable windows.
 * Today compares elapsed time since local midnight with yesterday at the same clock time.
 * 7d and 30d are calendar days including today (today is partial) against the previous
 * equal-length window, also partial on its last day.
 */
export function periodWindow(period: DashboardPeriod, now: Date, timeZone: string): PeriodWindow {
  const tz = safeTimeZone(timeZone);
  const wall = zonedParts(now, tz);
  const shiftDays = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const back = period === "today" ? 0 : shiftDays - 1;
  const origin = addDays(wall.y, wall.m, wall.d, -back);
  const start = zonedTime(origin.y, origin.m, origin.d, 0, 0, 0, tz);
  const end = now;
  const prevStart = new Date(start.getTime() - shiftDays * DAY_MS);
  const prevEnd = new Date(end.getTime() - shiftDays * DAY_MS);
  const prevWallStart = zonedParts(prevStart, tz);
  const prevWallEnd = zonedParts(new Date(prevEnd.getTime() - 1), tz);

  const buckets: PeriodBucket[] = [];
  if (period === "today") {
    const lastHour = wall.h;
    for (let h = 0; h <= lastHour; h += 1) {
      const bStart = zonedTime(wall.y, wall.m, wall.d, h, 0, 0, tz);
      const bEnd = h === lastHour ? end : zonedTime(wall.y, wall.m, wall.d, h + 1, 0, 0, tz);
      const key = `${wall.y}-${String(wall.m).padStart(2, "0")}-${String(wall.d).padStart(2, "0")} ${String(h).padStart(2, "0")}`;
      buckets.push({
        key,
        label: `${String(h).padStart(2, "0")}`,
        start: bStart,
        end: bEnd,
        prevStart: new Date(bStart.getTime() - DAY_MS),
        prevEnd: new Date(bEnd.getTime() - DAY_MS),
      });
    }
  } else {
    for (let i = 0; i <= back; i += 1) {
      const day = addDays(origin.y, origin.m, origin.d, i);
      const bStart = zonedTime(day.y, day.m, day.d, 0, 0, 0, tz);
      const next = addDays(day.y, day.m, day.d, 1);
      const fullEnd = zonedTime(next.y, next.m, next.d, 0, 0, 0, tz);
      const bEnd = i === back ? end : fullEnd;
      const key = `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
      buckets.push({
        key,
        label: fmtDay(day.y, day.m, day.d, tz),
        start: bStart,
        end: bEnd,
        prevStart: new Date(bStart.getTime() - shiftDays * DAY_MS),
        prevEnd: new Date(bEnd.getTime() - shiftDays * DAY_MS),
      });
    }
  }

  const currentLabel = period === "today" ? "Today" : rangeLabel(origin, wall, tz);
  const previousLabel = period === "today" ? "Yesterday" : rangeLabel(prevWallStart, prevWallEnd, tz);
  return {
    period,
    timeZone: tz,
    start,
    end,
    prevStart,
    prevEnd,
    currentLabel,
    previousLabel,
    buckets,
  };
}

export function collectedHint(current: number, previous: number) {
  if (current <= 0 && previous <= 0) return "No payments in this period";
  if (previous <= 0) return "No previous period to compare";
  const d = previous <= 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
  return `${d > 0 ? "+" : ""}${d}% vs previous period`;
}

/** New live subscribers whose service was created in the window. Not a reconstructed historical stock. */
export function subscriberHint(added: number) {
  if (added > 0) return `+${added} this period`;
  return "No change this period";
}

export function onlineHint(online: number, active: number) {
  if (active <= 0) return online > 0 ? "Live sessions" : "No active subscribers";
  if (online > active) return "Live sessions";
  return `${Math.round((online / active) * 100)}% of active`;
}

export function outstandingHint(amount: number) {
  if (amount <= 0) return "Nothing outstanding";
  return "Open balance";
}

export function paymentMethodId(provider: string) {
  const p = provider.trim().toLowerCase();
  if (p === "mpesa" || p === "m-pesa" || p === "daraja") return "mpesa";
  if (p === "cash") return "cash";
  if (p === "bank" || p === "cheque" || p === "check") return "bank";
  if (p.includes("kopo")) return "kopokopo";
  return p || "other";
}

export function paymentMethodLabel(id: string) {
  if (id === "mpesa") return "M-Pesa";
  if (id === "cash") return "Cash";
  if (id === "bank") return "Bank";
  if (id === "kopokopo") return "Kopo Kopo";
  if (id === "other") return "Other";
  return id.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function methodSplit(rows: Array<{ provider: string; amount: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.amount <= 0) continue;
    const id = paymentMethodId(row.provider);
    totals.set(id, (totals.get(id) ?? 0) + row.amount);
  }
  const sum = [...totals.values()].reduce((s, n) => s + n, 0);
  const order = ["mpesa", "cash", "bank", "kopokopo"];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? 99 : i;
  };
  return [...totals.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])
    .map(([id, amountKes]) => ({
      id,
      label: paymentMethodLabel(id),
      amountKes,
      pct: sum > 0 ? Math.round((amountKes / sum) * 100) : 0,
    }));
}

/** Map a payment timestamp into the bucket key used by `periodWindow`. */
export function bucketKey(at: Date, window: PeriodWindow) {
  const p = zonedParts(at, window.timeZone);
  if (window.period === "today") {
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}`;
  }
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function seriesFromPayments(
  rows: Array<{ at: string; amount: number }>,
  window: PeriodWindow,
) {
  const current = new Map(window.buckets.map((b) => [b.key, 0]));
  const previous = new Map(window.buckets.map((b) => [b.key, 0]));
  for (const row of rows) {
    const at = new Date(row.at);
    if (Number.isNaN(at.getTime()) || row.amount <= 0) continue;
    if (at >= window.start && at < window.end) {
      const key = bucketKey(at, window);
      if (current.has(key)) current.set(key, (current.get(key) ?? 0) + row.amount);
    } else if (at >= window.prevStart && at < window.prevEnd) {
      const shifted = new Date(at.getTime() + (window.start.getTime() - window.prevStart.getTime()));
      const key = bucketKey(shifted, window);
      if (previous.has(key)) previous.set(key, (previous.get(key) ?? 0) + row.amount);
    }
  }
  return window.buckets.map((b) => ({
    key: b.key,
    label: b.label,
    current: current.get(b.key) ?? 0,
    previous: previous.get(b.key) ?? 0,
  }));
}

export function offlineLabel(lastSeen: string | null, now = Date.now()) {
  if (!lastSeen) return null;
  const t = Date.parse(lastSeen);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return "1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const ROUTER_STALE_MS = 3 * 60_000;
const ROUTER_UNREACHABLE_MS = 10 * 60_000;

/** Same thresholds as `routerReachability` in mikrotik-ops, kept local so the dashboard UI bundle stays free of RouterOS code. */
function routerReach(lastSeen: string | null, status: string, now: number) {
  if (status === "pending" || status === "enrolling") return lastSeen ? "connected" : "pending";
  if (!lastSeen) return "unreachable";
  const t = Date.parse(lastSeen);
  if (Number.isNaN(t)) return "unreachable";
  const age = now - t;
  if (age <= ROUTER_STALE_MS) return "connected";
  if (age <= ROUTER_UNREACHABLE_MS) return "stale";
  return "unreachable";
}

export function classifyRouter(
  row: {
    last_seen: string | null;
    wg_status: string;
    cpu_pct: number;
    memory_pct: number | null;
    enabled: boolean;
  },
  now = Date.now(),
): { state: RouterTone; detail: string } {
  if (!row.enabled) return { state: "offline", detail: "Disabled" };
  const reachability = routerReach(row.last_seen, row.wg_status, now);
  if (reachability === "pending") return { state: "unknown", detail: "Status unavailable" };
  if (reachability === "unreachable") {
    const dur = offlineLabel(row.last_seen, now);
    return { state: "offline", detail: dur ? `Offline ${dur}` : "No heartbeat" };
  }
  const cpu = Number(row.cpu_pct) || 0;
  const mem = row.memory_pct == null ? null : Number(row.memory_pct) || 0;
  if (reachability === "stale") {
    const dur = offlineLabel(row.last_seen, now);
    return { state: "warning", detail: dur ? `Last check ${dur}` : "Check overdue" };
  }
  if (cpu >= 85 || (mem != null && mem >= 90)) {
    return { state: "critical", detail: cpu >= 85 ? `CPU ${cpu}%` : `Memory ${mem}%` };
  }
  if (cpu >= 60 || (mem != null && mem >= 75)) {
    return { state: "warning", detail: cpu >= 60 ? `CPU ${cpu}%` : `Memory ${mem}%` };
  }
  if (reachability === "connected") return { state: "healthy", detail: `CPU ${cpu}%` };
  return { state: "unknown", detail: "Status unavailable" };
}

const TONE_RANK: Record<RouterTone, number> = {
  offline: 0,
  critical: 1,
  warning: 2,
  unknown: 3,
  healthy: 4,
};

export function sortRouters<T extends { state: RouterTone; name: string }>(rows: T[]) {
  return [...rows].sort((a, b) => TONE_RANK[a.state] - TONE_RANK[b.state] || a.name.localeCompare(b.name));
}

export function sortWork(items: WorkDraft[], limit = 8) {
  return [...items]
    .sort((a, b) => a.score - b.score || a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `···${digits.slice(-3)}`;
}

export function attentionItems(input: {
  access: DashboardAccess;
  offlineNames: string[];
  overdueCount: number;
  overdueKes: number;
  urgentCount: number;
  pastSla: number;
  churnCount: number;
}): AttentionChip[] {
  const items: AttentionChip[] = [];
  if (input.access.network && input.offlineNames.length) {
    items.push({
      id: "routers",
      severity: 1,
      tone: "critical",
      title: `${input.offlineNames.length} router${input.offlineNames.length === 1 ? "" : "s"} offline`,
      detail: input.offlineNames.slice(0, 3).join(", "),
      href: "/app/routers?status=offline",
    });
  }
  if (input.access.tickets && (input.urgentCount > 0 || input.pastSla > 0)) {
    const n = Math.max(input.urgentCount, input.pastSla);
    const bits = [];
    if (input.urgentCount) bits.push(`${input.urgentCount} urgent`);
    if (input.pastSla) bits.push(`${input.pastSla} past SLA`);
    items.push({
      id: "tickets",
      severity: 2,
      tone: "warning",
      title: input.urgentCount ? `${input.urgentCount} urgent ticket${input.urgentCount === 1 ? "" : "s"}` : `${n} past SLA`,
      detail: bits.join(" · "),
      href: input.urgentCount ? "/app/tickets?priority=elevated" : "/app/tickets?sla=past",
    });
  }
  if (input.access.invoices && input.overdueCount > 0) {
    items.push({
      id: "overdue",
      severity: 3,
      tone: "warning",
      title: `${input.overdueCount} overdue`,
      detail: "",
      href: "/app/billing?status=overdue",
      amountKes: input.overdueKes,
    });
  }
  if (input.access.customers && input.churnCount > 0) {
    items.push({
      id: "churn",
      severity: 4,
      tone: "attention",
      title: `${input.churnCount} high churn risk`,
      detail: "Contact today",
      href: "/app/customers?risk=high",
    });
  }
  return items.sort((a, b) => a.severity - b.severity);
}

/** Strip fields the role is not allowed to receive. Frontend hiding is not authorization. */
export function redactOps(ops: DashboardOps, access: DashboardAccess): DashboardOps {
  const next: DashboardOps = {
    ...ops,
    access,
    metrics: { ...ops.metrics },
    revenue: ops.revenue ? { ...ops.revenue, series: ops.revenue.series.map((s) => ({ ...s })), methods: [...ops.revenue.methods] } : null,
    workQueue: ops.workQueue.map((row) => ({ ...row })),
    activity: ops.activity.map((row) => ({ ...row })),
    attention: ops.attention.map((row) => ({ ...row })),
  };
  if (!access.payments) {
    next.metrics.collectedKes = null;
    next.metrics.collectedPrevKes = null;
    next.metrics.collectedHint = "";
    next.revenue = null;
    next.activity = next.activity.filter((row) => !row.id.startsWith("pay_"));
  }
  if (!access.invoices) {
    next.metrics.outstandingKes = null;
    next.metrics.outstandingHint = "";
    next.attention = next.attention.filter((row) => row.id !== "overdue");
    next.workQueue = next.workQueue.filter((row) => row.kind !== "overdue");
  }
  if (!access.customers) {
    next.attention = next.attention.filter((row) => row.id !== "churn");
    next.workQueue = next.workQueue.filter((row) => row.kind !== "churn");
    next.metrics.activeSubscribers = null;
    next.metrics.activeHint = "";
  }
  if (!access.network) {
    next.network = null;
    next.networkMore = 0;
    next.attention = next.attention.filter((row) => row.id !== "routers");
  } else if (!access.routers && next.network) {
    next.network = next.network.map((row) => ({ ...row, href: null }));
  }
  if (!access.tickets) {
    next.attention = next.attention.filter((row) => row.id !== "tickets");
    next.workQueue = next.workQueue.filter((row) => row.kind !== "ticket");
  }
  if (!access.services) {
    next.workQueue = next.workQueue.filter((row) => row.kind !== "renewal" && row.kind !== "provision");
  }
  if (!access.leads) {
    next.workQueue = next.workQueue.filter((row) => row.kind !== "install");
  }
  if (!access.comms) {
    next.workQueue = next.workQueue.map((row) =>
      row.action === "remind" || row.action === "sms"
        ? { ...row, action: "open" as const, actionLabel: "Open", phoneMask: "" }
        : { ...row, phoneMask: "" },
    );
  }
  if (!access.assign) {
    next.workQueue = next.workQueue.map((row) =>
      row.action === "assign" ? { ...row, action: "open" as const, actionLabel: "Open" } : row,
    );
  }
  next.attentionClear = next.attention.length === 0;
  return next;
}
