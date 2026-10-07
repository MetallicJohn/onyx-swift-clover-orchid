/** Settings information architecture. Maps current and legacy tab ids. UI only. */

export const SETTINGS_PAGES = [
  { id: "general", label: "General" },
  { id: "communications", label: "Communications" },
  { id: "notifications", label: "Notifications" },
  { id: "payments", label: "Payments" },
  { id: "network", label: "Network" },
  { id: "staff", label: "Staff" },
  { id: "customers", label: "Customers" },
  { id: "plan", label: "Plan" },
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];

export type SettingsSearch = {
  tab?: SettingsPageId;
  section?: string;
};

const PAGE_SECTIONS: Partial<Record<SettingsPageId, readonly string[]>> = {
  general: ["company", "appearance"],
  payments: ["gateways", "grace", "partial"],
  customers: ["ids", "numbers", "tags"],
  network: ["hub", "publish"],
};

/** Legacy `?tab=` values stay valid so existing links still open the right place. */
const LEGACY: Record<string, { tab: SettingsPageId; section?: string }> = {
  general: { tab: "general", section: "company" },
  company: { tab: "general", section: "company" },
  appearance: { tab: "general", section: "appearance" },
  communications: { tab: "communications" },
  sms: { tab: "communications" },
  notifications: { tab: "notifications" },
  payments: { tab: "payments", section: "gateways" },
  payment: { tab: "payments", section: "gateways" },
  grace: { tab: "payments", section: "grace" },
  partial: { tab: "payments", section: "partial" },
  network: { tab: "network", section: "hub" },
  staff: { tab: "staff" },
  customers: { tab: "customers", section: "ids" },
  tags: { tab: "customers", section: "tags" },
  accounts: { tab: "customers", section: "ids" },
  numbers: { tab: "customers", section: "numbers" },
  "account-numbers": { tab: "customers", section: "numbers" },
  plan: { tab: "plan" },
};

export function isSettingsPage(value: string): value is SettingsPageId {
  return SETTINGS_PAGES.some((page) => page.id === value);
}

export function defaultSettingsSection(tab: SettingsPageId) {
  return PAGE_SECTIONS[tab]?.[0];
}

export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const rawTab = typeof search.tab === "string" ? search.tab : "";
  const rawSection = typeof search.section === "string" ? search.section : undefined;
  // `/app/settings/customers?section=numbers` has no tab. The parent route still
  // validates search first and must not rewrite that section back to Company.
  if (!rawTab) {
    if (rawSection && LEGACY[rawSection]) return LEGACY[rawSection];
    if (rawSection) return { section: rawSection };
    return { tab: "general", section: "company" };
  }
  const mapped = LEGACY[rawTab] ?? { tab: "general" as const, section: "company" };
  const options = PAGE_SECTIONS[mapped.tab];
  if (!options) return { tab: mapped.tab };
  const wanted = rawSection || mapped.section;
  const section = wanted && options.includes(wanted) ? wanted : options[0];
  return { tab: mapped.tab, section };
}

export function sectionForPage(tab: SettingsPageId, raw: unknown) {
  const options = PAGE_SECTIONS[tab];
  if (!options) return undefined;
  const wanted = typeof raw === "string" ? raw : undefined;
  return wanted && options.includes(wanted) ? wanted : options[0];
}

/** `/app/settings/payments` → `payments`. Unknown segments are ignored. */
export function settingsPageFromPath(pathname: string): SettingsPageId | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts[1] !== "settings" || !parts[2]) return null;
  return isSettingsPage(parts[2]) ? parts[2] : null;
}
