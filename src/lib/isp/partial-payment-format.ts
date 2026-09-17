/** Client-safe integer money/percentage math for partial payments. No SQL, no Node APIs. */

export const PARTIAL_METHODS = ["pro_rata"] as const;
export type PartialMethod = (typeof PARTIAL_METHODS)[number];

export const PARTIAL_OUTCOMES = [
  "posted",
  "activated",
  "restored",
  "extended",
  "below_minimum",
  "blocked",
  "pending_approval",
] as const;
export type PartialOutcome = (typeof PARTIAL_OUTCOMES)[number];

export type PartialPolicySnapshot = {
  enabled_default: boolean;
  default_min_pct: number;
  allow_customer_override: boolean;
  allow_service_override: boolean;
  min_pct: number;
  max_pct: number;
  can_activate_new: boolean;
  can_restore_expired: boolean;
  can_renew_active: boolean;
  can_extend_active: boolean;
  requires_approval: boolean;
};

export const DEFAULT_PARTIAL_POLICY: PartialPolicySnapshot = {
  enabled_default: false,
  default_min_pct: 50,
  allow_customer_override: true,
  allow_service_override: true,
  min_pct: 10,
  max_pct: 90,
  can_activate_new: true,
  can_restore_expired: true,
  can_renew_active: false,
  can_extend_active: false,
  requires_approval: false,
};

export const BLOCKED_SUSPEND_REASONS = ["manual", "fraud", "security"] as const;

function truncInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

export function clampPct(pct: number, min: number, max: number) {
  const lo = Math.max(1, Math.min(100, truncInt(min) || 1));
  const hi = Math.max(lo, Math.min(100, truncInt(max) || 100));
  const p = truncInt(pct);
  if (p <= 0) return lo;
  return Math.min(hi, Math.max(lo, p));
}

/** Half-up integer percentage of an amount in whole KES. */
export function kesPercent(amount: number, pct: number) {
  const a = Math.max(0, truncInt(amount));
  const p = Math.max(0, truncInt(pct));
  if (a <= 0 || p <= 0) return 0;
  return Math.trunc((a * p + 50) / 100);
}

/** Floor of (paid / full) as a whole percent. */
export function paymentPct(paid: number, full: number) {
  const p = Math.max(0, truncInt(paid));
  const f = Math.max(0, truncInt(full));
  if (f <= 0 || p <= 0) return 0;
  return Math.trunc((p * 100) / f);
}

/** Floor of package period × paid ÷ full, in milliseconds. */
export function partialValidityMs(periodMs: number, paid: number, full: number) {
  const period = Math.max(0, truncInt(periodMs));
  const p = Math.max(0, truncInt(paid));
  const f = Math.max(0, truncInt(full));
  if (period <= 0 || p <= 0 || f <= 0) return 0;
  return Math.trunc((period * p) / f);
}

export function floorValidityMs(ms: number, hourly = false) {
  const n = Math.max(0, truncInt(ms));
  if (hourly) return Math.trunc(n / 3_600_000) * 3_600_000;
  return Math.trunc(n / 86_400_000) * 86_400_000;
}

export function msToWholeDays(ms: number) {
  return Math.max(0, Math.trunc(Math.max(0, truncInt(ms)) / 86_400_000));
}

export function msToWholeHours(ms: number) {
  return Math.max(0, Math.trunc(Math.max(0, truncInt(ms)) / 3_600_000));
}

