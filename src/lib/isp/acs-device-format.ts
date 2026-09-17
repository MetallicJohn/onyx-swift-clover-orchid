/** Client-safe helpers for the GenieACS Devices desk. No SQL, no Node APIs. */

export const ACS_DEVICE_SEARCH_MIN = 2;
export const ACS_DEVICE_SEARCH_LIMIT = 20;
export const ACS_DEVICE_PAGE_SIZE = 50;
export const ACS_FACTORY_RESET_PHRASE = "RESET";
export const ACS_WIFI_PASSWORD_MIN = 8;
export const ACS_WIFI_PASSWORD_MAX = 63;

export const ACS_DEVICE_TYPES = ["cpe", "onu", "router", "ap"] as const;
export type AcsDeviceType = (typeof ACS_DEVICE_TYPES)[number];

export const ACS_TASK_PHASES = [
  "pending",
  "queued",
  "waiting_for_inform",
  "applying",
  "applied",
  "verification_pending",
  "verified",
  "failed",
  "timed_out",
  "cancelled",
] as const;
export type AcsTaskPhase = (typeof ACS_TASK_PHASES)[number];

export type AcsOnlineFilter = "all" | "online" | "offline" | "unknown";
export type AcsAssignedFilter = "all" | "assigned" | "unassigned";

export type AcsDeviceFilters = {
  q: string;
  status: string;
  online: AcsOnlineFilter;
  assigned: AcsAssignedFilter;
  vendor: string;
  model: string;
  deviceType: string;
  customerId: string;
  serviceId: string;
  customer: string;
  service: string;
  location: string;
  page: number;
};

export type AcsDeviceRow = {
  id: string;
  serial: string;
  acs_device_id: string;
  manufacturer: string;
  model: string;
  product_class: string;
  manufacturer_oui: string;
  mac_address: string;
  ip_address: string;
  device_type: string;
  status: string;
  source: string;
  ssid: string;
  notes: string;
  hardware_version: string;
  software_version: string;
  vendor_profile: string;
  last_inform: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_account: string;
  customer_phone: string;
  service_id: string | null;
  service_account: string;
  access_method: string;
  package_name: string;
  service_status: string;
  assigned_at: string | null;
  assigned_by_label: string;
  last_task_status: string;
  last_task_error: string;
  last_optical_at: string | null;
  optical_rx: string;
  router_name: string;
  location: string;
};

export type AcsDeviceHit = {
  id: string;
  serial: string;
  acs_device_id: string;
  manufacturer: string;
  model: string;
  product_class: string;
  manufacturer_oui: string;
  mac_address: string;
  ip_address: string;
  status: string;
  last_inform: string | null;
  source: string;
  assigned: boolean;
  customer_name: string;
};

export type AcsAssignmentHit = {
  service_id: string;
  service_account: string;
  access_method: string;
  package_name: string;
  service_status: string;
  username: string;
  static_ip: string;
  customer_id: string;
  customer_name: string;
  customer_account: string;
  phone: string;
  email: string;
};

export type AcsDeviceActionId =
  | "view"
  | "parameters"
  | "refresh"
  | "inform"
  | "reboot"
  | "factory_reset"
  | "wifi"
  | "ssid"
  | "wifi_password"
  | "wifi_radio"
  | "wifi_24"
  | "wifi_5"
  | "channel"
  | "channel_width"
  | "wifi_mode"
  | "clients"
  | "wan"
  | "lan"
  | "optical"
  | "signal"
  | "uptime"
  | "firmware_info"
  | "firmware_upgrade"
  | "tasks"
  | "retry"
  | "assign"
  | "reassign"
  | "unassign"
  | "audit";

export type AcsDeviceAction = {
  id: AcsDeviceActionId;
  label: string;
  group: "device" | "wifi" | "network" | "optical" | "tasks" | "assignment";
  permission: string;
  supported: boolean;
  destructive?: boolean;
};

