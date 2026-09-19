/** Client-safe continuing-client import helpers. No SQL, no Node APIs. */

import { parseYmdInput } from "./display.ts";
import type { AccessMethod } from "./types.ts";

export const ONBOARDING_TYPES = ["new", "continuing", "reactivation"] as const;
export type OnboardingType = (typeof ONBOARDING_TYPES)[number];

export const IMPORT_MODES = ["new", "continuing", "reactivation", "mixed"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const MAX_IMPORT_ROWS = 500;

const ACCESS_METHODS: AccessMethod[] = ["pppoe", "static", "hotspot"];

export const IMPORT_COLUMNS = [
  { key: "name", label: "Customer name", required: true },
  { key: "phone", label: "Phone", required: true },
  { key: "email", label: "Email", required: false },
  { key: "address", label: "Address", required: false },
  { key: "account_number", label: "ID", required: false },
  { key: "access_method", label: "Service type", required: false },
  { key: "package_name", label: "Package", required: true },
  { key: "username", label: "Service username", required: false },
  { key: "static_ip", label: "Static IP", required: false },
  { key: "router", label: "Router", required: false },
  { key: "pppoe_password", label: "PPPoE password", required: false },
  { key: "subscription_start_date", label: "Subscription start", required: false },
  { key: "subscription_expiry_date", label: "Subscription expiry", required: false },
  { key: "billing_anchor_date", label: "Billing anchor", required: false },
  { key: "onboarding_type", label: "Onboarding type", required: false },
  { key: "send_onboarding_notification", label: "Send onboarding SMS", required: false },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

export type MappedImportRow = {
  name: string;
  phone: string;
  email: string;
  address: string;
  account_number: string;
  access_method: string;
  package_name: string;
  username: string;
  static_ip: string;
  router: string;
  pppoe_password: string;
  subscription_start_date: string;
  subscription_expiry_date: string;
  billing_anchor_date: string;
  onboarding_type: string;
  send_onboarding_notification: string;
};

export type ImportIssue = { field: string; message: string };

export type ImportPreviewRow = {
  line: number;
  raw: MappedImportRow;
  name: string;
  phone: string;
  package_name: string;
  access_method: AccessMethod;
  onboarding_type: OnboardingType;
  expiry_ymd: string;
  first_renewal_ymd: string;
  start_ymd: string;
  send_onboarding_notification: boolean;
  username: string;
  static_ip: string;
  account_number: string;
  pppoe_password: string;
  router: string;
  notify_label: string;
  attach_customer_id?: string;
  attach_customer_name?: string;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

export function isOnboardingType(v: string): v is OnboardingType {
  return (ONBOARDING_TYPES as readonly string[]).includes(v);
}

export function isImportMode(v: string): v is ImportMode {
  return (IMPORT_MODES as readonly string[]).includes(v);
}

export function isMigratingOnboard(type: string | null | undefined) {
  return type === "continuing" || type === "reactivation";
}

export function onboardingTypeLabel(type: string) {
  if (type === "continuing") return "Continuing client";
  if (type === "reactivation") return "Reactivation";
  return "New customer";
}

export function importModeLabel(mode: string) {
  if (mode === "continuing") return "Continuing clients / migration";
  if (mode === "reactivation") return "Reactivation";
  if (mode === "mixed") return "Mixed import";
  return "New customers";
}

export function normalizeHeader(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const HEADER_ALIASES: Record<string, ImportColumnKey> = {
  name: "name",
  customer_name: "name",
  customer: "name",
  phone: "phone",
  mobile: "phone",
  msisdn: "phone",
  email: "email",
  address: "address",
  account_number: "account_number",
  customer_id: "account_number",
  customer_account: "account_number",
  account: "account_number",
  access_method: "access_method",
  service_type: "access_method",
  type: "access_method",
  package: "package_name",
  package_name: "package_name",
  plan: "package_name",
  username: "username",
  service_username: "username",
  pppoe: "username",
  pppoe_username: "username",
  static_ip: "static_ip",
  ip: "static_ip",
  router: "router",
  pppoe_password: "pppoe_password",
  password: "pppoe_password",
  subscription_start_date: "subscription_start_date",
  start_date: "subscription_start_date",
  subscription_expiry_date: "subscription_expiry_date",
  expiry: "subscription_expiry_date",
  expiry_date: "subscription_expiry_date",
  existing_expiry: "subscription_expiry_date",
  billing_anchor_date: "billing_anchor_date",
  billing_anchor: "billing_anchor_date",
  first_renewal: "billing_anchor_date",
  first_renewal_date: "billing_anchor_date",
  onboarding_type: "onboarding_type",
  onboarding: "onboarding_type",
  import_type: "onboarding_type",
  send_onboarding_notification: "send_onboarding_notification",
  notify: "send_onboarding_notification",
  sms: "send_onboarding_notification",
};

export function suggestColumnMap(headers: string[]): Record<ImportColumnKey, string> {
  const map = {} as Record<ImportColumnKey, string>;
  for (const col of IMPORT_COLUMNS) map[col.key] = "";
  for (const header of headers) {
    const key = HEADER_ALIASES[normalizeHeader(header)];
    if (key && !map[key]) map[key] = header;
  }
  return map;
}

export function emptyColumnMap(): Record<ImportColumnKey, string> {
  const map = {} as Record<ImportColumnKey, string>;
  for (const col of IMPORT_COLUMNS) map[col.key] = "";
  return map;
}

/** RFC-4180-ish CSV/TSV parser. */
export function parseDelimitedText(text: string): { headers: string[]; rows: string[][] } {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const delim = raw.indexOf("\t") >= 0 && (raw.indexOf(",") === -1 || raw.indexOf("\t") < raw.indexOf(",")) ? "\t" : ",";
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (quoted) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === delim) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && raw[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim())) table.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) table.push(row);
  const headers = (table[0] || []).map((h) => h.trim());
  const rows = table.slice(1).map((r) => {
    const next = r.slice();
    while (next.length < headers.length) next.push("");
    return next.slice(0, headers.length);
  });
  return { headers, rows };
}

export function parseFlexibleYmd(raw: string): string {
  return parseYmdInput(raw);
}

export function parseBool(raw: string, fallback = false) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(t)) return true;
  if (["0", "false", "no", "n", "off"].includes(t)) return false;
  return fallback;
}

