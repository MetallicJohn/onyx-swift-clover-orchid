/** Client-safe hotspot dashboard helpers. No database. No Node crypto. */

export const HOTSPOT_DASH_POLL_MS = 20_000;
export const HOTSPOT_STALE_MS = 120_000;
export const HIGH_SESSION_ALERT = 100;
export const DEFAULT_HOTSPOT_TZ = "Africa/Nairobi";

export type HotspotRouterStatus = "online" | "offline" | "warning" | "unknown";

export type HotspotAlertKind =
  | "router_offline"
  | "router_stale"
  | "high_sessions"
  | "failed_callbacks"
  | "radius_unavailable"
  | "traffic_unavailable";

const SAFE_TZ = /^[A-Za-z0-9_+\-/]+$/;

export function normalizeHotspotTimezone(raw: string | null | undefined) {
  const t = (raw || "").trim();
  if (t && SAFE_TZ.test(t)) return t;
  return DEFAULT_HOTSPOT_TZ;
}

export function ymdInZone(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeHotspotTimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeHotspotTimezone(timeZone),
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));
  return asUtc - instant.getTime();
}

export function zonedWallTime(ymd: string, timeZone: string, hour = 0, minute = 0, second = 0) {
  const [y, m, d] = ymd.split("-").map(Number);
  const tz = normalizeHotspotTimezone(timeZone);
  const wallAsUtc = Date.UTC(y, (m || 1) - 1, d || 1, hour, minute, second);
  let utc = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), tz);
  utc = wallAsUtc - zoneOffsetMs(new Date(utc), tz);
  return new Date(utc);
}

function addCalendarDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function hotspotPeriodBounds(now: Date, timeZone: string) {
  const tz = normalizeHotspotTimezone(timeZone);
  const today = ymdInZone(now, tz);
  const yesterday = addCalendarDays(today, -1);
  const [y, m] = today.split("-").map(Number);
  const monthStartYmd = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const nextMonthYmd = m === 12 ? `${y + 1}-01-01` : `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-01`;
  const prevMonthEndYmd = addCalendarDays(monthStartYmd, -1);
  const [py, pm] = prevMonthEndYmd.split("-").map(Number);
  const prevMonthStartYmd = `${String(py).padStart(4, "0")}-${String(pm).padStart(2, "0")}-01`;
  return {
    timezone: tz,
    todayYmd: today,
    yesterdayYmd: yesterday,
    monthStartYmd,
    todayStart: zonedWallTime(today, tz),
    todayEnd: zonedWallTime(addCalendarDays(today, 1), tz),
    yesterdayStart: zonedWallTime(yesterday, tz),
    yesterdayEnd: zonedWallTime(today, tz),
    monthStart: zonedWallTime(monthStartYmd, tz),
    monthEnd: zonedWallTime(nextMonthYmd, tz),
    prevMonthStart: zonedWallTime(prevMonthStartYmd, tz),
    prevMonthEnd: zonedWallTime(monthStartYmd, tz),
  };
}

export function fillHotspotRevenueDays(
  rows: Array<{ day: string; amount: number; count: number }>,
  days: number,
  todayYmd: string,
) {
  const map = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
  const out: Array<{ day: string; amount: number; count: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addCalendarDays(todayYmd, -i);
    const hit = map.get(day);
    out.push({ day, amount: hit?.amount ?? 0, count: hit?.count ?? 0 });
  }
  return out;
}

export function hotspotDeltaPct(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

const ROUTER_STALE_MS = 3 * 60_000;
const ROUTER_UNREACHABLE_MS = 10 * 60_000;

export function hotspotRouterStatus(lastSeen: string | null, wgStatus: string, enabled: boolean, now = Date.now()): HotspotRouterStatus {
  if (!enabled) return "offline";
  const status = String(wgStatus || "");
  if (status === "pending" || status === "enrolling") return lastSeen ? "online" : "unknown";
  if (!lastSeen) return "unknown";
  const t = Date.parse(lastSeen);
  if (Number.isNaN(t)) return "unknown";
  const age = now - t;
  if (age <= ROUTER_STALE_MS) return "online";
  if (age <= ROUTER_UNREACHABLE_MS) return "warning";
  return "offline";
}

export function formatHotspotBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSessionDuration(startedAt: string | null, endedAt?: string | null, now = Date.now()) {
  if (!startedAt) return "—";
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return "—";
  const end = endedAt ? Date.parse(endedAt) : now;
  const ms = Math.max(0, (Number.isNaN(end) ? now : end) - start);
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function moneyKes(amount: number, currency = "KES") {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "KES";
  try {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(amount);
  }
}

export const HOTSPOT_HTML_FILES = ["login.html", "alogin.html", "status.html", "logout.html", "error.html", "md5.js"] as const;
export type HotspotHtmlFile = (typeof HOTSPOT_HTML_FILES)[number];

export function isHotspotHtmlFile(name: string): name is HotspotHtmlFile {
  return (HOTSPOT_HTML_FILES as readonly string[]).includes(name);
}
