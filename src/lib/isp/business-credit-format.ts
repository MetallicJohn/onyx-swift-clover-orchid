/** Client-safe business-credit math and labels. No database, no node:crypto. */

export const PACKAGE_TIERS = ["residential", "business", "enterprise"] as const;
export type PackageTier = (typeof PACKAGE_TIERS)[number];

export const CREDIT_BLOCKED_REASONS = ["manual", "fraud", "security"] as const;

export type CreditState =
  | "disabled"
  | "unconfigured"
  | "paid_active"
  | "active_on_credit"
  | "overdue_within_limit"
  | "warning"
  | "limit_reached"
  | "suspended_limit";

export type EffectiveCredit = {
  tier: PackageTier;
  enabled: boolean;
  configured: boolean;
  max_kes: number;
  warning_kes: number;
  disconnect_when_reached: boolean;
  allow_continuity: boolean;
  send_warning: boolean;
  days_limit: number;
  notes: string;
  source: "service" | "customer" | "package";
};

export type CreditSnapshot = {
  outstanding_kes: number;
  available_kes: number;
  utilization_pct: number;
  state: CreditState;
  label: string;
  covers: boolean;
  at_limit: boolean;
  warning: boolean;
};

export function isPackageTier(v: string): v is PackageTier {
  return (PACKAGE_TIERS as readonly string[]).includes(v);
}

export function tierLabel(tier: string) {
  if (tier === "business") return "Business";
  if (tier === "enterprise") return "Enterprise";
  return "Residential";
}

