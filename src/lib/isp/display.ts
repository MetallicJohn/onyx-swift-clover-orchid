/** Client-safe date/MAC/byte formatting for the operations console. */

export const DATE_FORMATS = [
  { id: "dd/mm/yy", label: "dd/mm/yy", sample: "16/09/26" },
  { id: "dd/mm/yyyy", label: "dd/mm/yyyy", sample: "16/09/2026" },
  { id: "dd-mm-yyyy", label: "dd-mm-yyyy", sample: "16-09-2026" },
  { id: "yyyy-mm-dd", label: "yyyy-mm-dd", sample: "2026-09-16" },
  { id: "d MMM yyyy", label: "d MMM yyyy", sample: "16 Sep 2026" },
] as const;

export type DateFormatId = (typeof DATE_FORMATS)[number]["id"];

export const DEFAULT_DATE_FORMAT: DateFormatId = "dd/mm/yy";
export const DISPLAY_TIMEZONE = "Africa/Nairobi";
const STORAGE_KEY = "isp-date-format.v1";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const SAMPLE_DATE = "2026-09-16";

export type NairobiParts = {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
};

function isDateFormatId(raw: string): raw is DateFormatId {
  return DATE_FORMATS.some((f) => f.id === raw);
}

export function normalizeDateFormat(raw: unknown): DateFormatId {
  const v = String(raw || "").trim();
  if (isDateFormatId(v)) return v;
  const compact = v.toLowerCase().replace(/\s+/g, "");
  if (compact === "dd/mm/yy" || compact === "d/m/yy") return "dd/mm/yy";
  if (compact === "dd/mm/yyyy" || compact === "d/m/yyyy") return "dd/mm/yyyy";
  if (compact === "dd-mm-yyyy" || compact === "d-m-yyyy") return "dd-mm-yyyy";
  if (compact === "yyyy-mm-dd") return "yyyy-mm-dd";
  if (compact === "dmmmyyyy" || compact === "ddmmmyyyy") return "d MMM yyyy";
  return DEFAULT_DATE_FORMAT;
}

function readStoredDateFormat(): DateFormatId {
  if (typeof sessionStorage === "undefined") return DEFAULT_DATE_FORMAT;
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return v ? normalizeDateFormat(v) : DEFAULT_DATE_FORMAT;
  } catch {
    return DEFAULT_DATE_FORMAT;
  }
}

let activeDateFormat: DateFormatId = readStoredDateFormat();

export function setActiveDateFormat(raw: unknown) {
  activeDateFormat = normalizeDateFormat(raw);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, activeDateFormat);
  } catch {
    /* private mode */
  }
}

export function getActiveDateFormat(): DateFormatId {
  return activeDateFormat;
}

function pad(n: number, width = 2) {
  return String(n).padStart(width, "0");
}

function yy(year: number) {
  return pad(year % 100);
}

export function nairobiParts(iso: string, timeZone = DISPLAY_TIMEZONE): NairobiParts | null {
  const raw = String(iso || "").trim();
  if (!raw) return null;
  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    return { y: Number(dateOnly[1]), m: Number(dateOnly[2]), d: Number(dateOnly[3]), hh: 0, mm: 0, ss: 0 };
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const map: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(t))) {
      if (p.type !== "literal") map[p.type] = p.value;
    }
    const y = Number(map.year);
    const m = Number(map.month);
    const d = Number(map.day);
    if (!y || !m || !d) return null;
    let hh = Number(map.hour) || 0;
    if (hh === 24) hh = 0;
    return {
      y,
      m,
      d,
      hh,
      mm: Number(map.minute) || 0,
      ss: Number(map.second) || 0,
    };
  } catch {
    return null;
  }
}

export function renderDate(parts: NairobiParts, format: DateFormatId, withTime?: "short" | "long") {
  const dd = pad(parts.d);
  const mm = pad(parts.m);
  let date = "";
  switch (format) {
    case "dd/mm/yyyy":
      date = `${dd}/${mm}/${parts.y}`;
      break;
    case "dd-mm-yyyy":
      date = `${dd}-${mm}-${parts.y}`;
      break;
    case "yyyy-mm-dd":
      date = `${parts.y}-${mm}-${dd}`;
      break;
    case "d MMM yyyy":
      date = `${parts.d} ${MONTHS[parts.m - 1] ?? pad(parts.m)} ${parts.y}`;
      break;
    default:
      date = `${dd}/${mm}/${yy(parts.y)}`;
  }
  if (!withTime) return date;
  const clock = `${pad(parts.hh)}:${pad(parts.mm)}`;
  if (withTime === "short") return `${date} ${clock}`;
  return `${date} ${clock}:${pad(parts.ss)}`;
}

export function formatDate(
  iso: string | null | undefined,
  format: string = activeDateFormat,
  timeZone = DISPLAY_TIMEZONE,
) {
  if (!iso) return "—";
  const parts = nairobiParts(iso, timeZone);
  if (!parts) return iso.length <= 10 ? iso : iso.slice(0, 10);
  return renderDate(parts, normalizeDateFormat(format));
}

/** Same calendar day the console shows. Empty when there is no date. */
export function formatSmsDate(iso: string | null | undefined, format: string = activeDateFormat) {
  if (!iso) return "";
  const formatted = formatDate(iso, format);
  return formatted === "—" ? "" : formatted;
}

export function formatDateTime(
  iso: string | null | undefined,
  format: string = activeDateFormat,
  timeZone = DISPLAY_TIMEZONE,
) {
  if (!iso) return "—";
  const parts = nairobiParts(iso, timeZone);
  if (!parts) return iso;
  return renderDate(parts, normalizeDateFormat(format), "long");
}

export function formatShortDateTime(
  iso: string | null | undefined,
  format: string = activeDateFormat,
  timeZone = DISPLAY_TIMEZONE,
) {
  if (!iso) return "—";
  const parts = nairobiParts(iso, timeZone);
  if (!parts) return iso;
  return renderDate(parts, normalizeDateFormat(format), "short");
}

export function dateFormatExample(format: string = activeDateFormat, sample = SAMPLE_DATE) {
  return formatDate(sample, format);
}

export function formatMac(raw?: string | null) {
  const compact = String(raw || "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase();
  if (compact.length === 12) return compact.match(/.{2}/g)?.join(":") ?? compact;
  const trimmed = String(raw || "").trim();
  return trimmed || "—";
}

export function remainingLabel(expiresAt: string) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const days = Math.floor(ms / 86400_000);
  const hours = Math.floor((ms % 86400_000) / 3600_000);
  if (days > 1) return `${days} days remaining`;
  if (days === 1) return hours > 0 ? `1 day ${hours}h remaining` : "1 day remaining";
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
  return "Less than an hour remaining";
}

export function formatBytes(n: number) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1024) return `${Math.round(v)} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function accessMethodLabel(method: string) {
  if (method === "pppoe") return "PPPoE";
  if (method === "static") return "Static IP";
  if (method === "hotspot") return "Hotspot";
  return method || "Other";
}
