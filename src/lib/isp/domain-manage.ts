import { randomBytes } from "node:crypto";
import { nid } from "../utils.ts";
import { clearTenantOriginCache } from "./auth-origins.ts";
import {
  type DomainKind,
  MISSING_PUBLIC_DOMAIN_GENERIC,
  canActivateDomain,
  containsPlaceholder,
  dnsStatusLabel,
  domainKindLabel,
  domainStatusLabel,
  httpsStatusLabel,
  isCertExpired,
  isDomainUsable,
  isValidHostname,
  isValidPublicHostname,
  isValidSlug,
  normalizeHostname,
  originFromHostname,
  parsePublicOrigin,
  reservedSlugReason,
  subdomainHostname,
  txtVerificationName,
} from "./domain-format.ts";
import {
  type DomainRow,
  type PlatformDomainConfig,
  centralOriginFromConfig,
  invalidateDomainCache,
  listTenantDomainRows,
  loadPlatformDomainConfig,
  previewTenantDomain,
  productionDomainContext,
  resolveTenantPublicDomain,
} from "./domain-resolve.ts";
import {
  type DnsLookupFn,
  type TlsProbeFn,
  defaultDnsLookup,
  defaultTlsProbe,
  lookupSystemIps,
  verifyDnsRecord,
  verifyHttpsCertificate,
} from "./domain-verify.ts";
import { writePlatformAudit } from "./platform.ts";
import { rateLimit } from "./rate-limit.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type TenantDomainRecord = DomainRow & {
  verification_txt_name: string;
  verification_txt_expected: string;
  dns_target: string;
  certificate_subject: string;
  certificate_issuer: string;
  https_failure_reason: string;
  verification_attempts: number;
  verified_at: string | null;
  verified_by: string;
  created_at: string;
  updated_at: string;
};

function newVerificationToken() {
  return randomBytes(16).toString("hex");
}

async function loadRow(sql: Sql, id: string, tenantId?: string) {
  const rows = tenantId
    ? await sql<TenantDomainRecord>`
        select id, tenant_id, hostname, kind, subdomain_slug, domain_status, dns_status, https_status,
               is_primary, is_active, is_verified, verification_txt_name, verification_txt_expected,
               dns_target, certificate_subject, certificate_issuer,
               certificate_expires_at::text as certificate_expires_at,
               last_error, https_failure_reason, verification_attempts, verified_by,
               last_checked_at::text as last_checked_at, verified_at::text as verified_at,
               created_at::text as created_at, updated_at::text as updated_at
        from tenant_domains where id = ${id} and tenant_id = ${tenantId}`
    : await sql<TenantDomainRecord>`
        select id, tenant_id, hostname, kind, subdomain_slug, domain_status, dns_status, https_status,
               is_primary, is_active, is_verified, verification_txt_name, verification_txt_expected,
               dns_target, certificate_subject, certificate_issuer,
               certificate_expires_at::text as certificate_expires_at,
               last_error, https_failure_reason, verification_attempts, verified_by,
               last_checked_at::text as last_checked_at, verified_at::text as verified_at,
               created_at::text as created_at, updated_at::text as updated_at
        from tenant_domains where id = ${id}`;
  return rows[0] ?? null;
}

function publicDomainView(row: TenantDomainRecord, includeToken = false) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    hostname: row.hostname,
    kind: row.kind,
    kind_label: domainKindLabel(row.kind),
    subdomain_slug: row.subdomain_slug,
    domain_status: row.domain_status,
    domain_status_label: domainStatusLabel(row.domain_status),
    dns_status: row.dns_status,
    dns_status_label: dnsStatusLabel(row.dns_status),
    https_status: row.https_status,
    https_status_label: httpsStatusLabel(row.https_status),
    is_primary: row.is_primary,
    is_active: row.is_active,
    is_verified: row.is_verified,
    origin: originFromHostname(row.hostname, true),
    verification_txt_name: includeToken ? row.verification_txt_name : "",
    verification_txt_expected: includeToken ? row.verification_txt_expected : "",
    dns_target: row.dns_target,
    certificate_subject: row.certificate_subject,
    certificate_issuer: row.certificate_issuer,
    certificate_expires_at: row.certificate_expires_at,
    last_error: row.last_error,
    https_failure_reason: row.https_failure_reason,
    verification_attempts: row.verification_attempts,
    last_checked_at: row.last_checked_at,
    verified_at: row.verified_at,
    usable: isDomainUsable(row),
  };
}

