import { nairobiDate } from "./empty-tenant.ts";
import type { ServiceStatus } from "./types.ts";

/** Stored when staff picks a calendar date that has already ended in Africa/Nairobi. */
export const STAFF_EXPIRY_REASON = "expired_by_staff_date_change";
export const STAFF_EXPIRY_SOURCE = "staff_expiry_date_change";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Calendar dates are Africa/Nairobi dates.
 * Access lasts through the **end** of the selected day (23:59:59.999 EAT).
 * A date is "in the past" only when it is strictly before today's Nairobi date.
 * Today therefore restores (or stays active) until midnight EAT.
 */
export function parseExpiryYmd(raw: string) {
  const ymd = String(raw || "").trim();
  const m = YMD.exec(ymd);
  if (!m) throw new Error("Choose a valid calendar date");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("Choose a valid calendar date");
  }
  const end = new Date(`${ymd}T23:59:59.999+03:00`);
  if (Number.isNaN(end.getTime()) || nairobiDate(end) !== ymd) {
    throw new Error("Choose a valid calendar date");
  }
  return { ymd, accessUntil: end };
}

export function isPastNairobiDate(ymd: string, now = new Date()) {
  return ymd < nairobiDate(now);
}

export function effectiveAccessIso(row: { expiry_source?: string | null; access_until?: string | null; period_end?: string | null }) {
  if (row.expiry_source === "staff" && row.access_until) return row.access_until;
  return row.period_end || null;
}

export function effectiveAccessEndMs(
  row: {
    expiry_source?: string | null;
    access_until?: string | null;
    period_end?: string | null;
    grace_days?: number;
    grant_expires_at?: string | null;
  },
  now = Date.now(),
) {
  if (row.expiry_source === "staff" && row.access_until) {
    const t = Date.parse(row.access_until);
    return Number.isFinite(t) ? t : 0;
  }
  const paid = row.period_end ? Date.parse(row.period_end) : NaN;
  const pkg = Number.isFinite(paid) ? paid + Math.max(0, row.grace_days ?? 0) * 86400_000 : 0;
  const granted = row.grant_expires_at ? Date.parse(row.grant_expires_at) : NaN;
  const hard = Math.max(pkg, Number.isFinite(granted) ? granted : 0);
  return hard || now;
}

export function resolveStaffExpiryOutcome(input: {
  past: boolean;
  status: string;
  suspend_reason: string;
  bundleBlocked: boolean;
  invoiceBlocked: boolean;
}): { status: ServiceStatus; reason: string } {
  if (input.status === "terminated") {
    return { status: "terminated", reason: input.suspend_reason || "terminated" };
  }
  if (input.past) {
    return { status: "suspended", reason: STAFF_EXPIRY_REASON };
  }
  if (input.bundleBlocked) return { status: "suspended", reason: "bundle" };
  if (input.suspend_reason === "manual") return { status: "suspended", reason: "manual" };
  if (input.invoiceBlocked) return { status: "suspended", reason: "invoice" };
  return { status: "active", reason: "" };
}

export function previewStaffExpiry(input: {
  ymd: string;
  status: string;
  suspend_reason: string;
  bundle_used_mb: number;
  bundle_mb: number;
  now?: Date;
}) {
  const { ymd, accessUntil } = parseExpiryYmd(input.ymd);
  const past = isPastNairobiDate(ymd, input.now);
  const outcome = resolveStaffExpiryOutcome({
    past,
    status: input.status,
    suspend_reason: input.suspend_reason,
    bundleBlocked: input.bundle_mb > 0 && input.bundle_used_mb >= input.bundle_mb,
    invoiceBlocked: false,
  });
  return {
    ymd,
    accessUntilIso: accessUntil.toISOString(),
    past,
    expectedStatus: outcome.status,
    expectedReason: outcome.reason,
  };
}

export function expirySourceLabel(source?: string | null, graceActive?: boolean) {
  if (source === "staff") return "Staff";
  if (graceActive) return "Grace period";
  return "Billing";
}