export function acsSearchReady(q: string) {
  return q.trim().length >= ACS_DEVICE_SEARCH_MIN;
}

export function deviceTypeLabel(type: string) {
  if (type === "onu") return "ONU / ONT";
  if (type === "router") return "Router";
  if (type === "ap") return "Access point";
  return "CPE";
}

export function inferDeviceType(productClass: string, manufacturer = ""): AcsDeviceType {
  const blob = `${productClass} ${manufacturer}`.toLowerCase();
  if (/\b(onu|ont|gpon|epon|xgpon)\b/.test(blob)) return "onu";
  if (/\b(ap|access.?point|extender)\b/.test(blob)) return "ap";
  if (/\b(router|gateway|zxhn|eg8)\b/.test(blob) || /\bhg\d/.test(blob) || /\bf6\d/.test(blob)) return "router";
  return "cpe";
}

export function assignmentStatus(serviceId?: string | null) {
  return serviceId ? "assigned" : "unassigned";
}

export function onlineLabel(status: string, lastInform?: string | null) {
  if (status === "online") return "Online";
  if (status === "offline") return "Offline";
  if (lastInform) return "Offline";
  return "Not confirmed";
}

export function taskPhaseLabel(phase: string, status?: string) {
  const p = (phase || status || "").toLowerCase();
  if (p === "pending") return "Pending";
  if (p === "queued") return "Queued";
  if (p === "waiting_for_inform" || p === "waiting_for_nbi") return "Waiting for Inform";
  if (p === "applying" || p === "sent") return "Applying";
  if (p === "applied") return "Applied";
  if (p === "verification_pending") return "Verification pending";
  if (p === "verified") return "Verified";
  if (p === "failed" || p === "error") return "Failed";
  if (p === "timed_out") return "Timed out";
  if (p === "cancelled") return "Cancelled";
  return phase || status || "Queued";
}

export function displayAcsPhone(raw: string) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("254")) return `0${digits.slice(3)}`;
  if (digits.length === 10 && digits.startsWith("0")) return digits;
  return String(raw || "").trim();
}

export function canSubmitAcsAssignment(opts: {
  deviceId?: string | null;
  serviceId?: string | null;
  customerId?: string | null;
  confirmed: boolean;
  busy?: boolean;
  needsMoveConfirm?: boolean;
  moveConfirmed?: boolean;
}) {
  if (opts.busy) return false;
  if (!opts.confirmed) return false;
  if (!String(opts.deviceId || "").trim()) return false;
  if (!String(opts.serviceId || "").trim()) return false;
  if (!String(opts.customerId || "").trim()) return false;
  if (opts.needsMoveConfirm && !opts.moveConfirmed) return false;
  return true;
}

export function canSubmitManualDevice(opts: { serial?: string; deviceId?: string }) {
  return Boolean(String(opts.serial || "").trim() || String(opts.deviceId || "").trim());
}

export function wifiPasswordValid(password: string, security: string) {
  const mode = (security || "wpa2").toLowerCase();
  const value = password || "";
  if (mode === "none" || mode === "open") return value.length === 0;
  return value.length >= ACS_WIFI_PASSWORD_MIN && value.length <= ACS_WIFI_PASSWORD_MAX;
}

export function maskSecret(raw: string) {
  if (!raw) return "";
  return "•".repeat(Math.min(12, Math.max(8, raw.length)));
}

export function factoryResetReady(phrase: string, confirmed: boolean) {
  return confirmed && phrase.trim().toUpperCase() === ACS_FACTORY_RESET_PHRASE;
}

export function emptyAcsFilters(): AcsDeviceFilters {
  return {
    q: "",
    status: "all",
    online: "all",
    assigned: "all",
    vendor: "",
    model: "",
    deviceType: "all",
    customerId: "",
    serviceId: "",
    customer: "",
    service: "",
    location: "",
    page: 1,
  };
}

