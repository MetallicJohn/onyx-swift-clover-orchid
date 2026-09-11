export const COMM_CATEGORIES = [
  { id: "service_interruption", label: "Service Interruption" },
  { id: "planned_maintenance", label: "Planned Maintenance" },
  { id: "unplanned_outage", label: "Unplanned Outage" },
  { id: "service_restored", label: "Service Restored" },
  { id: "general_announcement", label: "General Announcement" },
  { id: "special_offer", label: "Special Offer" },
  { id: "package_promotion", label: "Package Promotion" },
  { id: "payment_reminder", label: "Payment Reminder" },
  { id: "custom_notice", label: "Custom Notice" },
] as const;

export type CommCategory = (typeof COMM_CATEGORIES)[number]["id"];

export const COMM_VARS = [
  { key: "customer_name", label: "Customer name" },
  { key: "account_number", label: "Account number" },
  { key: "service_name", label: "Service" },
  { key: "package_name", label: "Package" },
  { key: "service_expiry", label: "Service expiry" },
  { key: "maintenance_date", label: "Maintenance date" },
  { key: "maintenance_start", label: "Start time" },
  { key: "maintenance_end", label: "End time" },
  { key: "expected_duration", label: "Expected duration" },
  { key: "expected_time", label: "Expected restoration" },
  { key: "area", label: "Area" },
  { key: "support_contact", label: "Support contact" },
  { key: "company_name", label: "Company name" },
] as const;

export type CommVarKey = (typeof COMM_VARS)[number]["key"];

export type CommVars = Partial<Record<CommVarKey, string>>;

export type CommExtras = {
  maintenance_date?: string;
  maintenance_start?: string;
  maintenance_end?: string;
  expected_duration?: string;
  expected_time?: string;
  area?: string;
};

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

export function isGsmText(text: string) {
  for (const ch of text) {
    if (!GSM_BASIC.includes(ch)) return false;
  }
  return true;
}

export function smsSegments(text: string) {
  const chars = [...text].length;
  const gsm = isGsmText(text);
  if (chars === 0) return { chars: 0, parts: 0, encoding: "gsm" as const };
  if (gsm) {
    const parts = chars <= 160 ? 1 : Math.ceil(chars / 153);
    return { chars, parts, encoding: "gsm" as const };
  }
  const parts = chars <= 70 ? 1 : Math.ceil(chars / 67);
  return { chars, parts, encoding: "ucs2" as const };
}

export function renderCommTemplate(template: string, vars: CommVars) {
  return template.replace(/\{\{([a-z_]+)\}\}|\{([a-z_]+)\}/g, (_, a: string, b: string) => {
    const key = (a || b) as CommVarKey;
    return vars[key] ?? "";
  });
}

export function insertCommVar(body: string, key: CommVarKey) {
  return `${body}{{${key}}}`;
}

export const DEFAULT_COMM_TEMPLATES: Array<{ category: CommCategory; name: string; body: string }> = [
  {
    category: "planned_maintenance",
    name: "Planned maintenance",
    body: "Dear {{customer_name}}, we will carry out network maintenance on {{maintenance_date}} from {{maintenance_start}} to {{maintenance_end}}. Your internet service may be unavailable during this period. We apologise for the inconvenience. {{company_name}}",
  },
  {
    category: "unplanned_outage",
    name: "Unplanned outage",
    body: "Dear {{customer_name}}, we are currently experiencing a network outage affecting {{area}}. Our team is working to restore service as soon as possible. We expect service to be restored by {{expected_time}}. We apologise for the inconvenience. {{company_name}}",
  },
  {
    category: "service_restored",
    name: "Service restored",
    body: "Dear {{customer_name}}, internet service has been restored following the earlier network interruption. Thank you for your patience. {{company_name}}",
  },
  {
    category: "service_interruption",
    name: "Service interruption",
    body: "Dear {{customer_name}}, your {{package_name}} service is currently interrupted. Our team is investigating. {{company_name}}",
  },
  {
    category: "general_announcement",
    name: "General announcement",
    body: "Hello {{customer_name}}, {{company_name}} has an update for your account {{account_number}}. For help call {{support_contact}}.",
  },
  {
    category: "special_offer",
    name: "Special offer",
    body: "Hello {{customer_name}}, we have a special offer available on selected internet packages. Contact us to find out more. {{company_name}}",
  },
  {
    category: "package_promotion",
    name: "Package promotion",
    body: "Hello {{customer_name}}, upgrade options are available on your {{package_name}} line. Talk to us on {{support_contact}}. {{company_name}}",
  },
  {
    category: "payment_reminder",
    name: "Payment reminder",
    body: "Dear {{customer_name}}, your {{package_name}} service is due on {{service_expiry}}. Pay to stay online. {{company_name}}",
  },
  {
    category: "custom_notice",
    name: "Custom notice",
    body: "Dear {{customer_name}}, {{company_name}}.",
  },
];

