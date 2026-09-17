/** Client-safe public-domain helpers. No SQL, no Node APIs, no invented hostnames. */

export const DOMAIN_PURPOSES = [
  "router_bootstrap",
  "customer_portal",
  "acs_endpoint",
  "public_api",
  "email_links",
  "sms_links",
  "payment_links",
] as const;
export type DomainPurpose = (typeof DOMAIN_PURPOSES)[number];

export const DOMAIN_KINDS = ["system", "subdomain", "custom"] as const;
export type DomainKind = (typeof DOMAIN_KINDS)[number];

export const DOMAIN_SOURCES = ["custom", "subdomain", "central", "legacy"] as const;
export type DomainSource = (typeof DOMAIN_SOURCES)[number];

export const DOMAIN_STATUSES = [
  "pending",
  "dns_required",
  "dns_verified",
  "https_required",
  "https_verified",
  "active",
  "dns_failed",
  "https_failed",
  "cert_expired",
  "conflict",
  "revoked",
  "disabled",
] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const DNS_STATUSES = ["pending", "verified", "failed"] as const;
export type DnsStatus = (typeof DNS_STATUSES)[number];

export const HTTPS_STATUSES = ["pending", "verified", "failed", "expired"] as const;
export type HttpsStatus = (typeof HTTPS_STATUSES)[number];

export const RESERVED_SUBDOMAIN_LABELS = new Set([
  "www",
  "admin",
  "api",
  "app",
  "platform",
  "mail",
  "support",
  "status",
  "portal",
  "login",
  "ftp",
  "staging",
  "dev",
  "console",
  "acs",
  "radius",
  "billing",
  "cdn",
  "static",
  "assets",
  "ns1",
  "ns2",
  "smtp",
  "imap",
  "root",
  "superadmin",
  "saas",
]);

const DOCKER_SHORT_HOSTS = new Set([
  "postgres",
  "postgresql",
  "redis",
  "mongodb",
  "mongo",
  "genieacs",
  "radius",
  "freeradius",
  "caddy",
  "traefik",
  "nginx",
  "app",
  "web",
  "api",
  "worker",
  "collector",
  "db",
  "cache",
  "nbi",
  "cwmp",
  "rabbitmq",
  "minio",
  "clickhouse",
]);

const PLACEHOLDER_HOSTS = new Set([
  "your-public-url",
  "example.com",
  "example.org",
  "example.net",
  "example.invalid",
  "invalid",
]);

const INTERNAL_TLDS = new Set(["local", "localhost", "internal", "lan", "home", "corp", "localdomain"]);

export const MISSING_PUBLIC_DOMAIN =
  "No valid public HTTPS domain is configured. Configure and verify the application domain before generating a router bootstrap script.";

export const MISSING_PUBLIC_DOMAIN_GENERIC = "No public domain is configured for this system.";

export const ROUTER_DOMAIN_REQUIRED = "A public domain is required before this router can be provisioned.";

export const UNVERIFIED_SUBDOMAIN_WARNING =
  "The tenant subdomain is not verified. The central application domain is being used.";

export const TXT_VERIFICATION_PREFIX = "_isp-solutions-verification";

const HOST_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const SLUG_RE = /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export type DomainRowLike = {
  tenant_id?: string;
  hostname: string;
  kind: string;
  domain_status: string;
  dns_status: string;
  https_status: string;
  is_primary?: boolean;
  is_active: boolean;
  is_verified: boolean;
  certificate_expires_at?: string | null;
};

export type ParsedOrigin = {
  origin: string;
  hostname: string;
  protocol: "http:" | "https:";
  port: string;
};

export function normalizeHostname(raw: string) {
  const trimmed = (raw || "").trim().toLowerCase();
  if (!trimmed) return "";
  let host = trimmed;
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      host = host.replace(/^https?:\/\//, "").split("/")[0] || "";
    }
  } else {
    host = host.split("/")[0] || "";
  }
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    host = end >= 0 ? host.slice(1, end) : host;
  } else {
    host = host.split(":")[0] || "";
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

export function parsePublicOrigin(raw: string): ParsedOrigin | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = normalizeHostname(url.hostname);
    if (!hostname) return null;
    return {
      origin: url.origin.replace(/\/$/, ""),
      hostname,
      protocol: url.protocol as "http:" | "https:",
      port: url.port,
    };
  } catch {
    return null;
  }
}

export function originFromHostname(hostname: string, https = true) {
  const host = normalizeHostname(hostname);
  if (!host) return "";
  return `${https ? "https" : "http"}://${host}`;
}

export function defaultPathForPurpose(purpose: DomainPurpose) {
  switch (purpose) {
    case "customer_portal":
    case "sms_links":
    case "email_links":
      return "/portal";
    case "payment_links":
      return "/portal/pay";
    default:
      return "";
  }
}

