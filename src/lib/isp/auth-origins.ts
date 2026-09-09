/**
 * Origins Better Auth may accept on credentialed POSTs (sign-in / sign-up).
 *
 * Deployed apps often inject BETTER_AUTH_URL as the platform host (*.grok.me /
 * *.vercel.app) while operators open the console on a custom domain. Missing
 * that Origin surfaces as FORBIDDEN "Invalid origin". CSRF stays on: we only
 * add (1) the request's own origin when it matches Host / X-Forwarded-Host,
 * (2) saved tenant public_base_url values, (3) explicit env extras.
 */

export function originOf(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Hostname only (no port), first hop of a forwarded list. */
export function hostnameOf(value: string | null | undefined): string | null {
  const first = (value ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return null;
  const host = first.includes("://") ? originOf(first)?.replace(/^https?:\/\//, "") ?? first : first;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(1, end) : host;
  }
  return host.split(":")[0] || null;
}

export function expandOriginVariants(origin: string): string[] {
  const parsed = originOf(origin);
  if (!parsed) return [];
  const url = new URL(parsed);
  const out = new Set<string>([parsed]);
  const host = url.hostname;
  if (host.startsWith("www.")) {
    url.hostname = host.slice(4);
    out.add(url.origin);
  } else if (host.includes(".")) {
    url.hostname = `www.${host}`;
    out.add(url.origin);
  }
  return [...out];
}

function headerList(request: Request, name: string): string[] {
  return (request.headers.get(name) ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Hostnames this request actually arrived on (proxy-aware). */
export function requestHostnames(request?: Request | null): string[] {
  if (!request) return [];
  const hosts = [
    ...headerList(request, "x-forwarded-host"),
    ...headerList(request, "host"),
  ]
    .map((h) => hostnameOf(h))
    .filter((h): h is string => Boolean(h));
  try {
    const fromUrl = hostnameOf(new URL(request.url).host);
    if (fromUrl) hosts.push(fromUrl);
  } catch {
    /* ignore */
  }
  return [...new Set(hosts)];
}

/**
 * Trust Origin only when it is this request's host. Cross-site POSTs keep a
 * different Origin and stay rejected.
 */
export function sameOriginFromRequest(request?: Request | null): string[] {
  if (!request) return [];
  const origin = originOf(request.headers.get("origin") || request.headers.get("referer"));
  if (!origin) return [];
  const originHost = hostnameOf(origin);
  if (!originHost) return [];
  const hosts = requestHostnames(request);
  if (!hosts.includes(originHost)) return [];
  return expandOriginVariants(origin);
}

/** Public origin for links (password reset) — prefers forwarded host. */
export function requestPublicOrigin(request?: Request | null, fallback = "http://localhost:8080"): string {
  if (!request) return fallback;
  const same = sameOriginFromRequest(request)[0];
  if (same) return same;
  const proto =
    headerList(request, "x-forwarded-proto")[0] ||
    (() => {
      try {
        return new URL(request.url).protocol.replace(":", "");
      } catch {
        return "https";
      }
    })();
  const host = requestHostnames(request)[0];
  if (host) {
    const origin = originOf(`${proto}://${host}`);
    if (origin) return origin;
  }
  try {
    return new URL(request.url).origin || fallback;
  } catch {
    return fallback;
  }
}

export function extraOriginsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const raw = [
    env.BETTER_AUTH_TRUSTED_ORIGINS,
    env.AUTH_TRUSTED_ORIGINS,
    env.BETTER_AUTH_URL,
    env.APP_URL,
    env.PUBLIC_APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.VERCEL_BRANCH_URL,
    env.VERCEL_URL,
  ]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(",");
  const out = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    for (const origin of expandOriginVariants(originOf(part) ?? "")) out.add(origin);
  }
  return [...out];
}

type TenantUrlLoader = () => Promise<string[]>;

let tenantOriginCache: { at: number; origins: string[] } | null = null;
const TENANT_ORIGIN_TTL_MS = 30_000;

export function clearTenantOriginCache() {
  tenantOriginCache = null;
}

async function loadTenantPublicUrls(): Promise<string[]> {
  const { getSql } = await import("../db");
  const sql = await getSql();
  const rows = await sql<{ public_base_url: string }>`
    select public_base_url from tenants where coalesce(public_base_url, '') <> ''`;
  return rows.map((r) => r.public_base_url);
}

export async function tenantPublicOrigins(loader?: TenantUrlLoader): Promise<string[]> {
  const now = Date.now();
  if (!loader && tenantOriginCache && now - tenantOriginCache.at < TENANT_ORIGIN_TTL_MS) {
    return tenantOriginCache.origins;
  }
  let urls: string[] = [];
  try {
    urls = await (loader ?? loadTenantPublicUrls)();
  } catch {
    urls = [];
  }
  const origins = [...new Set(urls.flatMap((u) => expandOriginVariants(originOf(u) ?? "")))];
  if (!loader) tenantOriginCache = { at: now, origins };
  return origins;
}

export async function resolveAuthTrustedOrigins(
  request?: Request | null,
  loader?: TenantUrlLoader,
): Promise<string[]> {
  const out = new Set<string>();
  for (const origin of extraOriginsFromEnv()) out.add(origin);
  for (const origin of sameOriginFromRequest(request)) out.add(origin);
  for (const origin of await tenantPublicOrigins(loader)) out.add(origin);
  return [...out];
}