export function categoryLabel(id: string) {
  return COMM_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export type AudienceFilter = {
  statuses?: Array<"active" | "suspended" | "expired" | "grace">;
  access?: Array<"pppoe" | "static" | "hotspot">;
  package_ids?: string[];
  area?: string;
  types?: string[];
  overdue?: boolean;
  expiring_days?: number;
  new_days?: number;
  long_term_days?: number;
  tag_ids?: string[];
};

export function filterSignature(filter: AudienceFilter) {
  return JSON.stringify({
    statuses: [...(filter.statuses ?? [])].sort(),
    access: [...(filter.access ?? [])].sort(),
    package_ids: [...(filter.package_ids ?? [])].sort(),
    area: (filter.area ?? "").trim().toLowerCase(),
    types: [...(filter.types ?? [])].sort(),
    overdue: Boolean(filter.overdue),
    expiring_days: filter.expiring_days ?? 0,
    new_days: filter.new_days ?? 0,
    long_term_days: filter.long_term_days ?? 0,
    tag_ids: [...(filter.tag_ids ?? [])].sort(),
  });
}

export function describeFilter(filter: AudienceFilter, packageNames: string[] = []) {
  const bits: string[] = [];
  if (filter.statuses?.length) bits.push(filter.statuses.join(" + "));
  else bits.push("All statuses");
  if (filter.access?.length) bits.push(filter.access.map((a) => (a === "pppoe" ? "PPPoE" : a === "static" ? "Static IP" : "Hotspot")).join(" + "));
  else bits.push("All services");
  if (filter.package_ids?.length) bits.push(packageNames.length ? packageNames.join(" + ") : `${filter.package_ids.length} packages`);
  if (filter.area?.trim()) bits.push(filter.area.trim());
  if (filter.types?.length) bits.push(filter.types.join(" + "));
  if (filter.overdue) bits.push("Overdue");
  if (filter.expiring_days) bits.push(`Expiring in ${filter.expiring_days}d`);
  if (filter.new_days) bits.push(`New (${filter.new_days}d)`);
  if (filter.long_term_days) bits.push("Long-term");
  if (filter.tag_ids?.length) bits.push(`${filter.tag_ids.length} tag${filter.tag_ids.length === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

export function parseAudienceFilter(raw: string): AudienceFilter {
  try {
    const v = JSON.parse(raw) as AudienceFilter;
    if (!v || typeof v !== "object") return {};
    return {
      statuses: Array.isArray(v.statuses) ? v.statuses : undefined,
      access: Array.isArray(v.access) ? v.access : undefined,
      package_ids: Array.isArray(v.package_ids) ? v.package_ids : undefined,
      area: typeof v.area === "string" ? v.area : undefined,
      types: Array.isArray(v.types) ? v.types : undefined,
      overdue: Boolean(v.overdue) || undefined,
      expiring_days: typeof v.expiring_days === "number" && v.expiring_days > 0 ? v.expiring_days : undefined,
      new_days: typeof v.new_days === "number" && v.new_days > 0 ? v.new_days : undefined,
      long_term_days: typeof v.long_term_days === "number" && v.long_term_days > 0 ? v.long_term_days : undefined,
      tag_ids: Array.isArray(v.tag_ids) ? v.tag_ids : undefined,
    };
  } catch {
    return {};
  }
}

export function parseCommExtras(raw: string): CommExtras {
  try {
    const v = JSON.parse(raw) as CommExtras;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function recipientStatusLabel(status: string) {
  if (status === "queued") return "Pending";
  if (status === "sent") return "Sent";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "sending") return "Sending";
  return status.replace(/_/g, " ");
}
