export type AcsNbiConfig = {
  nbiUrl: string;
  user: string;
  pass: string;
  oui: string;
};

export type NbiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function genieDeviceId(oui: string, productClass: string, serial: string) {
  const o = (oui || "000000").replace(/[^0-9A-Fa-f]/g, "").toUpperCase().padStart(6, "0").slice(-6);
  const pc = (productClass || "Router").replace(/[^\w.-]+/g, "") || "Router";
  const sn = (serial || "").trim();
  return `${o}-${pc}-${sn}`;
}

export function nbiTaskBody(kind: string, payload: { ssid?: string } = {}) {
  if (kind === "reboot") return { name: "reboot" };
  if (kind === "refresh") {
    return { name: "refreshObject", objectName: "InternetGatewayDevice.DeviceInfo." };
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
  const res = await fetchImpl(`${base}${path}`, { ...init, headers });
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
