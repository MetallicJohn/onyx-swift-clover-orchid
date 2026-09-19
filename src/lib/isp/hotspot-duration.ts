/** Client-safe hotspot duration math. No SQL, no Node APIs. */

export const HOTSPOT_DURATION_UNITS = ["minutes", "hours", "days", "weeks", "months"] as const;
export type HotspotDurationUnit = (typeof HOTSPOT_DURATION_UNITS)[number];

export type NormalizedHotspotDuration = {
  value: number;
  unit: HotspotDurationUnit;
};

export function isHotspotDurationUnit(raw: unknown): raw is HotspotDurationUnit {
  return typeof raw === "string" && (HOTSPOT_DURATION_UNITS as readonly string[]).includes(raw);
}

export function normalizeDuration(value: unknown, unit: unknown): NormalizedHotspotDuration {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  const u = isHotspotDurationUnit(unit) ? unit : "hours";
  return { value: n, unit: u };
}

export function durationFromValidityHours(hours: number): NormalizedHotspotDuration {
  const h = Math.max(0, Math.trunc(Number(hours) || 0));
  if (h <= 0) return { value: 1, unit: "hours" };
  if (h % 168 === 0) return { value: h / 168, unit: "weeks" };
  if (h % 24 === 0) return { value: h / 24, unit: "days" };
  return { value: h, unit: "hours" };
}

/** Coarse hour fallback for columns that still store integer hours. Never used for hotspot expiry. */
export function validityHoursFromDuration(value: number, unit: HotspotDurationUnit) {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  if (unit === "minutes") return Math.max(1, Math.ceil(n / 60));
  if (unit === "hours") return Math.max(1, n);
  if (unit === "days") return Math.max(1, n * 24);
  if (unit === "weeks") return Math.max(1, n * 168);
  if (unit === "months") return Math.max(1, n * 720);
  return Math.max(1, n);
}

export function hotspotDurationMs(value: number, unit: HotspotDurationUnit) {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  if (unit === "minutes") return n * 60_000;
  if (unit === "hours") return n * 3600_000;
  if (unit === "days") return n * 86400_000;
  if (unit === "weeks") return n * 7 * 86400_000;
  return 0;
}

function lastDayOfUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addUtcMonths(from: Date, months: number) {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const day = from.getUTCDate();
  const cursor = new Date(
    Date.UTC(year, month, 1, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()),
  );
  const clamped = Math.min(day, lastDayOfUtcMonth(cursor.getUTCFullYear(), cursor.getUTCMonth()));
  cursor.setUTCDate(clamped);
  return cursor;
}

/** Access expiry = activation + package duration. Months use calendar UTC with last-day clamp. */
export function addHotspotDuration(from: Date, value: number, unit: HotspotDurationUnit) {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  if (unit === "months") return addUtcMonths(from, n);
  const ms = hotspotDurationMs(n, unit);
  return new Date(from.getTime() + ms);
}

export function formatHotspotDuration(value: number, unit: HotspotDurationUnit) {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  const labels: Record<HotspotDurationUnit, [string, string]> = {
    minutes: ["Minute", "Minutes"],
    hours: ["Hour", "Hours"],
    days: ["Day", "Days"],
    weeks: ["Week", "Weeks"],
    months: ["Month", "Months"],
  };
  const [one, many] = labels[unit] || labels.hours;
  return `${n} ${n === 1 ? one : many}`;
}

export function hotspotPackageDuration(pkg: {
  duration_value?: number | null;
  duration_unit?: string | null;
  validity_hours?: number | null;
}): NormalizedHotspotDuration {
  const unit = pkg.duration_unit;
  const value = Number(pkg.duration_value || 0);
  if (value >= 1 && isHotspotDurationUnit(unit)) return { value, unit };
  return durationFromValidityHours(Number(pkg.validity_hours || 0));
}
