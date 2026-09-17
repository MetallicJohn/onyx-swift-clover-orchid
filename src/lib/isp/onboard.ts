import { addNairobiDays, nairobiDate } from "./empty-tenant.ts";
import { last9Phone } from "./customer-portal-format.ts";
import { normalizePhone } from "./phone.ts";
import { parseExpiryYmd } from "./service-expiry-format.ts";
import type { AccessMethod } from "./types.ts";
import {
  isMigratingOnboard,
  isOnboardingType,
  parseFlexibleYmd,
  type OnboardingType,
} from "./onboard-import-format.ts";

export const ACCESS_METHODS: AccessMethod[] = ["pppoe", "static", "hotspot"];
export const ACTIVATION_MODES = ["active", "after_payment", "after_partial"] as const;
export type ActivationMode = (typeof ACTIVATION_MODES)[number];
export const AWAITING_PAYMENT = "awaiting_payment";
export type { OnboardingType };
export { isMigratingOnboard, isOnboardingType, onboardingTypeLabel } from "./onboard-import-format.ts";

export type OnboardCustomerDraft = {
  name: string;
  phone: string;
  email: string;
  address: string;
  type: string;
  tag_ids: string[];
  account_number: string;
  notes: string;
  portal_password: string;
};

export type OnboardServiceDraft = {
  name?: string;
  access_method: AccessMethod;
  package_id: string;
  username: string;
  auto_username: boolean;
  static_ip: string;
  pool_id: string;
  router_id: string;
  mac_address: string;
  cpe_id: string;
  expiry_ymd: string;
  activation: ActivationMode;
  notes: string;
  hotspot_mode: "account" | "voucher";
  onboarding_type?: OnboardingType;
  subscription_start_ymd?: string;
  send_onboarding_notification?: boolean;
  import_source?: string;
  import_batch_id?: string;
  pppoe_password?: string;
};

export type OnboardPayload = {
  customer_mode: "new" | "existing";
  customer_id?: string;
  customer?: OnboardCustomerDraft;
  acknowledge_duplicates?: boolean;
  include_service: boolean;
  service?: OnboardServiceDraft;
};

export type DuplicateMatch = {
  id: string;
  name: string;
  phone: string;
  email: string;
  account_number: string;
  reason: "phone" | "email" | "name";
  blocking: boolean;
};

export const EMPTY_CUSTOMER: OnboardCustomerDraft = {
  name: "",
  phone: "",
  email: "",
  address: "",
  type: "individual",
  tag_ids: [],
  account_number: "",
  notes: "",
  portal_password: "",
};

export const EMPTY_SERVICE: OnboardServiceDraft = {
  name: "",
  access_method: "pppoe",
  package_id: "",
  username: "",
  auto_username: true,
  static_ip: "",
  pool_id: "",
  router_id: "",
  mac_address: "",
  cpe_id: "",
  expiry_ymd: "",
  activation: "after_payment",
  notes: "",
  hotspot_mode: "account",
  onboarding_type: "new",
  subscription_start_ymd: "",
  send_onboarding_notification: true,
  pppoe_password: "",
};

export function isAccessMethod(v: string): v is AccessMethod {
  return ACCESS_METHODS.includes(v as AccessMethod);
}

export function isActivationMode(v: string): v is ActivationMode {
  return ACTIVATION_MODES.includes(v as ActivationMode);
}

