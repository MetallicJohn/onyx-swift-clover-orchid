import type { AccessMethod, PackageRow } from "./types.ts";
import {
  formatHotspotDuration,
  hotspotPackageDuration,
  type HotspotDurationUnit,
  validityHoursFromDuration,
} from "./hotspot-duration.ts";

export type { HotspotDurationUnit };

/** listPackages returns the full tenant catalog. Page/limit are applied here until the API grows pagination. */
export const PACKAGE_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PACKAGE_PAGE_SIZE = 25;
export const DEFAULT_DURATION_DAYS = 30;
export const DEFAULT_GRACE_DAYS = 0;
export const DEFAULT_VALIDITY_HOURS = DEFAULT_DURATION_DAYS * 24;
export const DEFAULT_HOTSPOT_DURATION_VALUE = 1;
export const DEFAULT_HOTSPOT_DURATION_UNIT: HotspotDurationUnit = "hours";
export const PACKAGE_PREFS_KEY = "isp-packages-prefs.v1";
export const HOTSPOT_DURATION_UNITS: { value: HotspotDurationUnit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
];

export type PackagesView = "card" | "list";
export type PackagesSort = "name" | "price" | "duration" | "speed";
export type PackagesStatusFilter = "all" | "active" | "inactive";
export type PackagesAccessFilter = "all" | AccessMethod;
export type ValidityUnit = "hours" | "days";
export type CapUnit = "mb" | "gb";

export type PackageFormState = {
  name: string;
  description: string;
  access_method: AccessMethod;
  download_mbps: number;
  upload_mbps: number;
  price_kes: number;
  billing_interval: string;
  grace_days: number;
  bundle_mb: number;
  validity_hours: number;
  duration_value: number;
  duration_unit: HotspotDurationUnit;
  active: boolean;
  tier: string;
  business_credit_enabled: boolean;
  max_credit_kes: number;
  credit_warning_kes: number;
  disconnect_when_credit_reached: boolean;
  allow_service_continuity_after_expiry: boolean;
  send_credit_limit_warning: boolean;
  credit_days_limit: number;
  credit_terms_notes: string;
};

export type PackageFieldErrors = Partial<
  Record<"name" | "download_mbps" | "upload_mbps" | "price_kes" | "grace_days" | "duration_value", string>
>;

export type PackagesPrefs = {
  view: PackagesView;
  pageSize: (typeof PACKAGE_PAGE_SIZES)[number];
};

export const CREATE_PACKAGE_DEFAULTS: PackageFormState = {
  name: "",
  description: "",
  access_method: "pppoe",
  download_mbps: 10,
  upload_mbps: 5,
  price_kes: 2500,
  billing_interval: "monthly",
  grace_days: DEFAULT_GRACE_DAYS,
  bundle_mb: 0,
  validity_hours: DEFAULT_VALIDITY_HOURS,
  duration_value: DEFAULT_DURATION_DAYS,
  duration_unit: "days",
  active: true,
  tier: "residential",
  business_credit_enabled: false,
  max_credit_kes: 0,
  credit_warning_kes: 0,
  disconnect_when_credit_reached: true,
  allow_service_continuity_after_expiry: true,
  send_credit_limit_warning: true,
  credit_days_limit: 0,
  credit_terms_notes: "",
};

export function blankPackageForm(method: AccessMethod = "pppoe"): PackageFormState {
  if (method === "hotspot") {
    return {
      ...CREATE_PACKAGE_DEFAULTS,
      access_method: "hotspot",
      price_kes: 50,
      billing_interval: "daily",
      grace_days: 0,
      validity_hours: DEFAULT_HOTSPOT_DURATION_VALUE,
      duration_value: DEFAULT_HOTSPOT_DURATION_VALUE,
      duration_unit: DEFAULT_HOTSPOT_DURATION_UNIT,
      tier: "residential",
      business_credit_enabled: false,
      max_credit_kes: 0,
      credit_warning_kes: 0,
      disconnect_when_credit_reached: true,
      allow_service_continuity_after_expiry: false,
      send_credit_limit_warning: false,
      credit_days_limit: 0,
      credit_terms_notes: "",
    };
  }
  return { ...CREATE_PACKAGE_DEFAULTS, access_method: method };
}

export function formFromPackage(p: PackageRow): PackageFormState {
  const dur = hotspotPackageDuration(p);
  return {
    name: p.name,
    description: p.description,
    access_method: p.access_method,
    download_mbps: p.download_mbps,
    upload_mbps: p.upload_mbps,
    price_kes: p.price_kes,
    billing_interval: p.billing_interval,
    grace_days: p.grace_days,
    bundle_mb: p.bundle_mb,
    validity_hours: p.validity_hours,
    duration_value: dur.value,
    duration_unit: dur.unit,
    active: p.active,
    tier: p.tier || "residential",
    business_credit_enabled: Boolean(p.business_credit_enabled),
    max_credit_kes: p.max_credit_kes ?? 0,
    credit_warning_kes: p.credit_warning_kes ?? 0,
    disconnect_when_credit_reached: p.disconnect_when_credit_reached !== false,
    allow_service_continuity_after_expiry: p.allow_service_continuity_after_expiry !== false,
    send_credit_limit_warning: p.send_credit_limit_warning !== false,
    credit_days_limit: p.credit_days_limit ?? 0,
    credit_terms_notes: p.credit_terms_notes || "",
  };
}

export function validityUnitOf(hours: number): ValidityUnit {
  return hours > 0 && hours % 24 !== 0 ? "hours" : "days";
}

export function capUnitOf(mb: number): CapUnit {
  return mb > 0 && mb % 1024 !== 0 ? "mb" : "gb";
}