export function deviceIdentity(row: { manufacturer?: string; model?: string; product_class?: string; serial: string }) {
  const make = [row.manufacturer, row.model || row.product_class].filter(Boolean).join(" ").trim();
  return make ? `${make} · ${row.serial}` : row.serial;
}

export function unsupportedActionMessage() {
  return "This action is not supported by this device model.";
}

export function opticalMissingMessage() {
  return "Optical information is not exposed by this device.";
}

export function wifiReviewRows(input: {
  ssid?: string;
  security?: string;
  enabled?: boolean;
  channel?: string;
  channelWidth?: string;
  mode?: string;
  band?: string;
  password?: string;
}) {
  return [
    { label: "Band", value: input.band === "5" ? "5 GHz" : input.band === "guest" ? "Guest" : "2.4 GHz" },
    { label: "SSID", value: input.ssid || "—" },
    { label: "Security", value: input.security || "—" },
    { label: "Password", value: input.password ? "••••••••" : "Unchanged" },
    { label: "Radio", value: input.enabled === false ? "Disabled" : input.enabled === true ? "Enabled" : "Unchanged" },
    { label: "Channel", value: input.channel || "—" },
    { label: "Channel width", value: input.channelWidth || "—" },
    { label: "Mode", value: input.mode || "—" },
  ];
}

export const ACS_DEVICE_ACTION_CATALOG: Array<Omit<AcsDeviceAction, "supported">> = [
  { id: "view", label: "View device details", group: "device", permission: "acs.devices.view" },
  { id: "parameters", label: "View device parameters", group: "device", permission: "acs.devices.view" },
  { id: "refresh", label: "Refresh device", group: "device", permission: "acs.devices.view" },
  { id: "inform", label: "Request Inform", group: "device", permission: "acs.devices.view" },
  { id: "reboot", label: "Reboot device", group: "device", permission: "acs.devices.reboot", destructive: true },
  { id: "factory_reset", label: "Factory reset", group: "device", permission: "acs.devices.factory_reset", destructive: true },
  { id: "wifi", label: "Change Wi-Fi settings", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "ssid", label: "Change SSID", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "wifi_password", label: "Change Wi-Fi password", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "wifi_radio", label: "Enable/disable Wi-Fi radio", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "wifi_24", label: "Configure 2.4 GHz Wi-Fi", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "wifi_5", label: "Configure 5 GHz Wi-Fi", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "channel", label: "Change channel", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "channel_width", label: "Change channel width", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "wifi_mode", label: "Change Wi-Fi mode", group: "wifi", permission: "acs.devices.wifi.manage" },
  { id: "clients", label: "View connected clients", group: "network", permission: "acs.devices.view" },
  { id: "wan", label: "View WAN information", group: "network", permission: "acs.devices.view" },
  { id: "lan", label: "View LAN information", group: "network", permission: "acs.devices.view" },
  { id: "optical", label: "View optical information", group: "optical", permission: "acs.devices.optical.view" },
  { id: "signal", label: "View signal levels", group: "optical", permission: "acs.devices.optical.view" },
  { id: "uptime", label: "View uptime", group: "device", permission: "acs.devices.view" },
  { id: "firmware_info", label: "View firmware information", group: "device", permission: "acs.devices.view" },
  { id: "firmware_upgrade", label: "Firmware upgrade", group: "device", permission: "acs.devices.firmware.manage", destructive: true },
  { id: "tasks", label: "View provisioning tasks", group: "tasks", permission: "acs.tasks.view" },
  { id: "retry", label: "Retry failed task", group: "tasks", permission: "acs.tasks.retry" },
  { id: "assign", label: "Assign device", group: "assignment", permission: "acs.devices.assign" },
  { id: "reassign", label: "Reassign device", group: "assignment", permission: "acs.devices.reassign" },
  { id: "unassign", label: "Unassign device", group: "assignment", permission: "acs.devices.assign" },
  { id: "audit", label: "View audit history", group: "assignment", permission: "acs.devices.view" },
];
