export type AcsNbiConfig = {
  nbiUrl: string;
  user: string;
  pass: string;
  oui: string;
  timeoutMs?: number;
};

export type NbiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function genieDeviceId(oui: string, productClass: string, serial: string) {
  const o = (oui || "000000").replace(/[^0-9A-Fa-f]/g, "").toUpperCase().padStart(6, "0").slice(-6);
  const pc = (productClass || "Router").replace(/[^\w.-]+/g, "") || "Router";
  const sn = (serial || "").trim();
  return `${o}-${pc}-${sn}`;
}

export function nbiTaskBody(
  kind: string,
  payload: {
    ssid?: string;
    objectName?: string;
    parameterValues?: Array<[string, string, string]>;
    parameterNames?: string[];
    file?: string;
    fileType?: string;
  } = {},
) {
  if (kind === "reboot") return { name: "reboot" };
  if (kind === "factoryReset") return { name: "factoryReset" };
  if (kind === "requestInform" || kind === "refresh") {
    return { name: "refreshObject", objectName: payload.objectName || "InternetGatewayDevice.DeviceInfo." };
  }
  if (kind === "getParameters" || kind === "getOptical") {
    const names = payload.parameterNames || [];
    if (!names.length) throw new Error("Parameter names are required");
    return { name: "getParameterValues", parameterNames: names };
  }
  if (kind === "setWifi") {
    const values = payload.parameterValues || [];
    if (!values.length) throw new Error("Wi-Fi parameters are required");
    return { name: "setParameterValues", parameterValues: values };
  }
  if (kind === "firmwareUpgrade") {
    throw new Error("Firmware file server is not configured");
  }
  if (kind === "setSsid") {
    const ssid = (payload.ssid || "").trim();
    if (!ssid) throw new Error("SSID is required");
    return {
      name: "setParameterValues",
      parameterValues: [
        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", ssid, "xsd:string"],
        ["Device.WiFi.SSID.1.SSID", ssid, "xsd:string"],
      ],
    };
  }
  throw new Error("Unknown ACS task");
}

export function serialFromGenieDevice(doc: Record<string, unknown>) {
  const did = doc._deviceId as Record<string, unknown> | undefined;
  if (did?._SerialNumber) return String(did._SerialNumber);
  const id = String(doc._id || "");
  const parts = id.split("-");
  if (parts.length >= 3) return parts.slice(2).join("-");
  return id;
}

export function productClassFromGenieDevice(doc: Record<string, unknown>) {
  const did = doc._deviceId as Record<string, unknown> | undefined;
  if (did?._ProductClass) return String(did._ProductClass);
  const id = String(doc._id || "");
  const parts = id.split("-");
  return parts[1] || "Router";
}

export function ouiFromGenieDevice(doc: Record<string, unknown>) {
  const did = doc._deviceId as Record<string, unknown> | undefined;
  if (did?._OUI) return String(did._OUI);
  const id = String(doc._id || "");
  return (id.split("-")[0] || "").toUpperCase();
}

export function lastInformFromGenieDevice(doc: Record<string, unknown>) {
  const raw = doc._lastInform;
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "string" && raw) return raw;
  return "";
}

export function nestedParam(doc: Record<string, unknown>, path: string) {
  const parts = path.split(".");
  let cur: unknown = doc;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  if (cur && typeof cur === "object" && cur !== null && "_value" in cur) {
    return String((cur as { _value?: unknown })._value ?? "");
  }
  if (typeof cur === "string" || typeof cur === "number") return String(cur);
  return "";
}

export function acsUsernameFromGenieDevice(doc: Record<string, unknown>) {
  return (
    nestedParam(doc, "InternetGatewayDevice.ManagementServer.Username") ||
    nestedParam(doc, "Device.ManagementServer.Username") ||
    ""
  );
}

export function genieDeviceTags(doc: Record<string, unknown>) {
  const tags = doc._tags;
  if (!Array.isArray(tags)) return [] as string[];
  return tags.map((t) => String(t));
}


export function informStatus(lastInformIso: string, now = Date.now()) {
  if (!lastInformIso) return "unknown";
  const t = Date.parse(lastInformIso);
  if (Number.isNaN(t)) return "unknown";
  return now - t < 60 * 60 * 1000 ? "online" : "offline";
}

function authHeaders(cfg: AcsNbiConfig): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (cfg.user) {
    headers.authorization = `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`;
  }
  return headers;
}

export function nbiOrigin(cfg: AcsNbiConfig) {
  return (cfg.nbiUrl || "").trim().replace(/\/+$/, "");
}