export function normalizeName(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function sanitizeMac(raw: string) {
  return raw.replace(/[^0-9a-f]/gi, "").toUpperCase().slice(0, 12);
}

export function billingPeriodLabel(interval: string, hours = 0) {
  if (hours > 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  if (interval === "daily") return "Daily";
  if (interval === "weekly") return "Weekly";
  if (interval === "quarterly") return "Quarterly";
  if (interval === "yearly") return "Yearly";
  return "Monthly";
}

export function defaultActivation(priceKes: number): ActivationMode {
  return priceKes > 0 ? "after_payment" : "active";
}

export type ExpiryPackage = { billing_interval: string; validity_hours: number };

/** Default calendar expiry for a new service. Stored as YYYY-MM-DD (Africa/Nairobi). */
export function defaultExpiryYmd(
  pkg: ExpiryPackage | null | undefined,
  activation: ActivationMode = "after_payment",
  now = new Date(),
) {
  if (activation === "after_payment" || activation === "after_partial") return nairobiDate(now);
  const hours = pkg?.validity_hours || 0;
  if (hours > 0) return nairobiDate(new Date(now.getTime() + hours * 3600_000));
  const interval = pkg?.billing_interval || "monthly";
  if (interval === "daily") return addNairobiDays(1, now);
  if (interval === "weekly") return addNairobiDays(7, now);
  if (interval === "yearly") return addNairobiDays(365, now);
  return addNairobiDays(30, now);
}

/**
 * Recalculate the default expiry only when activation changes and the staff
 * date has not been edited. A manually chosen date is never overwritten.
 */
export function expiryAfterActivationChange(opts: {
  currentYmd: string;
  previousActivation: ActivationMode;
  nextActivation: ActivationMode;
  pkg?: ExpiryPackage | null;
  dirty: boolean;
  now?: Date;
  onboardingType?: OnboardingType;
}) {
  if (opts.dirty) return opts.currentYmd;
  if (isMigratingOnboard(opts.onboardingType)) return opts.currentYmd;
  if (opts.previousActivation === opts.nextActivation && opts.currentYmd) return opts.currentYmd;
  return defaultExpiryYmd(opts.pkg, opts.nextActivation, opts.now);
}

export function expiryHelperText(activation: ActivationMode, onboardingType: OnboardingType = "new") {
  if (isMigratingOnboard(onboardingType)) {
    return "Pick the expiry this customer already has. The first renewal invoice uses that date — not today.";
  }
  if (activation === "active") {
    return "Default expiry date: 30 days from today. The service will be active immediately.";
  }
  if (activation === "after_partial") {
    return "Default expiry date: today. The service stays awaiting payment until a qualifying partial payment is received.";
  }
  return "Default expiry date: today. The service will activate after the required full payment is received.";
}

export function activationLabel(activation: ActivationMode) {
  if (activation === "active") return "Start as Active";
  if (activation === "after_partial") return "Activate after qualifying partial payment";
  return "Activate after full payment";
}

export function defaultServiceName(pkgName: string, current?: string, dirty = false) {
  if (dirty && (current || "").trim()) return (current || "").trim().slice(0, 80);
  return (pkgName || current || "").trim().slice(0, 80);
}

export function sanitizeCustomer(raw: Partial<OnboardCustomerDraft> | null | undefined): OnboardCustomerDraft {
  const d = raw || {};
  const type = d.type === "business" ? "business" : "individual";
  const tags = Array.isArray(d.tag_ids) ? [...new Set(d.tag_ids.filter((id) => typeof id === "string" && id))] : [];
  return {
    name: String(d.name || "").trim().slice(0, 120),
    phone: String(d.phone || "").trim().slice(0, 32),
    email: String(d.email || "").trim().slice(0, 160),
    address: String(d.address || "").trim().slice(0, 240),
    type,
    tag_ids: tags.slice(0, 40),
    account_number: String(d.account_number || "").trim().toUpperCase().slice(0, 32),
    notes: String(d.notes || "").trim().slice(0, 4000),
    portal_password: String(d.portal_password || ""),
  };
}

export function stripIncompatibleFields(draft: OnboardServiceDraft): OnboardServiceDraft {
  const next: OnboardServiceDraft = { ...draft };
  if (next.access_method !== "static") {
    next.static_ip = "";
    next.pool_id = "";
  }
  if (next.access_method === "static") {
    next.username = "";
    next.auto_username = true;
    next.hotspot_mode = "account";
  }
  if (next.access_method === "hotspot") {
    next.cpe_id = "";
    next.mac_address = "";
  }
  if (next.access_method !== "hotspot") next.hotspot_mode = "account";
  if (next.auto_username && next.access_method !== "static") next.username = next.username && !next.auto_username ? next.username : "";
  if (next.auto_username) next.username = "";
  return next;
}

export function sanitizeService(raw: Partial<OnboardServiceDraft> | null | undefined): OnboardServiceDraft {
  const d = raw || {};
  const method: AccessMethod = isAccessMethod(String(d.access_method || "")) ? (d.access_method as AccessMethod) : "pppoe";
  const activation: ActivationMode = isActivationMode(String(d.activation || ""))
    ? (d.activation as ActivationMode)
    : "after_payment";
  const hotspot_mode = d.hotspot_mode === "voucher" ? "voucher" : "account";
  const onboarding_type: OnboardingType = isOnboardingType(String(d.onboarding_type || ""))
    ? (d.onboarding_type as OnboardingType)
    : "new";
  const migrating = isMigratingOnboard(onboarding_type);
  const send =
    d.send_onboarding_notification == null ? !migrating : Boolean(d.send_onboarding_notification);
  let expiry_ymd = String(d.expiry_ymd || "").trim();
  if (expiry_ymd && !/^\d{4}-\d{2}-\d{2}$/.test(expiry_ymd)) {
    try {
      expiry_ymd = parseFlexibleYmd(expiry_ymd);
    } catch {
      /* leave raw so validateServiceDraft can report it */
    }
  }
  let subscription_start_ymd = String(d.subscription_start_ymd || "").trim();
  if (subscription_start_ymd && !/^\d{4}-\d{2}-\d{2}$/.test(subscription_start_ymd)) {
    try {
      subscription_start_ymd = parseFlexibleYmd(subscription_start_ymd);
    } catch {
      /* leave raw so validateServiceDraft can report it */
    }
  }
  return stripIncompatibleFields({
    name: String(d.name || "").trim().slice(0, 80),
    access_method: method,
    package_id: String(d.package_id || "").trim(),
    username: String(d.username || "").trim().slice(0, 24),
    auto_username: d.auto_username !== false,
    static_ip: String(d.static_ip || "").trim(),
    pool_id: String(d.pool_id || "").trim(),
    router_id: String(d.router_id || "").trim(),
    mac_address: sanitizeMac(String(d.mac_address || "")),
    cpe_id: String(d.cpe_id || "").trim(),
    expiry_ymd,
    activation: migrating && !isActivationMode(String(d.activation || "")) ? "active" : activation,
    notes: String(d.notes || "").trim().slice(0, 4000),
    hotspot_mode,
    onboarding_type,
    subscription_start_ymd,
    send_onboarding_notification: send,
    import_source: String(d.import_source || "").trim().slice(0, 80),
    import_batch_id: String(d.import_batch_id || "").trim().slice(0, 64) || undefined,
    pppoe_password: String(d.pppoe_password || "").trim().slice(0, 64),
  });
}

export function sanitizePayload(raw: Partial<OnboardPayload> | null | undefined): OnboardPayload {
  const d = raw || {};
  const include = Boolean(d.include_service);
  const mode = d.customer_mode === "existing" ? "existing" : "new";
  return {
    customer_mode: mode,
    customer_id: mode === "existing" ? String(d.customer_id || "").trim() : undefined,
    customer: mode === "new" ? sanitizeCustomer(d.customer) : undefined,
    acknowledge_duplicates: Boolean(d.acknowledge_duplicates),
    include_service: include,
    service: include ? sanitizeService(d.service) : undefined,
  };
}

export function validateCustomerDraft(c: OnboardCustomerDraft) {
  const errors: Record<string, string> = {};
  if (!c.name) errors.name = "Name is required";
  const last9 = last9Phone(c.phone);
  if (last9.length < 9) errors.phone = "Enter a valid phone number";
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.email = "Enter a valid email or leave it blank";
  if (c.portal_password && c.portal_password.length < 8) errors.portal_password = "Portal password must be at least 8 characters";
  return errors;
}

export function validateServiceDraft(
  s: OnboardServiceDraft,
  pkg?: { id: string; access_method: AccessMethod; active: boolean } | null,
) {
  const errors: Record<string, string> = {};
  if (!isAccessMethod(s.access_method)) errors.access_method = "Choose PPPoE, Static IP, or Hotspot";
  if (!s.package_id) errors.package_id = "Choose a package";
  if (pkg && pkg.id !== s.package_id) errors.package_id = "Package not found";
  if (pkg && !pkg.active) errors.package_id = "That package is not available";
  if (pkg && pkg.access_method !== s.access_method) {
    errors.package_id = "Package does not match the selected service type";
  }
  if (s.access_method !== "static" && !s.auto_username && !s.username) {
    errors.username = s.access_method === "hotspot" ? "Enter a hotspot username" : "Enter a PPPoE username";
  }
  if (s.access_method === "static" && s.static_ip) {
    const parts = s.static_ip.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      errors.static_ip = "Enter a valid IPv4 address or leave blank to auto-assign";
    }
  }
  if (s.mac_address && s.mac_address.length !== 12) errors.mac_address = "MAC must be 12 hex characters";
  if (s.expiry_ymd) {
    try {
      parseExpiryYmd(s.expiry_ymd.includes("-") && s.expiry_ymd.length === 10 ? s.expiry_ymd : parseFlexibleYmd(s.expiry_ymd));
    } catch (err) {
      errors.expiry_ymd = err instanceof Error ? err.message : "Choose a valid calendar date";
    }
  }
  if (s.subscription_start_ymd) {
    try {
      parseFlexibleYmd(s.subscription_start_ymd);
    } catch (err) {
      errors.subscription_start_ymd = err instanceof Error ? err.message : "Choose a valid start date";
    }
  }
  if (isMigratingOnboard(s.onboarding_type) && !s.expiry_ymd) {
    errors.expiry_ymd = "Continuing clients need the existing subscription expiry date";
  }
  if (!isOnboardingType(s.onboarding_type || "new")) errors.onboarding_type = "Choose how this service is being added";
  if (!isActivationMode(s.activation)) errors.activation = "Choose how this service should start";
  return errors;
}

export function validatePayload(
  payload: OnboardPayload,
  pkg?: { id: string; access_method: AccessMethod; active: boolean } | null,
) {
  const errors: Record<string, string> = {};
  if (payload.customer_mode === "existing") {
    if (!payload.customer_id) errors.customer_id = "Choose a customer";
  } else {
    Object.assign(errors, validateCustomerDraft(payload.customer || EMPTY_CUSTOMER));
  }
  if (payload.include_service) {
    Object.assign(errors, validateServiceDraft(payload.service || EMPTY_SERVICE, pkg));
  } else if (payload.customer_mode === "existing") {
    errors.include_service = "Add a service, or create a new customer instead";
  }
  return errors;
}

export function firstError(errors: Record<string, string>) {
  const key = Object.keys(errors)[0];
  return key ? errors[key] : "";
}

export function scoreDuplicate(
  draft: { name: string; phone: string; email: string },
  row: { id: string; name: string; phone: string; email: string; account_number?: string },
): DuplicateMatch | null {
  const last9 = last9Phone(draft.phone);
  if (last9.length >= 9 && last9Phone(row.phone) === last9) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      account_number: row.account_number || "",
      reason: "phone",
      blocking: true,
    };
  }
  const email = draft.email.trim().toLowerCase();
  if (email && row.email.trim().toLowerCase() === email) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      account_number: row.account_number || "",
      reason: "email",
      blocking: false,
    };
  }
  if (normalizeName(draft.name) && normalizeName(draft.name) === normalizeName(row.name)) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      account_number: row.account_number || "",
      reason: "name",
      blocking: false,
    };
  }
  return null;
}

