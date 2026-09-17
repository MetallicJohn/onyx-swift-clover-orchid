import { PORTAL_TICKET_CATEGORIES, type PortalAccountStatus, type PortalInvoiceStatus, type PortalPaymentStatus, type PortalServiceStatus } from "./customer-portal-dto.ts";
import { formatDate } from "./display.ts";
import { normalizePhone } from "./phone.ts";

export function portalServiceRef(id: string) {
  const tail = id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return tail ? `S-${tail}` : "S-000000";
}

export function billingPeriodLabel(interval: string) {
  if (interval === "daily") return "Daily";
  if (interval === "weekly") return "Weekly";
  if (interval === "quarterly") return "Quarterly";
  if (interval === "yearly") return "Yearly";
  return "Monthly";
}

export function accountStatusFrom(status: string): PortalAccountStatus {
  if (status === "suspended") return "suspended";
  if (status === "inactive" || status === "terminated") return "inactive";
  return "active";
}

export function accountStatusLabel(status: PortalAccountStatus) {
  if (status === "suspended") return "Suspended";
  if (status === "inactive") return "Inactive";
  return "Active";
}

export function deriveServiceStatus(opts: {
  status: string;
  period_end: string | null;
  grace_expires_at: string | null;
  now?: number;
}): PortalServiceStatus {
  const now = opts.now ?? Date.now();
  if (opts.status === "grace" || (opts.grace_expires_at && Date.parse(opts.grace_expires_at) > now)) return "grace";
  if (opts.status === "active") return "active";
  if (opts.status === "pending") return "pending";
  if (opts.status === "suspended") {
    if (opts.period_end && Date.parse(opts.period_end) < now) return "expired";
    return "suspended";
  }
  if (opts.period_end && Date.parse(opts.period_end) < now) return "expired";
  return "other";
}

export function serviceStatusLabel(status: PortalServiceStatus) {
  if (status === "grace") return "Grace Period";
  if (status === "expired") return "Expired";
  if (status === "suspended") return "Suspended";
  if (status === "pending") return "Pending";
  if (status === "active") return "Active";
  return "Unknown";
}

export function paymentStatusFrom(balance: number, invoiceStatus: string | null): PortalPaymentStatus {
  if (balance <= 0 && !invoiceStatus) return "none";
  if (balance <= 0) return "paid";
  if (invoiceStatus === "overdue") return "overdue";
  if (invoiceStatus === "partial") return "partial";
  return "unpaid";
}

export function paymentStatusLabel(status: PortalPaymentStatus) {
  if (status === "overdue") return "Overdue";
  if (status === "partial") return "Partially paid";
  if (status === "unpaid") return "Unpaid";
  if (status === "paid") return "Paid";
  return "No invoice";
}

export function invoiceStatusFrom(status: string, balance: number): PortalInvoiceStatus {
  if (status === "paid" || balance <= 0) return "paid";
  if (status === "overdue") return "overdue";
  if (status === "partial") return "partial";
  if (status === "cancelled" || status === "canceled" || status === "void") return "cancelled";
  if (status === "issued" || status === "due") return status;
  return "other";
}

export function invoiceStatusLabel(status: PortalInvoiceStatus) {
  if (status === "paid") return "Paid";
  if (status === "overdue") return "Overdue";
  if (status === "partial") return "Partially paid";
  if (status === "issued" || status === "due") return "Unpaid";
  if (status === "cancelled") return "Cancelled";
  return "Open";
}

export function daysRemaining(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / 86400_000);
}

export function nextPeriodLabel(endIso: string | null, interval: string, dateFormat?: string) {
  if (!endIso) return null;
  const end = Date.parse(endIso);
  if (!Number.isFinite(end)) return null;
  const days = interval === "daily" ? 1 : interval === "weekly" ? 7 : interval === "quarterly" ? 90 : interval === "yearly" ? 365 : 30;
  const start = new Date(end);
  const stop = new Date(end + days * 86400_000);
  return `${formatDate(start.toISOString(), dateFormat)} – ${formatDate(stop.toISOString(), dateFormat)}`;
}

