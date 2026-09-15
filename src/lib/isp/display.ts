/** Client-safe date/MAC/byte formatting for the operations console. */

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(new Date(t));
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Africa/Nairobi",
  }).format(new Date(t));
}

export function formatShortDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  }).format(new Date(t));
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