async function clashHostname(sql: Sql, hostname: string, exceptId?: string) {
  const host = normalizeHostname(hostname);
  const [row] = await sql<{ id: string; tenant_id: string }>`
    select id, tenant_id from tenant_domains
    where lower(hostname) = ${host} and id <> ${exceptId || ""}`;
  return row ?? null;
}

async function tenantSlug(sql: Sql, tenantId: string) {
  const [t] = await sql<{ slug: string; name: string }>`select slug, name from tenants where id = ${tenantId}`;
  if (!t) throw new Error("ISP not found");
  return t;
}

export async function syncTenantPublicBaseUrl(sql: Sql, tenantId: string) {
  invalidateDomainCache(tenantId);
  clearTenantOriginCache();
  try {
    const resolved = await resolveTenantPublicDomain(sql, tenantId, "public_api");
    await sql`update tenants set public_base_url = ${resolved.origin} where id = ${tenantId}`;
    return resolved.origin;
  } catch {
    return "";
  }
}

async function audit(
  sql: Sql,
  actorUserId: string,
  action: string,
  row: { id: string; tenant_id: string; hostname?: string },
  metadata: Record<string, unknown> = {},
) {
  await writePlatformAudit(sql, {
    actorUserId,
    action,
    entityType: "tenant_domain",
    entityId: row.id,
    tenantId: row.tenant_id,
    metadata: { hostname: row.hostname, ...metadata },
  });
}

function assertRate(key: string) {
  const lim = rateLimit(key, 8, 60_000);
  if (!lim.ok) throw new Error("Too many verification attempts. Wait a minute and try again.");
}

export async function saveCentralDomainSettings(
  sql: Sql,
  actorUserId: string,
  patch: { app_public_url?: string; tenant_subdomain_base?: string; central_domain_only?: boolean },
) {
  const entries: [string, string][] = [];
  if (patch.app_public_url != null) {
    const raw = patch.app_public_url.trim();
    if (raw) {
      const parsed = parsePublicOrigin(raw);
      if (!parsed) throw new Error("Enter a valid http(s) URL");
      if (containsPlaceholder(parsed.origin)) throw new Error("Placeholder domains cannot be used");
      const production = productionDomainContext();
      if (production && parsed.protocol !== "https:") throw new Error("Public application URL must use HTTPS");
      if (production && !isValidPublicHostname(parsed.hostname)) {
        throw new Error("Public application URL cannot be localhost or an internal hostname");
      }
      entries.push(["app_public_url", parsed.origin]);
    } else {
      entries.push(["app_public_url", ""]);
    }
  }
  if (patch.tenant_subdomain_base != null) {
    const base = normalizeHostname(patch.tenant_subdomain_base);
    if (base && !isValidHostname(base)) throw new Error("Subdomain base must be a hostname");
    entries.push(["tenant_subdomain_base", base]);
  }
  if (patch.central_domain_only != null) {
    entries.push(["central_domain_only", patch.central_domain_only ? "true" : "false"]);
  }
  for (const [key, value] of entries) {
    await sql`insert into platform_settings (key, value, updated_at) values (${key}, ${value}, now())
      on conflict (key) do update set value = ${value}, updated_at = now()`;
  }
  invalidateDomainCache();
  clearTenantOriginCache();
  await writePlatformAudit(sql, {
    actorUserId,
    action: "platform.domain.settings",
    entityType: "platform_settings",
    metadata: patch,
  });
  return loadPlatformDomainConfig(sql);
}