export function truncInt(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

export function availableCredit(maxKes: number, outstandingKes: number) {
  return Math.max(0, truncInt(maxKes) - Math.max(0, truncInt(outstandingKes)));
}

export function creditUtilization(maxKes: number, outstandingKes: number) {
  const max = truncInt(maxKes);
  const out = Math.max(0, truncInt(outstandingKes));
  if (max <= 0) return 0;
  return Math.min(100, Math.trunc((out * 100) / max));
}

export function resolveEffectiveCredit(opts: {
  tier?: string | null;
  packageEnabled?: boolean | null;
  packageMaxKes?: number | null;
  packageWarningKes?: number | null;
  packageDisconnect?: boolean | null;
  packageContinuity?: boolean | null;
  packageSendWarning?: boolean | null;
  packageDaysLimit?: number | null;
  packageNotes?: string | null;
  customerEnabled?: boolean | null;
  customerMaxKes?: number | null;
  customerWarningKes?: number | null;
  serviceEnabled?: boolean | null;
  serviceMaxKes?: number | null;
  serviceWarningKes?: number | null;
}): EffectiveCredit {
  const tier: PackageTier = isPackageTier(String(opts.tier || "")) ? (opts.tier as PackageTier) : "residential";
  const businessPackage = tier === "business" || tier === "enterprise";
  let enabled = Boolean(opts.packageEnabled) && businessPackage;
  let maxKes = Math.max(0, truncInt(opts.packageMaxKes ?? 0));
  let warningKes = Math.max(0, truncInt(opts.packageWarningKes ?? 0));
  let source: EffectiveCredit["source"] = "package";

  if (opts.customerEnabled !== null && opts.customerEnabled !== undefined) {
    enabled = Boolean(opts.customerEnabled) && businessPackage;
    source = "customer";
    if (opts.customerMaxKes != null) maxKes = Math.max(0, truncInt(opts.customerMaxKes));
    if (opts.customerWarningKes != null) warningKes = Math.max(0, truncInt(opts.customerWarningKes));
  }
  if (opts.serviceEnabled !== null && opts.serviceEnabled !== undefined) {
    enabled = Boolean(opts.serviceEnabled) && businessPackage;
    source = "service";
    if (opts.serviceMaxKes != null) maxKes = Math.max(0, truncInt(opts.serviceMaxKes));
    if (opts.serviceWarningKes != null) warningKes = Math.max(0, truncInt(opts.serviceWarningKes));
  }

  if (!businessPackage && source === "package") {
    enabled = false;
  }

  const configured = enabled && maxKes > 0;
  if (warningKes <= 0 && maxKes > 0) warningKes = Math.trunc((maxKes * 80) / 100);
  if (warningKes > maxKes) warningKes = maxKes;

  return {
    tier,
    enabled,
    configured,
    max_kes: maxKes,
    warning_kes: warningKes,
    disconnect_when_reached: opts.packageDisconnect !== false,
    allow_continuity: opts.packageContinuity !== false,
    send_warning: opts.packageSendWarning !== false,
    days_limit: Math.max(0, truncInt(opts.packageDaysLimit ?? 0)),
    notes: String(opts.packageNotes || ""),
    source,
  };
}

export function creditState(opts: {
  effective: EffectiveCredit;
  outstandingKes: number;
  status: string;
  suspendReason?: string;
  expired?: boolean;
  overdue?: boolean;
}): CreditSnapshot {
  const outstanding = Math.max(0, truncInt(opts.outstandingKes));
  const max = opts.effective.max_kes;
  const available = availableCredit(max, outstanding);
  const utilization = creditUtilization(max, outstanding);
  const atLimit = opts.effective.configured && outstanding >= max;
  const warning =
    opts.effective.configured &&
    opts.effective.send_warning &&
    opts.effective.warning_kes > 0 &&
    outstanding >= opts.effective.warning_kes &&
    !atLimit;

  let state: CreditState = "disabled";
  if (!opts.effective.enabled) state = "disabled";
  else if (!opts.effective.configured) state = "unconfigured";
  else if (opts.status === "suspended" && (opts.suspendReason === "credit_limit" || atLimit)) state = "suspended_limit";
  else if (atLimit) state = "limit_reached";
  else if (warning) state = "warning";
  else if (outstanding <= 0) state = "paid_active";
  else if (opts.overdue || opts.expired) state = "overdue_within_limit";
  else state = "active_on_credit";

  const covers =
    opts.effective.configured &&
    opts.effective.allow_continuity &&
    !atLimit &&
    outstanding < max &&
    opts.status !== "terminated";

  return {
    outstanding_kes: outstanding,
    available_kes: available,
    utilization_pct: utilization,
    state,
    label: creditStateLabel(state),
    covers,
    at_limit: atLimit,
    warning,
  };
}

export function creditStateLabel(state: CreditState) {
  if (state === "paid_active") return "Paid Active";
  if (state === "active_on_credit") return "Active on Credit";
  if (state === "overdue_within_limit") return "Overdue but Within Credit Limit";
  if (state === "warning") return "Approaching Credit Limit";
  if (state === "limit_reached") return "Credit Limit Reached";
  if (state === "suspended_limit") return "Suspended — Credit Limit Exceeded";
  if (state === "unconfigured") return "Credit not configured";
  return "Credit terms off";
}

export function accessLabel(status: string, suspendReason = "", snapshot?: CreditSnapshot | null) {
  if (snapshot?.state === "suspended_limit" || suspendReason === "credit_limit") {
    return creditStateLabel("suspended_limit");
  }
  if (snapshot?.state === "warning") return creditStateLabel("warning");
  if (snapshot?.state === "overdue_within_limit") return creditStateLabel("overdue_within_limit");
  if (snapshot?.state === "active_on_credit" || suspendReason === "business_credit") {
    return creditStateLabel("active_on_credit");
  }
  if (status === "grace") return "Grace Period";
  if (status === "pending") return "Pending";
  if (status === "suspended") return "Suspended";
  if (status === "terminated") return "Terminated";
  if (status === "active") return snapshot?.state === "paid_active" ? "Paid Active" : "Active";
  return status;
}

export function isCreditBlockedReason(reason: string) {
  return (CREDIT_BLOCKED_REASONS as readonly string[]).includes(reason);
}
