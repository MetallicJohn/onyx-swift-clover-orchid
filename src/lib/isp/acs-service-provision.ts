import { ACS_WIFI_PASSWORD_MAX, ACS_WIFI_PASSWORD_MIN, wifiPasswordValid } from "./acs-device-format.ts";
import { generatePppoePassword } from "./pppoe-credentials.ts";
import { open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const SERVICE_PROVISION = "ispsolutions-service";
export const SERVICE_PRESET = "ispsolutions-service";

export const SERVICE_PROVISION_SCRIPT = `const now = Date.now();
const serialDecl = declare("DeviceID.SerialNumber", {value: 1});
const serial = String((serialDecl.value && serialDecl.value[0]) || "");
const igdUser = declare("InternetGatewayDevice.ManagementServer.Username", {value: 1});
const devUser = declare("Device.ManagementServer.Username", {value: 1});
const username = String((igdUser.value && igdUser.value[0]) || (devUser.value && devUser.value[0]) || "");
const raw = ext("ispsolutions", "serviceFor", username, serial);
let p = {wan_username: "", wan_password: "", ssid: "", wifi_password: ""};
try { p = JSON.parse(raw || "{}"); } catch (e) { p = {wan_username: "", wan_password: "", ssid: "", wifi_password: ""}; }
if (p && p.wan_username && p.wan_password) {
  declare("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username", {value: now}).value = [now, p.wan_username];
  declare("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password", {value: now}).value = [now, p.wan_password];
  declare("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", {value: now}).value = [now, true];
  declare("Device.PPP.Interface.1.Username", {value: now}).value = [now, p.wan_username];
  declare("Device.PPP.Interface.1.Password", {value: now}).value = [now, p.wan_password];
  declare("Device.PPP.Interface.1.Enable", {value: now}).value = [now, true];
}
if (p && p.ssid) {
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", {value: now}).value = [now, p.ssid];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID", {value: now}).value = [now, p.ssid];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", {value: now}).value = [now, p.ssid];
  declare("Device.WiFi.SSID.1.SSID", {value: now}).value = [now, p.ssid];
  declare("Device.WiFi.SSID.2.SSID", {value: now}).value = [now, p.ssid];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable", {value: now}).value = [now, true];
  declare("Device.WiFi.SSID.1.Enable", {value: now}).value = [now, true];
  declare("Device.WiFi.Radio.1.Enable", {value: now}).value = [now, true];
}
if (p && p.wifi_password) {
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("Device.WiFi.AccessPoint.1.Security.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
  declare("Device.WiFi.AccessPoint.2.Security.KeyPassphrase", {value: now}).value = [now, p.wifi_password];
}
`;

export type AcsServiceProfile = {
  ok: true;
  assigned: boolean;
  wan_username: string;
  wan_password: string;
  ssid: string;
  wifi_password: string;
} | { ok: false };

function dummyWork() {
  open(seal("ispsolutions-acs-service-dummy"));
}

export function sanitizeWifiSsid(raw: string) {
  return String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

export function suggestServiceSsid(input: { customerName?: string; accountNumber?: string }) {
  const name = sanitizeWifiSsid((input.customerName || "").split(/\s+/)[0] || "");
  const acct = String(input.accountNumber || "").replace(/[^A-Za-z0-9]/g, "").slice(-4);
  const base = [name, acct].filter(Boolean).join("-") || "WiFi";
  return sanitizeWifiSsid(base) || "WiFi";
}

export function generateWifiPassword() {
  return generatePppoePassword();
}

export function serviceWifiReady(ssid: string, password: string) {
  const name = sanitizeWifiSsid(ssid);
  if (!name) return false;
  return wifiPasswordValid(password, "wpa2");
}

export type EnsureServiceWifiOpts = {
  ssid?: string;
  password?: string;
  customerName?: string;
  accountNumber?: string;
  rotate?: boolean;
};

export async function ensureServiceWifi(sql: Sql, tenantId: string, serviceId: string, opts: EnsureServiceWifiOpts = {}) {
  const [row] = await sql<{
    wifi_ssid: string;
    wifi_password_ref: string;
    customer_name: string;
    account_number: string;
  }>`select coalesce(s.wifi_ssid,'') as wifi_ssid, coalesce(s.wifi_password_ref,'') as wifi_password_ref,
            coalesce(c.name,'') as customer_name, coalesce(s.account_number,'') as account_number
     from services s join customers c on c.id = s.customer_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId} and s.deleted_at is null`;
  if (!row) throw new Error("Service not found");
  const existingPass = open(row.wifi_password_ref || "");
  const wantedSsid = sanitizeWifiSsid(opts.ssid || "");
  const wantedPass = String(opts.password || "").trim();
  if (wantedPass && !wifiPasswordValid(wantedPass, "wpa2")) {
    throw new Error(`Wi-Fi password must be ${ACS_WIFI_PASSWORD_MIN}–${ACS_WIFI_PASSWORD_MAX} characters`);
  }
  const ssid =
    wantedSsid ||
    sanitizeWifiSsid(row.wifi_ssid) ||
    suggestServiceSsid({
      customerName: opts.customerName || row.customer_name,
      accountNumber: opts.accountNumber || row.account_number,
    });
  let password = wantedPass;
  if (!password && existingPass && !opts.rotate) password = existingPass;
  if (!password) password = generateWifiPassword();
  const same = sanitizeWifiSsid(row.wifi_ssid) === ssid && existingPass === password;
  if (!same) {
    await sql`update services set wifi_ssid = ${ssid}, wifi_password_ref = ${seal(password)}
      where id = ${serviceId} and tenant_id = ${tenantId}`;
  }
  return { ssid, password, generated: !wantedSsid || !wantedPass };
}

export async function saveServiceWifi(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  patch: { ssid?: string; password?: string },
) {
  const ssid = patch.ssid != null ? sanitizeWifiSsid(patch.ssid) : undefined;
  const password = patch.password != null ? String(patch.password) : undefined;
  if (password && !wifiPasswordValid(password, "wpa2")) {
    throw new Error(`Wi-Fi password must be ${ACS_WIFI_PASSWORD_MIN}–${ACS_WIFI_PASSWORD_MAX} characters`);
  }
  if (ssid != null && password != null) {
    await sql`update services set wifi_ssid = ${ssid}, wifi_password_ref = ${seal(password)}
      where id = ${serviceId} and tenant_id = ${tenantId}`;
    return;
  }
  if (ssid != null) {
    await sql`update services set wifi_ssid = ${ssid} where id = ${serviceId} and tenant_id = ${tenantId}`;
  }
  if (password != null) {
    await sql`update services set wifi_password_ref = ${seal(password)} where id = ${serviceId} and tenant_id = ${tenantId}`;
  }
}

export async function lookupAcsServiceProfile(sql: Sql, username: string, serial: string): Promise<AcsServiceProfile> {
  const user = (username || "").trim();
  const sn = (serial || "").trim().slice(0, 64);
  if (!user || user.length > 80 || !sn) {
    dummyWork();
    return { ok: false };
  }
  const [creds] = await sql<{ tenant_id: string; enabled: boolean }>`
    select tenant_id, enabled from acs_isp_credentials where username = ${user}`;
  if (!creds || creds.enabled === false) {
    dummyWork();
    return { ok: false };
  }
  const [cpe] = await sql<{
    service_id: string | null;
    access_method: string;
    wan_username: string;
    wan_password_ref: string;
    wifi_ssid: string;
    wifi_password_ref: string;
  }>`select d.service_id, coalesce(s.access_method,'') as access_method,
            coalesce(ra.username, s.username, '') as wan_username,
            coalesce(ra.password, '') as wan_password_ref,
            coalesce(s.wifi_ssid,'') as wifi_ssid,
            coalesce(s.wifi_password_ref,'') as wifi_password_ref
     from cpe_devices d
     left join services s on s.id = d.service_id and s.tenant_id = d.tenant_id and s.deleted_at is null
     left join radius_accounts ra on ra.service_id = d.service_id and ra.tenant_id = d.tenant_id
     where d.tenant_id = ${creds.tenant_id} and d.serial = ${sn}`;
  if (!cpe || !cpe.service_id) {
    dummyWork();
    return { ok: true, assigned: false, wan_username: "", wan_password: "", ssid: "", wifi_password: "" };
  }
  const pppoe = cpe.access_method === "pppoe";
  const wanUser = pppoe ? (cpe.wan_username || "").trim() : "";
  const wanPass = pppoe ? open(cpe.wan_password_ref || "") : "";
  const ssid = sanitizeWifiSsid(cpe.wifi_ssid);
  const wifiPass = open(cpe.wifi_password_ref || "");
  return {
    ok: true,
    assigned: true,
    wan_username: wanUser && wanPass ? wanUser : "",
    wan_password: wanUser && wanPass ? wanPass : "",
    ssid,
    wifi_password: ssid && wifiPasswordValid(wifiPass, "wpa2") ? wifiPass : "",
  };
}