async function insertDomain(
  sql: Sql,
  opts: {
    tenantId: string;
    hostname: string;
    kind: DomainKind;
    slug?: string;
    actorUserId: string;
    dnsTarget?: string;
  },
) {
  const hostname = normalizeHostname(opts.hostname);
  if (!hostname || !isValidHostname(hostname)) throw new Error("Enter a valid hostname");
  if (!isValidPublicHostname(hostname, { allowLoopback: false })) {
    throw new Error("That hostname cannot be used as a public domain");
  }
  const clash = await clashHostname(sql, hostname);
  if (clash && clash.tenant_id !== opts.tenantId) throw new Error("That domain is already assigned to another ISP");
  if (clash && clash.tenant_id === opts.tenantId) return loadRow(sql, clash.id, opts.tenantId);
  const token = newVerificationToken();
  const id = nid("tdom");
  await sql`insert into tenant_domains (
      id, tenant_id, hostname, kind, subdomain_slug, domain_status, dns_status, https_status,
      verification_token, verification_txt_name, verification_txt_expected, dns_target,
      created_by, updated_by
    ) values (
      ${id}, ${opts.tenantId}, ${hostname}, ${opts.kind}, ${opts.slug || ""}, 'dns_required', 'pending', 'pending',
      ${token}, ${txtVerificationName(hostname)}, ${token}, ${opts.dnsTarget || ""},
      ${opts.actorUserId}, ${opts.actorUserId}
    )`;
  await audit(sql, opts.actorUserId, "platform.domain.created", { id, tenant_id: opts.tenantId, hostname }, { kind: opts.kind });
  invalidateDomainCache(opts.tenantId);
  return loadRow(sql, id, opts.tenantId);
}

export async function generateTenantSubdomain(
  sql: Sql,
  opts: { tenantId: string; actorUserId: string; slug?: string },
) {
  const ten = await tenantSlug(sql, opts.tenantId);
  const slug = (opts.slug || ten.slug).trim().toLowerCase();
  const reason = reservedSlugReason(slug);
  if (reason) throw new Error(reason);
  if (!isValidSlug(slug)) throw new Error("Slug must be lowercase letters, numbers, and hyphens only");
  const cfg = await loadPlatformDomainConfig(sql);
  const base = cfg.tenant_subdomain_base || parsePublicOrigin(centralOriginFromConfig(cfg))?.hostname || "";
  if (!base) throw new Error("Set the tenant subdomain base (for example isp.example.com) before generating a subdomain");
  const hostname = subdomainHostname(slug, base);
  const existing = (await listTenantDomainRows(sql, opts.tenantId)).find((r) => r.kind === "subdomain");
  if (existing) return loadRow(sql, existing.id, opts.tenantId);
  return insertDomain(sql, {
    tenantId: opts.tenantId,
    hostname,
    kind: "subdomain",
    slug,
    actorUserId: opts.actorUserId,
    dnsTarget: base,
  });
}

export async function setTenantCustomDomain(
  sql: Sql,
  opts: { tenantId: string; hostname: string; actorUserId: string },
) {
  const hostname = normalizeHostname(opts.hostname);
  if (!hostname) throw new Error("Enter a custom hostname");
  return insertDomain(sql, {
    tenantId: opts.tenantId,
    hostname,
    kind: "custom",
    actorUserId: opts.actorUserId,
  });
}