export function parseOnboardingType(raw: string, mode: ImportMode): OnboardingType {
  const t = normalizeHeader(raw);
  if (t === "continuing" || t === "migration" || t === "migrating" || t === "existing") return "continuing";
  if (t === "reactivation" || t === "reactivate") return "reactivation";
  if (t === "new") return "new";
  if (mode === "mixed") return "continuing";
  if (mode === "new" || mode === "continuing" || mode === "reactivation") return mode;
  return "new";
}

export function parseAccessMethod(raw: string): AccessMethod {
  const t = normalizeHeader(raw);
  if (t === "static" || t === "static_ip" || t === "dedicated") return "static";
  if (t === "hotspot") return "hotspot";
  if (t === "pppoe" || t === "fibre" || t === "fiber" || t === "wireless" || t === "wifi") return "pppoe";
  if (ACCESS_METHODS.includes(raw as AccessMethod)) return raw as AccessMethod;
  return "pppoe";
}

export function mapRow(headers: string[], cols: string[], map: Record<ImportColumnKey, string>): MappedImportRow {
  const index = new Map(headers.map((h, i) => [h, i]));
  const get = (key: ImportColumnKey) => {
    const header = map[key];
    if (!header) return "";
    const i = index.get(header);
    return i == null ? "" : String(cols[i] ?? "").trim();
  };
  return {
    name: get("name"),
    phone: get("phone"),
    email: get("email"),
    address: get("address"),
    account_number: get("account_number"),
    access_method: get("access_method"),
    package_name: get("package_name"),
    username: get("username"),
    static_ip: get("static_ip"),
    router: get("router"),
    pppoe_password: get("pppoe_password"),
    subscription_start_date: get("subscription_start_date"),
    subscription_expiry_date: get("subscription_expiry_date"),
    billing_anchor_date: get("billing_anchor_date"),
    onboarding_type: get("onboarding_type"),
    send_onboarding_notification: get("send_onboarding_notification"),
  };
}

