import { isProductionRuntime } from "./runtime-config.ts";
import {
  type DomainPurpose,
  type DomainSource,
  MISSING_PUBLIC_DOMAIN,
  MISSING_PUBLIC_DOMAIN_GENERIC,
  ROUTER_DOMAIN_REQUIRED,
  UNVERIFIED_SUBDOMAIN_WARNING,
  assertUsableHttpsOrigin,
  bootstrapUrl,
  containsPlaceholder,
  defaultPathForPurpose,
  domainSourceLabel,
  fallbackReasonFor,
  isCertExpired,
  isDomainUsable,
  isLoopbackHostname,
  isPlaceholderHostname,
  isValidPublicHostname,
  joinPublicUrl,
  normalizeHostname,
  originFromHostname,
  parsePublicOrigin,
  subdomainHostname,
} from "./domain-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type DomainRow = {
  id: string;
  tenant_id: string;
  hostname: string;
  kind: string;
  subdomain_slug: string;
  domain_status: string;
  dns_status: string;
  https_status: string;
  is_primary: boolean;
  is_active: boolean;
  is_verified: boolean;
  certificate_expires_at: string | null;
  last_error: string;
  last_checked_at: string | null;
};

export type PlatformDomainConfig = {
  app_public_url: string;
  tenant_subdomain_base: string;
  central_domain_only: boolean;
  env_app_public_url: string;
  production: boolean;
};

export type ResolvedPublicDomain = {
  origin: string;
  hostname: string;
  source: DomainSource;
  source_label: string;
  purpose: DomainPurpose;
  fallback_reason: string;
  warning: string;
  https_required: boolean;
  certificate_validation: boolean;
  domain_id: string | null;
  central_origin: string;
};

export type DomainPreview = {
  ok: boolean;
  origin: string;
  hostname: string;
  source: DomainSource | "";
  source_label: string;
  fallback_reason: string;
  warning: string;
  error: string;
  https_required: boolean;
  certificate_validation: boolean;
  bootstrap_url_example: string;
  central_origin: string;
};

type CacheEntry = { at: number; value: ResolvedPublicDomain };
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry>();