export async function verifyTenantDomainDns(
  sql: Sql,
  opts: {
    domainId: string;
    actorUserId: string;
    lookup?: DnsLookupFn;
  },
) {
  const row = await loadRow(sql, opts.domainId);
  if (!row) throw new Error("Domain not found");
  assertRate(`domain-dns:${row.tenant_id}`);
  assertRate(`domain-dns-host:${row.hostname}`);
  const cfg = await loadPlatformDomainConfig(sql);
  const central = parsePublicOrigin(centralOriginFromConfig(cfg));
  const lookup = opts.lookup || defaultDnsLookup;
  const systemHost = central?.hostname || row.dns_target;
  const systemIps = await lookupSystemIps(systemHost, lookup);
  const result = await verifyDnsRecord(
    {
      hostname: row.hostname,
      expectedTxt: row.verification_txt_expected,
      expectedTxtName: row.verification_txt_name,
      systemHost,
      systemIps,
      production: cfg.production,
    },
    lookup,
  );
  const ok = result.ok;
  const status = ok ? "https_required" : "dns_failed";
  const dnsStatus = ok ? "verified" : "failed";
  await sql`update tenant_domains set
    dns_status = ${dnsStatus},
    domain_status = ${status},
    dns_verified_at = case when ${ok} then now() else dns_verified_at end,
    last_error = ${ok ? "" : result.error},
    verification_txt_actual = ${result.actual.slice(0, 240)},
    last_checked_at = now(),
    verification_attempts = verification_attempts + 1,
    updated_by = ${opts.actorUserId},
    updated_at = now()
    where id = ${row.id}`;
  await audit(sql, opts.actorUserId, ok ? "platform.domain.dns_verified" : "platform.domain.dns_failed", row, {
    method: result.method,
    error: result.error,
  });
  invalidateDomainCache(row.tenant_id);
  const next = await loadRow(sql, row.id);
  return { ok, error: result.error, method: result.method, domain: next ? publicDomainView(next, true) : null };
}

export async function verifyTenantDomainHttps(
  sql: Sql,
  opts: { domainId: string; actorUserId: string; probe?: TlsProbeFn },
) {
  const row = await loadRow(sql, opts.domainId);
  if (!row) throw new Error("Domain not found");
  if (row.dns_status !== "verified") throw new Error("Verify DNS before HTTPS");
  assertRate(`domain-https:${row.tenant_id}`);
  assertRate(`domain-https-host:${row.hostname}`);
  const probe = opts.probe || defaultTlsProbe;
  const result = await verifyHttpsCertificate(row.hostname, probe, { production: productionDomainContext() });
  const expired = isCertExpired(result.expiresAt);
  const ok = result.ok && !expired;
  const httpsStatus = expired ? "expired" : ok ? "verified" : "failed";
  const domainStatus = expired ? "cert_expired" : ok ? "active" : "https_failed";
  if (ok) {
    await sql`update tenant_domains set is_primary = false
      where tenant_id = ${row.tenant_id} and id <> ${row.id} and is_primary = true`;
  }
  await sql`update tenant_domains set
    https_status = ${httpsStatus},
    domain_status = ${domainStatus},
    is_verified = ${ok},
    is_active = ${ok},
    is_primary = ${ok},
    https_verified_at = case when ${ok} then now() else https_verified_at end,
    verified_at = case when ${ok} then now() else verified_at end,
    verified_by = case when ${ok} then ${opts.actorUserId} else verified_by end,
    certificate_subject = ${result.subject},
    certificate_issuer = ${result.issuer},
    certificate_expires_at = ${result.expiresAt},
    https_failure_reason = ${ok ? "" : result.error},
    last_error = ${ok ? "" : result.error},
    last_checked_at = now(),
    verification_attempts = verification_attempts + 1,
    updated_by = ${opts.actorUserId},
    updated_at = now()
    where id = ${row.id}`;
  await audit(sql, opts.actorUserId, ok ? "platform.domain.https_verified" : "platform.domain.https_failed", row, {
    error: result.error,
    expires_at: result.expiresAt,
  });
  if (ok) await syncTenantPublicBaseUrl(sql, row.tenant_id);
  else invalidateDomainCache(row.tenant_id);
  const next = await loadRow(sql, row.id);
  return { ok, error: result.error, domain: next ? publicDomainView(next, true) : null };
}