export function previewImportRow(
  line: number,
  raw: MappedImportRow,
  opts: {
    mode: ImportMode;
    packages: Array<{ name: string; access_method: AccessMethod; active: boolean }>;
  },
): ImportPreviewRow {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const name = raw.name.trim();
  if (!name) errors.push({ field: "name", message: "Customer name is required" });
  const phone = raw.phone.trim();
  if (phone.replace(/\D/g, "").length < 9) errors.push({ field: "phone", message: "Enter a valid phone number" });
  const onboarding_type = parseOnboardingType(raw.onboarding_type, opts.mode);
  const migrating = isMigratingOnboard(onboarding_type);
  let expiry_ymd = "";
  try {
    expiry_ymd = parseFlexibleYmd(raw.subscription_expiry_date);
  } catch (err) {
    if (raw.subscription_expiry_date.trim()) {
      errors.push({ field: "subscription_expiry_date", message: err instanceof Error ? err.message : "Invalid expiry date" });
    }
  }
  let start_ymd = "";
  try {
    start_ymd = parseFlexibleYmd(raw.subscription_start_date);
  } catch (err) {
    if (raw.subscription_start_date.trim()) {
      errors.push({ field: "subscription_start_date", message: err instanceof Error ? err.message : "Invalid start date" });
    }
  }
  let anchor = "";
  try {
    anchor = parseFlexibleYmd(raw.billing_anchor_date);
  } catch (err) {
    if (raw.billing_anchor_date.trim()) {
      errors.push({ field: "billing_anchor_date", message: err instanceof Error ? err.message : "Invalid billing anchor" });
    }
  }
  if (migrating && !expiry_ymd) {
    errors.push({ field: "subscription_expiry_date", message: "Continuing clients need the existing expiry date" });
  }
  const first_renewal_ymd = expiry_ymd || anchor;
  if (migrating && expiry_ymd && anchor && expiry_ymd !== anchor) {
    warnings.push({ field: "billing_anchor_date", message: "Billing anchor is taken from the expiry date" });
  }
  const access_method = parseAccessMethod(raw.access_method);
  const package_name = raw.package_name.trim();
  if (!package_name) errors.push({ field: "package_name", message: "Package is required" });
  const pkg = opts.packages.find((p) => p.name.toLowerCase() === package_name.toLowerCase() && p.active);
  const pkgAny = opts.packages.find((p) => p.name.toLowerCase() === package_name.toLowerCase());
  if (package_name && !pkg && !pkgAny) errors.push({ field: "package_name", message: "Package not found on this network" });
  if (pkgAny && !pkgAny.active) errors.push({ field: "package_name", message: "That package is not available" });
  if (pkg && raw.access_method.trim() && pkg.access_method !== access_method) {
    warnings.push({ field: "access_method", message: `Using ${pkg.access_method} from the package` });
  }
  const method = pkg?.access_method || access_method;
  if (method === "static" && raw.static_ip) {
    const parts = raw.static_ip.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      errors.push({ field: "static_ip", message: "Enter a valid IPv4 address" });
    }
  }
  const send = parseBool(raw.send_onboarding_notification, !migrating);
  return {
    line,
    raw,
    name,
    phone,
    package_name,
    access_method: method,
    onboarding_type,
    expiry_ymd,
    first_renewal_ymd,
    start_ymd,
    send_onboarding_notification: send,
    username: raw.username.trim(),
    static_ip: raw.static_ip.trim(),
    account_number: raw.account_number.trim(),
    pppoe_password: raw.pppoe_password.trim(),
    router: raw.router.trim(),
    notify_label: send ? "Yes" : "No",
    errors,
    warnings,
  };
}

export function importTemplateCsv() {
  return [
    "name,phone,email,address,account_number,access_method,package_name,username,static_ip,subscription_start_date,subscription_expiry_date,onboarding_type,send_onboarding_notification",
    "Acme Ltd,0700111222,net@acme.ke,Industrial Area,ACME-1,pppoe,Business 50,acme.pppoe,,01/09/26,30/09/26,continuing,no",
    "Jane Muthoni,0700222333,jane@example.com,Karen,,pppoe,Home 10,,,17/09/26,17/10/26,new,yes",
  ].join("\n");
}

export function defaultActivationForOnboarding(type: OnboardingType, priceKes: number) {
  if (isMigratingOnboard(type)) return "active" as const;
  return priceKes > 0 ? ("after_payment" as const) : ("active" as const);
}