export function maskReference(ref: string) {
  const t = (ref || "").trim();
  if (!t) return "—";
  if (t.length <= 4) return "••••";
  if (t.length <= 8) return `${"•".repeat(t.length - 4)}${t.slice(-4)}`;
  return `${t.slice(0, 2)}${"•".repeat(Math.min(8, t.length - 6))}${t.slice(-4)}`;
}

export function paymentMethodLabel(provider: string) {
  const p = (provider || "").toLowerCase();
  if (p === "mpesa") return "M-Pesa";
  if (p === "kopokopo") return "Kopo Kopo";
  if (p === "bank" || p === "bank_transfer") return "Bank";
  if (p === "card" || p === "stripe") return "Card";
  if (p === "cash") return "Cash";
  return provider || "Payment";
}

export function ticketCategoryLabel(id: string) {
  return PORTAL_TICKET_CATEGORIES.find((c) => c.id === id)?.label || id.replace(/_/g, " ");
}

export function ticketStatusLabel(status: string) {
  if (status === "new") return "Open";
  if (status === "assigned" || status === "accepted" || status === "travelling" || status === "on_site" || status === "waiting")
    return "In progress";
  if (status === "resolved") return "Resolved";
  if (status === "closed") return "Closed";
  return status.replace(/_/g, " ");
}

/** Tenant currency/timezone → dial prefix. Kenya (KES / Nairobi) is the product default. */
export function dialCodeFromConfig(opts?: { currency?: string; timezone?: string }) {
  const currency = (opts?.currency || "KES").toUpperCase();
  const tz = opts?.timezone || "Africa/Nairobi";
  if (currency === "UGX" || tz.includes("Kampala")) return "256";
  if (currency === "TZS" || tz.includes("Dar_es_Salaam")) return "255";
  if (currency === "RWF" || tz.includes("Kigali")) return "250";
  return "254";
}

export function phonePasswordCandidates(storedPhone: string, dial = "254") {
  const raw = (storedPhone || "").trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = normalizePhone(raw);
  const last9 = digits.slice(-9);
  const local = last9 ? `0${last9}` : "";
  const e164 = last9 ? `${dial}${last9}` : "";
  const plus = e164 ? `+${e164}` : "";
  return [...new Set([raw, digits, normalized, e164, plus, local].filter((s) => s.length >= 8))];
}

export function enteredMatchesPhone(storedPhone: string, entered: string) {
  const enteredDigits = (entered || "").replace(/\D/g, "");
  const storedDigits = (storedPhone || "").replace(/\D/g, "");
  if (enteredDigits.length >= 9 && storedDigits.length >= 9) {
    return enteredDigits.slice(-9) === storedDigits.slice(-9);
  }
  return false;
}

export function last9Phone(phone: string) {
  return (phone || "").replace(/\D/g, "").slice(-9);
}

export function canonicalInitialPassword(phone: string) {
  const last9 = last9Phone(phone);
  return last9.length === 9 ? `0${last9}` : phonePasswordCandidates(phone)[0] || "";
}

/** Copy that must never appear in customer-facing APIs, PDFs or UI. */
export const PORTAL_TECHNICAL_RE =
  /pppoe|hotspot|static.?ip|\bip\s?address\b|mikrotik|radius|genieacs|vlan|wireguard|\bacs\b|password|secret|credential|router|access.?point|ip.?pool|cpe\b|tr-?069|framed.?ip|download_mbps|upload_mbps|\bmbps\b|\bnas\b|connection.?request/i;

export function customerSafeText(text: string, fallback = "") {
  const t = (text || "").trim();
  if (!t) return fallback;
  if (PORTAL_TECHNICAL_RE.test(t)) return fallback;
  return t;
}