export function joinPublicUrl(origin: string, path = "") {
  const root = (origin || "").replace(/\/$/, "");
  if (!root) return "";
  if (!path) return root;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${root}${p}`;
}

export function bootstrapPath(token: string) {
  return `/api/vpn/routers/${encodeURIComponent(token)}/bootstrap.rsc`;
}

export function bootstrapUrl(origin: string, token: string) {
  return joinPublicUrl(origin, bootstrapPath(token));
}

export function isIpv4Address(host: string) {
  if (!IPV4_RE.test(host)) return false;
  return host.split(".").every((o) => {
    const n = Number(o);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function isLoopbackHostname(host: string) {
  const h = normalizeHostname(host);
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0" || h === "[::1]";
}

export function isPrivateIpv4(host: string) {
  if (!isIpv4Address(host)) return false;
  const [a, b] = host.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isPrivateIpv6(host: string) {
  const h = host.toLowerCase();
  if (h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("fe80")) return true;
  return false;
}

export function isDockerOrInternalHostname(host: string) {
  const h = normalizeHostname(host);
  if (!h) return false;
  if (!h.includes(".") && DOCKER_SHORT_HOSTS.has(h)) return true;
  const tld = h.split(".").pop() || "";
  return INTERNAL_TLDS.has(tld);
}

export function isPlaceholderHostname(host: string) {
  const h = normalizeHostname(host);
  if (!h) return true;
  if (PLACEHOLDER_HOSTS.has(h)) return true;
  if (h.includes("your-public-url")) return true;
  if (h.includes("{{") || h.includes("}}")) return true;
  return false;
}

export function isInternalHostname(host: string) {
  const h = normalizeHostname(host);
  if (!h) return true;
  if (isLoopbackHostname(h)) return true;
  if (isPrivateIpv4(h) || isPrivateIpv6(h)) return true;
  if (isDockerOrInternalHostname(h)) return true;
  if (isPlaceholderHostname(h)) return true;
  return false;
}

export function isValidHostname(host: string) {
  const h = normalizeHostname(host);
  if (!h) return false;
  if (isIpv4Address(h)) return true;
  return HOST_RE.test(h);
}

export function isValidPublicHostname(host: string, opts: { allowLoopback?: boolean } = {}) {
  const h = normalizeHostname(host);
  if (!h || !isValidHostname(h)) return false;
  if (isPlaceholderHostname(h)) return false;
  if (opts.allowLoopback && isLoopbackHostname(h)) return true;
  if (isInternalHostname(h)) return false;
  return true;
}

export function isValidSlug(raw: string) {
  const s = (raw || "").trim();
  if (!s || s !== s.toLowerCase()) return false;
  if (!SLUG_RE.test(s)) return false;
  if (RESERVED_SUBDOMAIN_LABELS.has(s)) return false;
  return true;
}

export function reservedSlugReason(raw: string) {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "Enter a tenant slug";
  if (/[A-Z]/.test(raw.trim()) || /\s/.test(raw) || /[/:?#]/.test(raw) || raw.includes("://")) {
    return "Slug must be lowercase letters, numbers, and hyphens only";
  }
  if (!SLUG_RE.test(s)) return "Slug must be lowercase letters, numbers, and hyphens only";
  if (RESERVED_SUBDOMAIN_LABELS.has(s)) return `"${s}" is a reserved subdomain`;
  return "";
}

export function subdomainHostname(slug: string, base: string) {
  const s = (slug || "").trim().toLowerCase();
  const b = normalizeHostname(base);
  if (!s || !b) return "";
  return `${s}.${b}`;
}

export function isCertExpired(expiresAt: string | null | undefined, now = Date.now()) {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= now;
}

export function isDomainUsable(row: DomainRowLike, now = Date.now()) {
  if (!row) return false;
  if (!row.is_verified || !row.is_active) return false;
  if (row.domain_status !== "active") return false;
  if (row.dns_status !== "verified") return false;
  if (row.https_status !== "verified") return false;
  if (isCertExpired(row.certificate_expires_at, now)) return false;
  if (!isValidHostname(row.hostname) || isPlaceholderHostname(row.hostname)) return false;
  return true;
}

export function canActivateDomain(row: DomainRowLike, now = Date.now()) {
  if (row.dns_status !== "verified") return false;
  if (row.https_status !== "verified") return false;
  if (isCertExpired(row.certificate_expires_at, now)) return false;
  if (["revoked", "disabled", "conflict"].includes(row.domain_status)) return false;
  return true;
}

export function domainStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Pending";
    case "dns_required":
      return "DNS verification required";
    case "dns_verified":
      return "DNS verified";
    case "https_required":
      return "HTTPS verification required";
    case "https_verified":
      return "HTTPS verified";
    case "active":
      return "Active";
    case "dns_failed":
      return "DNS failed";
    case "https_failed":
      return "HTTPS failed";
    case "cert_expired":
      return "Certificate expired";
    case "conflict":
      return "Conflict";
    case "revoked":
      return "Revoked";
    case "disabled":
      return "Disabled";
    default:
      return status || "Unknown";
  }
}

export function dnsStatusLabel(status: string) {
  if (status === "verified") return "Verified";
  if (status === "failed") return "Failed";
  return "Pending";
}

export function httpsStatusLabel(status: string) {
  if (status === "verified") return "Verified";
  if (status === "failed") return "Failed";
  if (status === "expired") return "Expired";
  return "Pending";
}

export function domainSourceLabel(source: string) {
  if (source === "custom") return "Verified custom domain";
  if (source === "subdomain") return "Verified tenant subdomain";
  if (source === "central") return "Central application domain";
  if (source === "legacy") return "Assigned public URL";
  return source || "Unknown";
}

export function domainKindLabel(kind: string) {
  if (kind === "custom") return "Custom domain";
  if (kind === "subdomain") return "Tenant subdomain";
  if (kind === "system") return "Central domain";
  return kind;
}

export function txtVerificationName(hostname: string) {
  const host = normalizeHostname(hostname);
  return host ? `${TXT_VERIFICATION_PREFIX}.${host}` : "";
}

export function containsPlaceholder(value: string) {
  const v = value || "";
  return /YOUR-PUBLIC-URL/i.test(v) || /\{\{\s*BOOTSTRAP_URL\s*\}\}/.test(v) || /your-public-url/i.test(v);
}

export function originContainsForbiddenHost(origin: string, opts: { allowLoopback?: boolean } = {}) {
  const parsed = parsePublicOrigin(origin);
  if (!parsed) return "Invalid public URL";
  if (!opts.allowLoopback && isLoopbackHostname(parsed.hostname)) return "localhost cannot be used in production";
  if (containsPlaceholder(origin) || isPlaceholderHostname(parsed.hostname)) return "Placeholder domains cannot be used";
  if (!opts.allowLoopback && (isPrivateIpv4(parsed.hostname) || isPrivateIpv6(parsed.hostname))) {
    return "Private IP addresses cannot be used as a public domain";
  }
  if (isDockerOrInternalHostname(parsed.hostname) && !isLoopbackHostname(parsed.hostname)) {
    return "Internal hostnames cannot be used as a public domain";
  }
  return "";
}

export function assertUsablePublicOrigin(
  raw: string,
  opts: { requireHttps?: boolean; allowLoopback?: boolean } = {},
) {
  return assertUsableHttpsOrigin(raw, opts);
}

export function assertUsableHttpsOrigin(
  raw: string,
  opts: { allowLoopback?: boolean; requireHttps?: boolean } = {},
) {
  const parsed = parsePublicOrigin(raw);
  if (!parsed) throw new Error(MISSING_PUBLIC_DOMAIN);
  const loopbackLab = Boolean(opts.allowLoopback && isLoopbackHostname(parsed.hostname) && opts.requireHttps === false);
  if (parsed.protocol !== "https:" && !loopbackLab) {
    throw new Error("Public application URL must use HTTPS");
  }
  const bad = originContainsForbiddenHost(parsed.origin, { allowLoopback: opts.allowLoopback });
  if (bad) throw new Error(bad);
  return parsed;
}

export function bootstrapScriptForbiddenReason(script: string, opts: { allowLoopback?: boolean } = {}) {
  if (!script) return "Empty RouterOS script";
  if (/check-certificate\s*=\s*no/i.test(script)) return "Generated script must not disable certificate validation";
  if (containsPlaceholder(script)) return "Generated script must not contain a placeholder URL";
  if (!opts.allowLoopback) {
    if (/\blocalhost\b/i.test(script) || /\b127\.0\.0\.1\b/.test(script) || /\b::1\b/.test(script)) {
      return "Production RouterOS scripts cannot use localhost";
    }
  }
  return "";
}

export function fallbackReasonFor(skipped: { kind: string; reason: string }[]) {
  const custom = skipped.find((s) => s.kind === "custom");
  const sub = skipped.find((s) => s.kind === "subdomain");
  const parts: string[] = [];
  if (custom) parts.push(`Custom domain unavailable: ${custom.reason}`);
  if (sub) parts.push(`Tenant subdomain unavailable: ${sub.reason}`);
  if (!parts.length) return "";
  return parts.join(" ");
}

export function nextDomainStatusAfterDns(ok: boolean): DomainStatus {
  return ok ? "https_required" : "dns_failed";
}

export function nextDomainStatusAfterHttps(ok: boolean, expired = false): DomainStatus {
  if (expired) return "cert_expired";
  return ok ? "active" : "https_failed";
}
