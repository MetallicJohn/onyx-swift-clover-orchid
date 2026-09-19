/** Public WireGuard endpoint for generated RouterOS peers. Never an apex HTTPS host, never a hard-coded VPS IP. */
import { isProductionRuntime, parseIntEnv } from "./runtime-config.ts";

export const WG_DEFAULT_PUBLIC_HOST = "wg.ispsolutions.co.ke";
export const WG_DEFAULT_PUBLIC_PORT = 51820;
export const WG_DEFAULT_HUB_ADDRESS = "10.200.0.1";
export const WG_DEFAULT_NETWORK = "10.200.0.0/24";
export const WG_HUB_ALLOWED = "10.200.0.1/32";

const APEX = new Set(["ispsolutions.co.ke", "www.ispsolutions.co.ke"]);
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

export function normalizeWgPublicHost(host: string) {
  const raw = (host || "").trim().replace(/\.$/, "");
  if (!raw) return "";
  let h = raw;
  try {
    if (h.includes("://")) h = new URL(h).hostname;
  } catch {
    /* keep */
  }
  h = h.replace(/\/.*$/, "").replace(/^\[|\]$/g, "");
  if (!IPV4.test(h) && h.includes(":")) h = h.split(":")[0] || h;
  const lower = h.toLowerCase();
  if (APEX.has(lower)) return WG_DEFAULT_PUBLIC_HOST;
  return h;
}

export function publicWgHost(env: NodeJS.ProcessEnv = process.env) {
  const configured = normalizeWgPublicHost(env.WIREGUARD_PUBLIC_HOST || "");
  if (configured) return configured;
  if (isProductionRuntime(env)) return WG_DEFAULT_PUBLIC_HOST;
  return "";
}

export function publicWgPort(env: NodeJS.ProcessEnv = process.env) {
  return parseIntEnv(env.WIREGUARD_PUBLIC_PORT || "", WG_DEFAULT_PUBLIC_PORT, 1, 65535);
}

export function publicWgHubAddress(env: NodeJS.ProcessEnv = process.env) {
  const v = (env.WIREGUARD_HUB_ADDRESS || "").trim().replace(/\/\d+$/, "");
  return v || WG_DEFAULT_HUB_ADDRESS;
}

export function publicWgNetwork(env: NodeJS.ProcessEnv = process.env) {
  return (env.WIREGUARD_NETWORK || "").trim() || WG_DEFAULT_NETWORK;
}

export function enrollEndpointHost(tenantHost: string, env: NodeJS.ProcessEnv = process.env) {
  const publicHost = publicWgHost(env);
  const normalized = normalizeWgPublicHost(tenantHost);
  if (IPV4.test(normalized) && publicHost) return publicHost;
  return normalized || publicHost;
}

export function isApexHttpsHost(host: string) {
  return APEX.has((host || "").trim().toLowerCase());
}