export async function setDomainPrimary(sql: Sql, opts: { domainId: string; actorUserId: string }) {
  const row = await loadRow(sql, opts.domainId);
  if (!row) throw new Error("Domain not found");
  if (!canActivateDomain(row) || !isDomainUsable(row)) {
    throw new Error("Only a DNS- and HTTPS-verified domain can be set as primary");
  }
  await sql`update tenant_domains set is_primary = false, updated_at = now()
    where tenant_id = ${row.tenant_id} and is_primary = true`;
  await sql`update tenant_domains set is_primary = true, is_active = true, domain_status = 'active',
    updated_by = ${opts.actorUserId}, updated_at = now()
    where id = ${row.id}`;
  await audit(sql, opts.actorUserId, "platform.domain.primary", row);
  await syncTenantPublicBaseUrl(sql, row.tenant_id);
  return loadRow(sql, row.id);
}

export async function disableTenantDomain(sql: Sql, opts: { domainId: string; actorUserId: string }) {
  const row = await loadRow(sql, opts.domainId);
  if (!row) throw new Error("Domain not found");
  await sql`update tenant_domains set
    is_active = false, is_primary = false, domain_status = 'disabled',
    updated_by = ${opts.actorUserId}, updated_at = now()
    where id = ${row.id}`;
  await audit(sql, opts.actorUserId, "platform.domain.disabled", row);
  await syncTenantPublicBaseUrl(sql, row.tenant_id);
  return loadRow(sql, row.id);
}

export async function revokeTenantDomain(sql: Sql, opts: { domainId: string; actorUserId: string }) {
  const row = await loadRow(sql, opts.domainId);
  if (!row) throw new Error("Domain not found");
  await sql`update tenant_domains set
    is_active = false, is_primary = false, is_verified = false, domain_status = 'revoked',
    updated_by = ${opts.actorUserId}, updated_at = now()
    where id = ${row.id}`;
  await audit(sql, opts.actorUserId, "platform.domain.revoked", row);
  await syncTenantPublicBaseUrl(sql, row.tenant_id);
  return loadRow(sql, row.id);
}

export async function enableTenantDomain(sql: Sql, opts: { domainId: string; actorUserId: string }) {
  const row = await loadRow(sql, opts.domainId);
  if (!row) throw new Error("Domain not found");
  if (row.domain_status === "revoked") {
    throw new Error("Revoked domains must be re-verified before they can be used");
  }
  if (row.dns_status !== "verified" || row.https_status !== "verified") {
    throw new Error("Re-verify DNS and HTTPS before enabling this domain");
  }
  await sql`update tenant_domains set
    is_active = true, is_verified = true, domain_status = 'active',
    updated_by = ${opts.actorUserId}, updated_at = now()
    where id = ${row.id}`;
  await audit(sql, opts.actorUserId, "platform.domain.enabled", row);
  await syncTenantPublicBaseUrl(sql, row.tenant_id);
  return loadRow(sql, row.id);
}

export async function removeTenantDomain(sql: Sql, opts: { domainId: string; actorUserId: string }) {
  const row = await loadRow(sql, opts.domainId);
  if (!row) throw new Error("Domain not found");
  if (row.kind === "subdomain") throw new Error("Disable the tenant subdomain instead of removing it");
  await sql`delete from tenant_domains where id = ${row.id}`;
  await audit(sql, opts.actorUserId, "platform.domain.removed", row);
  await syncTenantPublicBaseUrl(sql, row.tenant_id);
  return { ok: true, id: row.id };
}

