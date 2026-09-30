export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "coverage_check",
  "installation_pending",
  "installation_scheduled",
  "installation_completed",
  "confirmed",
  "converted",
  "lost",
  "cancelled",
  "duplicate",
  "not_interested",
  "outside_coverage",
] as const;

export const COVERAGE_STATUSES = ["unknown", "covered", "potentially_covered", "requires_survey", "outside_coverage"] as const;
export const INSTALL_STATUSES = ["not_scheduled", "scheduled", "in_progress", "completed", "failed", "cancelled"] as const;
export const LEAD_TYPES = ["individual", "business"] as const;
export const CONTACT_METHODS = ["phone", "whatsapp", "sms", "email"] as const;
export const ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "SMS",
  "WHATSAPP",
  "EMAIL",
  "MEETING",
  "COVERAGE_CHECK",
  "SITE_SURVEY",
  "INSTALLATION",
  "FOLLOW_UP",
  "STATUS_CHANGE",
  "CONVERSION",
] as const;

export const DEFAULT_LEAD_SOURCES = [
  "Website",
  "WhatsApp",
  "Facebook",
  "Instagram",
  "Phone Call",
  "Walk-in",
  "Referral",
  "Field Marketing",
  "Existing Customer Referral",
  "Reseller",
  "Other",
];

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
export type InstallStatus = (typeof INSTALL_STATUSES)[number];
export type LeadActivityType = (typeof ACTIVITY_TYPES)[number];

export type LeadInput = {
  name: string;
  phone: string;
  alternative_phone?: string;
  email?: string;
  identifier?: string;
  lead_source?: string;
  lead_type?: string;
  interested_package_id?: string;
  interested_service_type?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  county?: string;
  town?: string;
  area?: string;
  building?: string;
  physical_address?: string;
  location_notes?: string;
  preferred_contact_method?: string;
  assigned_to?: string;
  notes?: string;
};

export function parseLatitude(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < -90 || n > 90) throw new Error("Latitude must be between -90 and 90");
  return Math.round(n * 1e6) / 1e6;
}

export function parseLongitude(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < -180 || n > 180) throw new Error("Longitude must be between -180 and 180");
  return Math.round(n * 1e6) / 1e6;
}

export function leadStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}