export function invalidateDomainCache(tenantId?: string) {
  if (!tenantId) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${tenantId}:`)) cache.delete(key);
  }
}

function envValue(env: NodeJS.ProcessEnv, ...keys: string[]) {
  for (const key of keys) {
    const v = (env[key] || "").trim();
    if (v) return v;
  }
  return "";
}

export function productionDomainContext(env: NodeJS.ProcessEnv = process.env) {
  return isProductionRuntime(env) || env.NODE_ENV === "production";
}

function originFromConfig(raw: string, opts: { production: boolean; requireHttps: boolean }) {
  const parsed = parsePublicOrigin(raw);
  if (!parsed) return "";
  if (containsPlaceholder(parsed.origin) || isPlaceholderHostname(parsed.hostname)) return "";
  const allowLoopback = !opts.production;
  if (opts.production && isLoopbackHostname(parsed.hostname)) return "";
  try {
    assertUsableHttpsOrigin(parsed.origin, {
      allowLoopback,
      requireHttps: opts.requireHttps && !allowLoopback ? true : opts.requireHttps,
    });
    return parsed.origin;
  } catch {
    if (!opts.production && isLoopbackHostname(parsed.hostname)) return parsed.origin;
    return "";
  }
}

export async function loadPlatformDomainConfig(
  sql: Sql,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlatformDomainConfig> {
  const rows = await sql<{ key: string; value: string }>`
    select key, value from platform_settings
    where key in ('app_public_url', 'tenant_subdomain_base', 'central_domain_only')`;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    app_public_url: (map.app_public_url || "").trim(),
    tenant_subdomain_base: normalizeHostname(map.tenant_subdomain_base || ""),
    central_domain_only: (map.central_domain_only || "").trim().toLowerCase() === "true",
    env_app_public_url: envValue(env, "APP_PUBLIC_URL", "PUBLIC_APP_URL", "APP_URL", "BETTER_AUTH_URL"),
    production: productionDomainContext(env),
  };
}

export function centralOriginFromConfig(
  cfg: PlatformDomainConfig,
  opts: { requireHttps?: boolean } = {},
) {
  const requireHttps = opts.requireHttps !== false;
  const production = cfg.production;
  const fromSettings = originFromConfig(cfg.app_public_url, { production, requireHttps });
  if (fromSettings) return fromSettings;
  return originFromConfig(cfg.env_app_public_url, { production, requireHttps });
}

function subdomainBaseFromConfig(cfg: PlatformDomainConfig) {
  if (cfg.tenant_subdomain_base) return cfg.tenant_subdomain_base;
  const central = parsePublicOrigin(cfg.app_public_url || cfg.env_app_public_url);
  return central?.hostname || "";
}

async function loadTenant(sql: Sql, tenantId: string) {
  const [row] = await sql<{ id: string; slug: string; public_base_url: string; name: string }>`
    select id, slug, coalesce(public_base_url, '') as public_base_url, name
    from tenants where id = ${tenantId}`;
  return row ?? null;
}

export async function listTenantDomainRows(sql: Sql, tenantId: string) {
  return sql<DomainRow>`
    select id, tenant_id, hostname, kind, subdomain_slug, domain_status, dns_status, https_status,
           is_primary, is_active, is_verified, certificate_expires_at::text as certificate_expires_at,
           last_error, last_checked_at::text as last_checked_at
    from tenant_domains
    where tenant_id = ${tenantId}
    order by is_primary desc, kind asc, created_at asc`;
}

async function retireExpiredDomains(sql: Sql, rows: DomainRow[], now: number) {
  const expired = rows.filter(
    (r) =>
      (r.domain_status === "active" || r.is_active || r.is_verified) &&
      (r.https_status === "expired" || isCertExpired(r.certificate_expires_at, now)),
  );
  for (const row of expired) {
    await sql`update tenant_domains set
      https_status = 'expired',
      domain_status = 'cert_expired',
      is_verified = false,
      is_active = false,
      is_primary = false,
      last_error = 'HTTPS certificate verification failed',
      https_failure_reason = 'Certificate expired',
      last_checked_at = now(),
      updated_at = now()
      where id = ${row.id} and domain_status <> 'cert_expired'`;
    row.https_status = "expired";
    row.domain_status = "cert_expired";
    row.is_verified = false;
    row.is_active = false;
    row.is_primary = false;
    invalidateDomainCache(row.tenant_id);
  }
}

function skipReason(row: DomainRow, now: number) {
  if (row.domain_status === "revoked") return "revoked";
  if (row.domain_status === "disabled") return "disabled";
  if (row.domain_status === "conflict") return "assigned to another ISP";
  if (!row.is_active || !row.is_verified || row.domain_status !== "active") {
    if (row.https_status === "expired" || isCertExpired(row.certificate_expires_at, now)) {
      return "HTTPS certificate verification failed";
    }
    if (row.https_status === "failed") return "HTTPS certificate verification failed";
    if (row.dns_status !== "verified") return "DNS verification has not completed";
    if (row.https_status !== "verified") return "HTTPS certificate verification failed";
    return "not verified";
  }
  if (row.dns_status !== "verified") return "DNS verification has not completed";
  if (row.https_status !== "verified") return "HTTPS certificate verification failed";
  if (isCertExpired(row.certificate_expires_at, now)) return "HTTPS certificate verification failed";
  if (!isValidPublicHostname(row.hostname)) return "hostname is not a public domain";
  return "";
}

function pickUsable(rows: DomainRow[], kind: string, now: number) {
  const matches = rows.filter((r) => r.kind === kind);
  const usable = matches.filter((r) => isDomainUsable(r, now) && isValidPublicHostname(r.hostname));
  usable.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const skipped = matches
    .filter((r) => !usable.includes(r))
    .map((r) => ({ kind, reason: skipReason(r, now) || "not verified" }));
  return { row: usable[0] ?? null, skipped };
}

function resolved(
  origin: string,
  source: DomainSource,
  purpose: DomainPurpose,
  extra: Partial<ResolvedPublicDomain> = {},
): ResolvedPublicDomain {
  const parsed = parsePublicOrigin(origin)!;
  return {
    origin: parsed.origin,
    hostname: parsed.hostname,
    source,
    source_label: domainSourceLabel(source),
    purpose,
    fallback_reason: extra.fallback_reason || "",
    warning: extra.warning || "",
    https_required: extra.https_required !== false,
    certificate_validation: extra.certificate_validation !== false,
    domain_id: extra.domain_id ?? null,
    central_origin: extra.central_origin || "",
  };
}

async function resolveUncached(
  sql: Sql,
  tenantId: string,
  purpose: DomainPurpose,
  opts: { requireHttps?: boolean; production?: boolean } = {},
): Promise<ResolvedPublicDomain> {
  const cfg = await loadPlatformDomainConfig(sql);
  const production = opts.production ?? cfg.production;
  const requireHttps = opts.requireHttps !== false;
  const allowLoopback = !production;
  const central = centralOriginFromConfig({ ...cfg, production }, { requireHttps });
  const bootstrap = purpose === "router_bootstrap";

  if (cfg.central_domain_only) {
    if (!central) throw new Error(bootstrap ? MISSING_PUBLIC_DOMAIN : MISSING_PUBLIC_DOMAIN_GENERIC);
    return resolved(central, "central", purpose, { https_required: requireHttps, central_origin: central });
  }

  const tenant = await loadTenant(sql, tenantId);
  if (!tenant) throw new Error("ISP not found");
  const rows = await listTenantDomainRows(sql, tenantId);
  const now = Date.now();
  await retireExpiredDomains(sql, rows, now);
  const custom = pickUsable(rows, "custom", now);
  const sub = pickUsable(rows, "subdomain", now);
  const skipped = [...custom.skipped, ...sub.skipped];

  if (custom.row) {
    const origin = originFromHostname(custom.row.hostname, true);
    assertUsableHttpsOrigin(origin, { allowLoopback: false, requireHttps: true });
    return resolved(origin, "custom", purpose, {
      domain_id: custom.row.id,
      https_required: true,
      central_origin: central,
    });
  }

  if (sub.row) {
    const origin = originFromHostname(sub.row.hostname, true);
    assertUsableHttpsOrigin(origin, { allowLoopback: false, requireHttps: true });
    return resolved(origin, "subdomain", purpose, {
      domain_id: sub.row.id,
      https_required: true,
      fallback_reason: fallbackReasonFor(custom.skipped),
      warning: custom.skipped.length ? fallbackReasonFor(custom.skipped) : "",
      central_origin: central,
    });
  }

  if (central) {
    const warning = sub.skipped.length ? UNVERIFIED_SUBDOMAIN_WARNING : fallbackReasonFor(skipped);
    return resolved(central, "central", purpose, {
      https_required: requireHttps,
      fallback_reason: fallbackReasonFor(skipped),
      warning,
      central_origin: central,
    });
  }

  const legacy = originFromConfig(tenant.public_base_url, { production, requireHttps });
  if (legacy) {
    return resolved(legacy, "legacy", purpose, {
      https_required: requireHttps,
      fallback_reason: fallbackReasonFor(skipped),
      warning: skipped.length ? fallbackReasonFor(skipped) : "",
      central_origin: central,
    });
  }

  throw new Error(bootstrap ? MISSING_PUBLIC_DOMAIN : MISSING_PUBLIC_DOMAIN_GENERIC);
}

export async function resolveTenantPublicDomain(
  sql: Sql,
  tenantId: string,
  purpose: DomainPurpose = "public_api",
  opts: { requireHttps?: boolean; production?: boolean } = {},
): Promise<ResolvedPublicDomain> {
  if (!tenantId) throw new Error(MISSING_PUBLIC_DOMAIN_GENERIC);
  const key = `${tenantId}:${purpose}:${opts.requireHttps === false ? "http" : "https"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await resolveUncached(sql, tenantId, purpose, opts);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function resolveTenantPublicOrigin(
  sql: Sql,
  tenantId: string,
  purpose: DomainPurpose = "public_api",
  opts: { requireHttps?: boolean; production?: boolean } = {},
) {
  return (await resolveTenantPublicDomain(sql, tenantId, purpose, opts)).origin;
}

export async function tenantPublicOriginOrEmpty(
  sql: Sql,
  tenantId: string,
  purpose: DomainPurpose = "public_api",
  opts: { requireHttps?: boolean; production?: boolean } = {},
) {
  try {
    return await resolveTenantPublicOrigin(sql, tenantId, purpose, opts);
  } catch {
    return "";
  }
}

export async function publicUrlFor(
  sql: Sql,
  tenantId: string,
  path: string,
  purpose: DomainPurpose = "public_api",
) {
  const origin = await resolveTenantPublicOrigin(sql, tenantId, purpose);
  return joinPublicUrl(origin, path);
}

/** Spec name: resolve a verified origin plus the path for this purpose. Never invents a host. */
export async function resolveTenantPublicUrl(
  sql: Sql,
  tenantId: string,
  purpose: DomainPurpose = "public_api",
  path?: string,
) {
  const domain = await resolveTenantPublicDomain(sql, tenantId, purpose);
  return joinPublicUrl(domain.origin, path ?? defaultPathForPurpose(purpose));
}

export async function resolveBootstrapUrl(sql: Sql, tenantId: string, token: string, requireHttps = true) {
  const domain = await resolveTenantPublicDomain(sql, tenantId, "router_bootstrap", { requireHttps });
  if (!domain.origin) throw new Error(ROUTER_DOMAIN_REQUIRED);
  return {
    ...domain,
    fetch_url: bootstrapUrl(domain.origin, token),
  };
}

export async function previewTenantDomain(
  sql: Sql,
  tenantId: string,
  purpose: DomainPurpose = "router_bootstrap",
): Promise<DomainPreview> {
  try {
    const domain = await resolveTenantPublicDomain(sql, tenantId, purpose);
    return {
      ok: true,
      origin: domain.origin,
      hostname: domain.hostname,
      source: domain.source,
      source_label: domain.source_label,
      fallback_reason: domain.fallback_reason,
      warning: domain.warning,
      error: "",
      https_required: domain.https_required,
      certificate_validation: domain.certificate_validation,
      bootstrap_url_example: bootstrapUrl(domain.origin, "<token>"),
      central_origin: domain.central_origin,
    };
  } catch (err) {
    const cfg = await loadPlatformDomainConfig(sql).catch(
      () =>
        ({
          app_public_url: "",
          tenant_subdomain_base: "",
          central_domain_only: false,
          env_app_public_url: "",
          production: productionDomainContext(),
        }) satisfies PlatformDomainConfig,
    );
    return {
      ok: false,
      origin: "",
      hostname: "",
      source: "",
      source_label: "",
      fallback_reason: "",
      warning: "",
      error: err instanceof Error ? err.message : MISSING_PUBLIC_DOMAIN,
      https_required: true,
      certificate_validation: true,
      bootstrap_url_example: "",
      central_origin: centralOriginFromConfig(cfg),
    };
  }
}

export function expectedSubdomainHostname(slug: string, cfg: PlatformDomainConfig) {
  const base = subdomainBaseFromConfig(cfg);
  return subdomainHostname(slug, base);
}

export async function listActiveDomainOrigins(sql: Sql) {
  const rows = await sql<{ hostname: string }>`
    select hostname from tenant_domains
    where is_active = true and is_verified = true and domain_status = 'active'
      and dns_status = 'verified' and https_status = 'verified'`;
  const tenants = await sql<{ public_base_url: string }>`
    select public_base_url from tenants where coalesce(public_base_url, '') <> ''`;
  const cfg = await loadPlatformDomainConfig(sql);
  const central = centralOriginFromConfig(cfg);
  const origins = [
    ...rows.map((r) => originFromHostname(r.hostname, true)),
    ...tenants.map((t) => parsePublicOrigin(t.public_base_url)?.origin || ""),
    central,
  ].filter(Boolean);
  return [...new Set(origins)];
}

export { subdomainBaseFromConfig };