export function shownValidity(hours: number, unit: ValidityUnit) {
  if (!hours) return 0;
  if (unit === "hours") return hours;
  const days = hours / 24;
  return Number.isInteger(days) ? days : Math.round(days * 100) / 100;
}

export function shownCap(mb: number, unit: CapUnit) {
  if (!mb) return 0;
  if (unit === "mb") return mb;
  const gb = mb / 1024;
  return Number.isInteger(gb) ? gb : Math.round(gb * 100) / 100;
}

export function hoursFromInput(value: number, unit: ValidityUnit) {
  const n = Math.max(0, Number(value) || 0);
  return Math.round(unit === "days" ? n * 24 : n);
}

export function mbFromInput(value: number, unit: CapUnit) {
  const n = Math.max(0, Number(value) || 0);
  return Math.round(unit === "gb" ? n * 1024 : n);
}

export function durationLabel(
  hours: number,
  billingInterval: string,
  pkg?: Pick<PackageRow, "duration_value" | "duration_unit" | "access_method" | "validity_hours">,
) {
  if (pkg?.access_method === "hotspot") {
    const dur = hotspotPackageDuration(pkg);
    return formatHotspotDuration(dur.value, dur.unit);
  }
  if (!hours) return intervalLabel(billingInterval);
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export function graceLabel(days: number) {
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function capLabel(mb: number) {
  if (!mb) return "Unlimited";
  if (mb % 1024 === 0) return `${mb / 1024} GB`;
  return `${mb} MB`;
}

export function intervalLabel(interval: string) {
  const labels: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
  };
  return labels[interval] || interval;
}

export function speedLabel(down: number, up: number) {
  return `${down}/${up} Mbps`;
}

export function validatePackageForm(form: PackageFormState): PackageFieldErrors {
  const errors: PackageFieldErrors = {};
  if (!form.name.trim()) errors.name = "Name is required";
  if (!(form.download_mbps >= 1)) errors.download_mbps = "Download must be at least 1 Mbps";
  if (!(form.upload_mbps >= 1)) errors.upload_mbps = "Upload must be at least 1 Mbps";
  if (!(form.price_kes >= 0)) errors.price_kes = "Price cannot be negative";
  if (form.access_method === "hotspot") {
    if (!(form.duration_value >= 1)) errors.duration_value = "Duration is required";
  } else if (!(form.grace_days >= 0)) {
    errors.grace_days = "Grace cannot be negative";
  }
  return errors;
}

export function persistableDuration(form: PackageFormState) {
  if (form.access_method === "hotspot") {
    const value = Math.max(1, Math.trunc(Number(form.duration_value) || 0));
    const unit = form.duration_unit;
    return {
      duration_value: value,
      duration_unit: unit,
      validity_hours: validityHoursFromDuration(value, unit),
      grace_days: 0,
      billing_interval: form.billing_interval || "daily",
      tier: "residential" as const,
      business_credit_enabled: false,
    };
  }
  return {
    duration_value: form.duration_value || 0,
    duration_unit: form.duration_unit || "days",
    validity_hours: Math.max(0, form.validity_hours ?? 0),
    grace_days: form.grace_days,
    billing_interval: form.billing_interval,
    tier: form.tier,
    business_credit_enabled: form.business_credit_enabled,
  };
}

export function filterPackages(
  packages: PackageRow[],
  opts: { q: string; access: PackagesAccessFilter; status: PackagesStatusFilter },
) {
  const needle = opts.q.trim().toLowerCase();
  return packages.filter((p) => {
    if (opts.access !== "all" && p.access_method !== opts.access) return false;
    if (opts.status === "active" && !p.active) return false;
    if (opts.status === "inactive" && p.active) return false;
    if (!needle) return true;
    const hay = `${p.name} ${p.description} ${p.id}`.toLowerCase();
    return hay.includes(needle);
  });
}

export function sortPackages(packages: PackageRow[], sort: PackagesSort) {
  const rows = [...packages];
  rows.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "duration") {
      const da = hotspotPackageDuration(a);
      const db = hotspotPackageDuration(b);
      const ma = validityHoursFromDuration(da.value, da.unit);
      const mb = validityHoursFromDuration(db.value, db.unit);
      return ma - mb || a.name.localeCompare(b.name);
    }
    if (sort === "speed") return b.download_mbps - a.download_mbps || a.name.localeCompare(b.name);
    return a.price_kes - b.price_kes || a.name.localeCompare(b.name);
  });
  return rows;
}

export function paginatePackages<T>(rows: T[], page: number, pageSize: number) {
  const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || DEFAULT_PACKAGE_PAGE_SIZE)));
  const pages = Math.max(1, Math.ceil(rows.length / size) || 1);
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return {
    page: current,
    pages,
    pageSize: size,
    total: rows.length,
    rows: rows.slice(start, start + size),
    from: rows.length === 0 ? 0 : start + 1,
    to: Math.min(start + size, rows.length),
  };
}

function isPageSize(value: number): value is (typeof PACKAGE_PAGE_SIZES)[number] {
  return (PACKAGE_PAGE_SIZES as readonly number[]).includes(value);
}

export function readPackagesPrefs(): PackagesPrefs {
  const fallback: PackagesPrefs = { view: "card", pageSize: DEFAULT_PACKAGE_PAGE_SIZE };
  if (typeof sessionStorage === "undefined") return fallback;
  try {
    const raw = sessionStorage.getItem(PACKAGE_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PackagesPrefs>;
    return {
      view: parsed.view === "list" ? "list" : "card",
      pageSize: isPageSize(Number(parsed.pageSize)) ? (Number(parsed.pageSize) as PackagesPrefs["pageSize"]) : DEFAULT_PACKAGE_PAGE_SIZE,
    };
  } catch {
    return fallback;
  }
}

export function writePackagesPrefs(prefs: PackagesPrefs) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(PACKAGE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}