export function validityLabel(ms: number, hourly = false) {
  if (hourly) {
    const hours = msToWholeHours(ms);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const days = msToWholeDays(ms);
  return days === 1 ? "1 day" : `${days} days`;
}

export type EffectivePartial = {
  enabled: boolean;
  min_pct: number;
  source: "service" | "customer" | "tenant";
  can_activate_new: boolean;
  can_restore_expired: boolean;
  can_renew_active: boolean;
  can_extend_active: boolean;
  requires_approval: boolean;
  method: PartialMethod;
  tenant_min_pct: number;
  tenant_max_pct: number;
};

export function resolveEffectivePartial(opts: {
  policy: PartialPolicySnapshot;
  customerEnabled?: boolean | null;
  customerMinPct?: number | null;
  serviceEnabled?: boolean | null;
  serviceMinPct?: number | null;
}): EffectivePartial {
  const policy = opts.policy;
  const lo = Math.max(1, Math.min(100, truncInt(policy.min_pct) || 10));
  const hi = Math.max(lo, Math.min(100, truncInt(policy.max_pct) || 90));
  let enabled = Boolean(policy.enabled_default);
  let minPct = clampPct(policy.default_min_pct, lo, hi);
  let source: EffectivePartial["source"] = "tenant";

  if (policy.allow_customer_override && opts.customerEnabled !== null && opts.customerEnabled !== undefined) {
    enabled = Boolean(opts.customerEnabled);
    source = "customer";
    if (opts.customerMinPct != null) minPct = clampPct(opts.customerMinPct, lo, hi);
  }
  if (policy.allow_service_override && opts.serviceEnabled !== null && opts.serviceEnabled !== undefined) {
    enabled = Boolean(opts.serviceEnabled);
    source = "service";
    if (opts.serviceMinPct != null) minPct = clampPct(opts.serviceMinPct, lo, hi);
  }

  return {
    enabled,
    min_pct: minPct,
    source,
    can_activate_new: Boolean(policy.can_activate_new),
    can_restore_expired: Boolean(policy.can_restore_expired),
    can_renew_active: Boolean(policy.can_renew_active),
    can_extend_active: Boolean(policy.can_extend_active),
    requires_approval: Boolean(policy.requires_approval),
    method: "pro_rata",
    tenant_min_pct: lo,
    tenant_max_pct: hi,
  };
}

export type PartialPreview = {
  full_kes: number;
  paid_kes: number;
  this_kes: number;
  min_pct: number;
  min_kes: number;
  actual_pct: number;
  this_pct: number;
  remaining_kes: number;
  remaining_to_qualify_kes: number;
  qualifies: boolean;
  grant_ms: number;
  grant_days: number;
  grant_hours: number;
  validity_label: string;
};

export function previewPartial(opts: {
  fullKes: number;
  paidBeforeKes?: number;
  thisKes: number;
  minPct: number;
  periodMs: number;
  hourly?: boolean;
  alreadyGrantedMs?: number;
}): PartialPreview {
  const full = Math.max(0, truncInt(opts.fullKes));
  const before = Math.max(0, truncInt(opts.paidBeforeKes ?? 0));
  const thisKes = Math.max(0, truncInt(opts.thisKes));
  const paid = Math.min(full, before + thisKes);
  const minPct = Math.max(1, Math.min(100, truncInt(opts.minPct) || 50));
  const minKes = kesPercent(full, minPct);
  const remaining = Math.max(0, full - paid);
  const remainingToQualify = Math.max(0, minKes - paid);
  const qualifies = paid >= minKes && paid > 0 && full > 0;
  const raw = partialValidityMs(opts.periodMs, thisKes, full);
  const capped = Math.min(raw, Math.max(0, truncInt(opts.periodMs) - Math.max(0, truncInt(opts.alreadyGrantedMs ?? 0))));
  const grantMs = floorValidityMs(capped, Boolean(opts.hourly));
  return {
    full_kes: full,
    paid_kes: paid,
    this_kes: thisKes,
    min_pct: minPct,
    min_kes: minKes,
    actual_pct: paymentPct(paid, full),
    this_pct: paymentPct(thisKes, full),
    remaining_kes: remaining,
    remaining_to_qualify_kes: remainingToQualify,
    qualifies,
    grant_ms: grantMs,
    grant_days: msToWholeDays(grantMs),
    grant_hours: msToWholeHours(grantMs),
    validity_label: validityLabel(grantMs, Boolean(opts.hourly)),
  };
}

export function nairobiYmd(at: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function addNairobiDaysYmd(days: number, from: Date | string = new Date()) {
  const raw = typeof from === "string" ? from.trim() : "";
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : nairobiYmd(from instanceof Date ? from : new Date());
  const noon = new Date(`${ymd}T12:00:00+03:00`);
  if (Number.isNaN(noon.getTime())) return ymd;
  noon.setTime(noon.getTime() + Math.round(days) * 86_400_000);
  return nairobiYmd(noon);
}

export function expectedExpiryYmd(opts: {
  days: number;
  hourly?: boolean;
  hours?: number;
  currentEnd?: string | null;
  awaiting?: boolean;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  if (opts.hourly) {
    const hours = Math.max(0, truncInt(opts.hours ?? 0));
    const base =
      opts.awaiting || !opts.currentEnd ? now : new Date(Math.max(now.getTime(), Date.parse(opts.currentEnd) || 0));
    return nairobiYmd(new Date(base.getTime() + hours * 3_600_000));
  }
  const days = Math.max(0, truncInt(opts.days));
  if (opts.awaiting || !opts.currentEnd) return addNairobiDaysYmd(days, now);
  const current = Date.parse(opts.currentEnd);
  const base = Number.isFinite(current) && current > now.getTime() ? new Date(current) : now;
  return addNairobiDaysYmd(days, base);
}

export type PartialAction = "none" | "activate" | "restore" | "extend" | "approve";

export type PartialDecision = PartialPreview & {
  enabled: boolean;
  blocked_reason: string;
  outcome: PartialOutcome;
  action: PartialAction;
  grant_ms: number;
};

const AWAITING = "awaiting_payment";

export function decidePartialAccess(opts: {
  effective: EffectivePartial;
  fullKes: number;
  paidKes: number;
  thisKes: number;
  invoicePaid: boolean;
  periodMs: number;
  hourly?: boolean;
  alreadyGrantedMs?: number;
  serviceStatus: string;
  suspendReason: string;
  activationMode: string;
  deleted?: boolean;
  terminated?: boolean;
}): PartialDecision {
  const preview = previewPartial({
    fullKes: opts.fullKes,
    paidBeforeKes: Math.max(0, truncInt(opts.paidKes) - truncInt(opts.thisKes)),
    thisKes: opts.thisKes,
    minPct: opts.effective.min_pct,
    periodMs: opts.periodMs,
    hourly: opts.hourly,
    alreadyGrantedMs: opts.alreadyGrantedMs,
  });
  const period = Math.max(0, truncInt(opts.periodMs));
  const already = Math.max(0, truncInt(opts.alreadyGrantedMs ?? 0));
  const remainder = Math.max(0, period - already);
  const awaiting = opts.suspendReason === AWAITING;
  const down = ["grace", "suspended", "pending"].includes(opts.serviceStatus);
  const active = opts.serviceStatus === "active";
  const blockedSuspend = (BLOCKED_SUSPEND_REASONS as readonly string[]).includes(opts.suspendReason);

  const base: PartialDecision = {
    ...preview,
    enabled: opts.effective.enabled,
    blocked_reason: "",
    outcome: "posted",
    action: "none",
    grant_ms: 0,
  };

  if (opts.deleted || opts.terminated || opts.serviceStatus === "terminated") {
    return { ...base, outcome: "blocked", blocked_reason: "terminated" };
  }

  if (opts.invoicePaid) {
    const grantMs = remainder;
    let action: PartialAction = "none";
    let outcome: PartialOutcome = "posted";
    if (awaiting || (opts.serviceStatus === "pending" && awaiting)) {
      action = "activate";
      outcome = "activated";
    } else if (down) {
      action = "restore";
      outcome = "restored";
    } else if (active) {
      action = "extend";
      outcome = "extended";
    }
    return {
      ...base,
      qualifies: true,
      grant_ms: grantMs,
      grant_days: msToWholeDays(grantMs),
      grant_hours: msToWholeHours(grantMs),
      validity_label: validityLabel(grantMs, Boolean(opts.hourly)),
      remaining_kes: 0,
      remaining_to_qualify_kes: 0,
      actual_pct: 100,
      action,
      outcome,
    };
  }

  if (!opts.effective.enabled) {
    return { ...base, outcome: "blocked", blocked_reason: "disabled" };
  }
  if (!preview.qualifies) {
    return { ...base, outcome: "below_minimum", blocked_reason: "below_minimum" };
  }
  if (blockedSuspend) {
    return { ...base, outcome: "blocked", blocked_reason: opts.suspendReason };
  }
  if (opts.effective.requires_approval) {
    return { ...base, outcome: "pending_approval", action: "approve", grant_ms: preview.grant_ms };
  }

  if (awaiting) {
    if (opts.effective.can_activate_new && opts.activationMode === "after_partial" && preview.grant_ms > 0) {
      return { ...base, action: "activate", outcome: "activated", grant_ms: preview.grant_ms };
    }
    return { ...base, outcome: "posted", blocked_reason: "full_payment_required", grant_ms: 0 };
  }
  if (down) {
    if (opts.effective.can_restore_expired && preview.grant_ms > 0) {
      return { ...base, action: "restore", outcome: "restored", grant_ms: preview.grant_ms };
    }
    return { ...base, outcome: "posted", blocked_reason: "restore_disabled", grant_ms: 0 };
  }
  if (active) {
    if ((opts.effective.can_extend_active || opts.effective.can_renew_active) && preview.grant_ms > 0) {
      return { ...base, action: "extend", outcome: "extended", grant_ms: preview.grant_ms };
    }
    return { ...base, outcome: "posted", blocked_reason: "extend_disabled", grant_ms: 0 };
  }
  return base;
}

export function portalMinKes(preview: Pick<PartialPreview, "remaining_to_qualify_kes" | "remaining_kes">) {
  const qualify = Math.max(0, truncInt(preview.remaining_to_qualify_kes));
  const remaining = Math.max(0, truncInt(preview.remaining_kes));
  if (remaining <= 0) return 0;
  if (qualify <= 0) return 1;
  return Math.min(qualify, remaining);
}

export function outcomeLabel(outcome: string) {
  if (outcome === "activated") return "Activated";
  if (outcome === "restored") return "Restored";
  if (outcome === "extended") return "Extended";
  if (outcome === "below_minimum") return "Below minimum";
  if (outcome === "pending_approval") return "Awaiting approval";
  if (outcome === "blocked") return "Blocked";
  return "Posted";
}