export async function nbiRequest(
  cfg: AcsNbiConfig,
  path: string,
  init: RequestInit = {},
  fetchImpl: NbiFetch = fetch,
) {
  const base = nbiOrigin(cfg);
  if (!base) throw new Error("GenieACS NBI URL is not set");
  const headers = { ...authHeaders(cfg), ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const timeoutMs = cfg.timeoutMs && cfg.timeoutMs > 0 ? cfg.timeoutMs : 8000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort();
    else init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function nbiPing(cfg: AcsNbiConfig, fetchImpl: NbiFetch = fetch) {
  try {
    const r = await nbiRequest(cfg, "/devices/?limit=1", { method: "GET" }, fetchImpl);
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function nbiListDevices(cfg: AcsNbiConfig, fetchImpl: NbiFetch = fetch) {
  const r = await nbiRequest(cfg, "/devices/", { method: "GET" }, fetchImpl);
  if (!r.ok) throw new Error(`GenieACS NBI list failed (${r.status})`);
  return Array.isArray(r.json) ? (r.json as Record<string, unknown>[]) : [];
}

export async function nbiPostTask(
  cfg: AcsNbiConfig,
  deviceId: string,
  body: Record<string, unknown>,
  fetchImpl: NbiFetch = fetch,
) {
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks?timeout=8000&connection_request`;
  const r = await nbiRequest(cfg, path, { method: "POST", body: JSON.stringify(body) }, fetchImpl);
  const doc = r.json && typeof r.json === "object" ? (r.json as Record<string, unknown>) : {};
  const taskId = String(doc._id || doc.id || "");
  return { ok: r.ok, status: r.status, taskId, json: doc, text: r.text };
}

export function manufacturerFromGenieDevice(doc: Record<string, unknown>) {
  const did = doc._deviceId as Record<string, unknown> | undefined;
  if (did?._Manufacturer) return String(did._Manufacturer);
  return (
    nestedParam(doc, "InternetGatewayDevice.DeviceInfo.Manufacturer") ||
    nestedParam(doc, "Device.DeviceInfo.Manufacturer") ||
    ""
  );
}

export function modelFromGenieDevice(doc: Record<string, unknown>) {
  return (
    nestedParam(doc, "InternetGatewayDevice.DeviceInfo.ModelName") ||
    nestedParam(doc, "Device.DeviceInfo.ModelName") ||
    productClassFromGenieDevice(doc)
  );
}

export function macFromGenieDevice(doc: Record<string, unknown>) {
  return (
    nestedParam(doc, "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress") ||
    nestedParam(doc, "Device.Ethernet.Interface.1.MACAddress") ||
    nestedParam(doc, "Device.WiFi.SSID.1.MACAddress") ||
    ""
  );
}

export function ipFromGenieDevice(doc: Record<string, unknown>) {
  return (
    nestedParam(doc, "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress") ||
    nestedParam(doc, "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress") ||
    nestedParam(doc, "Device.IP.Interface.1.IPv4Address.1.IPAddress") ||
    nestedParam(doc, "Device.PPP.Interface.1.IPCP.LocalIPAddress") ||
    ""
  );
}

export function softwareFromGenieDevice(doc: Record<string, unknown>) {
  return (
    nestedParam(doc, "InternetGatewayDevice.DeviceInfo.SoftwareVersion") ||
    nestedParam(doc, "Device.DeviceInfo.SoftwareVersion") ||
    ""
  );
}

export function hardwareFromGenieDevice(doc: Record<string, unknown>) {
  return (
    nestedParam(doc, "InternetGatewayDevice.DeviceInfo.HardwareVersion") ||
    nestedParam(doc, "Device.DeviceInfo.HardwareVersion") ||
    ""
  );
}

export function uptimeFromGenieDevice(doc: Record<string, unknown>) {
  return (
    nestedParam(doc, "InternetGatewayDevice.DeviceInfo.UpTime") ||
    nestedParam(doc, "Device.DeviceInfo.UpTime") ||
    ""
  );
}

export function treeFromGenieDevice(doc: Record<string, unknown>): "InternetGatewayDevice" | "Device" {
  if (doc.InternetGatewayDevice) return "InternetGatewayDevice";
  if (doc.Device) return "Device";
  const id = String(doc._id || "");
  if (id.includes("Device")) return "Device";
  return "InternetGatewayDevice";
}

export function factsFromGenieDevice(doc: Record<string, unknown>) {
  const serial = serialFromGenieDevice(doc).trim();
  const product = productClassFromGenieDevice(doc);
  const oui = ouiFromGenieDevice(doc);
  const manufacturer = manufacturerFromGenieDevice(doc);
  const model = modelFromGenieDevice(doc);
  const last = lastInformFromGenieDevice(doc);
  return {
    serial,
    product_class: product,
    manufacturer_oui: oui,
    manufacturer,
    model,
    mac_address: macFromGenieDevice(doc),
    ip_address: ipFromGenieDevice(doc),
    hardware_version: hardwareFromGenieDevice(doc),
    software_version: softwareFromGenieDevice(doc),
    uptime: uptimeFromGenieDevice(doc),
    acs_device_id: String(doc._id || ""),
    last_inform: last,
    status: informStatus(last),
    tree: treeFromGenieDevice(doc),
    acs_username: acsUsernameFromGenieDevice(doc),
  };
}

export async function nbiGetDevice(cfg: AcsNbiConfig, deviceId: string, fetchImpl: NbiFetch = fetch) {
  const query = encodeURIComponent(JSON.stringify({ _id: deviceId }));
  const r = await nbiRequest(cfg, `/devices/?query=${query}`, { method: "GET" }, fetchImpl);
  if (!r.ok) throw new Error(`GenieACS NBI get failed (${r.status})`);
  const rows = Array.isArray(r.json) ? (r.json as Record<string, unknown>[]) : [];
  return rows[0] ?? null;
}

export async function nbiListDeviceTasks(cfg: AcsNbiConfig, deviceId: string, fetchImpl: NbiFetch = fetch) {
  const query = encodeURIComponent(JSON.stringify({ device: deviceId }));
  const r = await nbiRequest(cfg, `/tasks/?query=${query}`, { method: "GET" }, fetchImpl);
  if (!r.ok) return [];
  return Array.isArray(r.json) ? (r.json as Record<string, unknown>[]) : [];
}