export function storedAccessFields(s: OnboardServiceDraft) {
  if (s.access_method === "pppoe") {
    return {
      username: s.auto_username ? null : s.username || null,
      static_ip: null,
      mac_address: s.mac_address || "",
      cpe_id: s.cpe_id || null,
      pool_id: null,
    };
  }
  if (s.access_method === "static") {
    return {
      username: null,
      static_ip: s.static_ip || null,
      mac_address: s.mac_address || "",
      cpe_id: s.cpe_id || null,
      pool_id: s.pool_id || null,
    };
  }
  return {
    username: s.auto_username ? null : s.username || null,
    static_ip: null,
    mac_address: "",
    cpe_id: null,
    pool_id: null,
  };
}

export function displayDraftAccount(
  entered: string | undefined,
  kind: "new" | "existing" = "new",
) {
  const v = (entered || "").trim();
  if (v) return v;
  return kind === "existing" ? "No account number" : "Assigned on save";
}

export function displayPhone(raw: string) {
  const n = normalizePhone(raw);
  if (/^254[17]\d{8}$/.test(n)) return `0${n.slice(3)}`;
  return raw.trim();
}

export function provisionStatusLabel(overall: string) {
  if (overall === "pending") return "Pending";
  if (overall === "queued") return "Queued";
  if (overall === "device_offline") return "Offline";
  if (overall === "applying") return "Applying";
  if (overall === "applied") return "Applied";
  if (overall === "verification_pending") return "Verification pending";
  if (overall === "verified") return "Verified";
  if (overall === "failed") return "Failed";
  if (overall === "retry_required") return "Retry required";
  return overall || "Pending";
}

export function billingAnchorYmd(expiryYmd: string) {
  if (!expiryYmd) return "";
  try {
    return parseFlexibleYmd(expiryYmd);
  } catch {
    return expiryYmd;
  }
}