export async function testPublicUrl(sql: Sql, opts: { origin?: string; domainId?: string; probe?: TlsProbeFn }) {
  let hostname = "";
  if (opts.domainId) {
    const row = await loadRow(sql, opts.domainId);
    if (!row) throw new Error("Domain not found");
    hostname = row.hostname;
  } else {
    hostname = parsePublicOrigin(opts.origin || "")?.hostname || "";
  }
  if (!hostname) throw new Error("Enter a public URL to test");
  assertRate(`domain-test:${hostname}`);
  const result = await verifyHttpsCertificate(hostname, opts.probe || defaultTlsProbe);
  return {
    hostname,
    origin: originFromHostname(hostname, true),
    ok: result.ok,
    status_code: result.statusCode,
    subject: result.subject,
    issuer: result.issuer,
    expires_at: result.expiresAt,
    error: result.error,
  };
}

export type TenantDomainDeskRow = {
  tenant_id: string;
  name: string;
  slug: string;
  central_origin: string;
  subdomain_hostname: string;
  subdomain_status: string;
  custom_hostname: string;
  custom_status: string;
  dns_status: string;
  https_status: string;
  overall_status: string;
  last_checked_at: string | null;
  active_origin: string;
  active_source: string;
  warning: string;
};

export async function loadDomainDesk(sql: Sql) {
  const cfg = await loadPlatformDomainConfig(sql);
  const central = centralOriginFromConfig(cfg);
  const tenants = await sql<{ id: string; name: string; slug: string; public_base_url: string }>`
    select id, name, slug, coalesce(public_base_url, '') as public_base_url from tenants order by name`;
  const domains = await sql<TenantDomainRecord>`
    select id, tenant_id, hostname, kind, subdomain_slug, domain_status, dns_status, https_status,
           is_primary, is_active, is_verified, verification_txt_name, verification_txt_expected,
           dns_target, certificate_subject, certificate_issuer,
           certificate_expires_at::text as certificate_expires_at,
           last_error, https_failure_reason, verification_attempts, verified_by,
           last_checked_at::text as last_checked_at, verified_at::text as verified_at,
           created_at::text as created_at, updated_at::text as updated_at
    from tenant_domains order by hostname`;
  const byTenant = new Map<string, TenantDomainRecord[]>();
  for (const d of domains) {
    const list = byTenant.get(d.tenant_id) || [];
    list.push(d);
    byTenant.set(d.tenant_id, list);
  }
  const rows: TenantDomainDeskRow[] = [];
  for (const t of tenants) {
    const list = byTenant.get(t.id) || [];
    const sub = list.find((d) => d.kind === "subdomain");
    const custom = list.find((d) => d.kind === "custom" && d.is_primary) || list.find((d) => d.kind === "custom");
    const preview = await previewTenantDomain(sql, t.id);
    const watched = custom || sub;
    rows.push({
      tenant_id: t.id,
      name: t.name,
      slug: t.slug,
      central_origin: central,
      subdomain_hostname: sub?.hostname || "",
      subdomain_status: sub?.domain_status || "",
      custom_hostname: custom?.hostname || "",
      custom_status: custom?.domain_status || "",
      dns_status: watched?.dns_status || "",
      https_status: watched?.https_status || "",
      overall_status: watched?.domain_status || (preview.ok ? "central" : "missing"),
      last_checked_at: watched?.last_checked_at || null,
      active_origin: preview.origin,
      active_source: preview.source_label,
      warning: preview.warning || preview.error,
    });
  }
  return {
    central: {
      origin: central,
      hostname: parsePublicOrigin(central)?.hostname || "",
      app_public_url: cfg.app_public_url,
      env_app_public_url: cfg.env_app_public_url,
      tenant_subdomain_base: cfg.tenant_subdomain_base,
      central_domain_only: cfg.central_domain_only,
      production: cfg.production,
      source: cfg.app_public_url ? "platform_settings" : cfg.env_app_public_url ? "environment" : "unset",
      error: central ? "" : MISSING_PUBLIC_DOMAIN_GENERIC,
    },
    tenants: rows,
    domains: domains.map((d) => publicDomainView(d, true)),
  };
}

export function serializeDomain(row: TenantDomainRecord | null, includeToken = false) {
  return row ? publicDomainView(row, includeToken) : null;
}

export type { PlatformDomainConfig };
