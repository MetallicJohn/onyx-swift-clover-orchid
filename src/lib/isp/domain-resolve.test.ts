import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bootstrapFetchUrl,
  bootstrapPasteScript,
  hashProvisionToken,
  issueProvisioningToken,
} from "./router-provisioning.ts";
import { enrollFields, nextWgAddress } from "./agent.ts";
import {
  disableTenantDomain,
  generateTenantSubdomain,
  removeTenantDomain,
  revokeTenantDomain,
  setTenantCustomDomain,
  verifyTenantDomainDns,
  verifyTenantDomainHttps,
} from "./domain-manage.ts";
import { MISSING_PUBLIC_DOMAIN, containsPlaceholder } from "./domain-format.ts";
import {
  invalidateDomainCache,
  previewTenantDomain,
  resolveBootstrapUrl,
  resolveTenantPublicDomain,
  resolveTenantPublicUrl,
  tenantPublicOriginOrEmpty,
} from "./domain-resolve.ts";
import { loadNetworkNotifyContext } from "./notifications.ts";
import { applyRls } from "./rls.ts";
import { openTestDb } from "./test-db.ts";

async function seedTenant(
  sql: Awaited<ReturnType<typeof openTestDb>>["sql"],
  id: string,
  slug: string,
  publicBase = "",
) {
  await sql`insert into tenants (id, name, slug, public_base_url)
    values (${id}, ${slug}, ${slug}, ${publicBase})
    on conflict (id) do nothing`;
}

async function setSetting(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], key: string, value: string) {
  await sql`insert into platform_settings (key, value, updated_at) values (${key}, ${value}, now())
    on conflict (key) do update set value = ${value}, updated_at = now()`;
}

async function seedRouter(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], tenant: string) {
  await seedTenant(sql, tenant, `isp-${tenant}`, "");
  const enroll = enrollFields("edge-01");
  const address = await nextWgAddress(sql, tenant);
  await sql`insert into routers (
      id, tenant_id, name, identity, location, role, wg_status, last_seen,
      enroll_token, wg_public, wg_private_ref, wg_address, model, ros_version, site_pop, management_ip
    ) values (
      ${`rtr_${tenant}`}, ${tenant}, 'edge-01', 'edge-01', 'Nanyuki', 'access', 'pending', null,
      ${enroll.token}, ${enroll.wg_public}, ${enroll.wg_private_sealed}, ${address},
      'RB5009', '7.16', 'Nanyuki POP', '10.200.0.2'
    )`;
  return enroll;
}

const dnsOk = async () => ({ a: ["203.0.113.10"], aaaa: [] as string[], cname: ["isp.example.com"], txt: [["x"]] });
const tlsOk = async () => ({
  ok: true,
  authorized: true,
  subject: "ok",
  issuer: "le",
  expiresAt: "2099-01-01T00:00:00.000Z",
  hostMatched: true,
  statusCode: 200,
  error: "",
});

test("central domain-only is used when no tenant domains exist", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_central", "imani");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    invalidateDomainCache();
    const resolved = await resolveTenantPublicDomain(sql, "ten_central", "router_bootstrap");
    assert.equal(resolved.origin, "https://isp.example.com");
    assert.equal(resolved.source, "central");
    const url = await resolveBootstrapUrl(sql, "ten_central", "prv_token");
    assert.equal(url.fetch_url, "https://isp.example.com/api/vpn/routers/prv_token/bootstrap.rsc");
    assert.equal(containsPlaceholder(url.fetch_url), false);
  } finally {
    await close();
  }
});

test("verified subdomain beats central; unverified subdomain falls back", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_sub", "imani");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    await setSetting(sql, "tenant_subdomain_base", "isp.example.com");
    const row = await generateTenantSubdomain(sql, { tenantId: "ten_sub", actorUserId: "usr_p" });
    invalidateDomainCache("ten_sub");
    let resolved = await resolveTenantPublicDomain(sql, "ten_sub", "router_bootstrap");
    assert.equal(resolved.origin, "https://isp.example.com");
    assert.equal(resolved.source, "central");
    assert.match(resolved.warning, /subdomain is not verified/i);

    await verifyTenantDomainDns(sql, { domainId: row!.id, actorUserId: "usr_p", lookup: dnsOk });
    await verifyTenantDomainHttps(sql, { domainId: row!.id, actorUserId: "usr_p", probe: tlsOk });
    invalidateDomainCache("ten_sub");
    resolved = await resolveTenantPublicDomain(sql, "ten_sub", "router_bootstrap");
    assert.equal(resolved.origin, "https://imani.isp.example.com");
    assert.equal(resolved.source, "subdomain");
  } finally {
    await close();
  }
});

test("verified custom beats subdomain; unverified or expired custom is ignored", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_cus", "imani");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    await setSetting(sql, "tenant_subdomain_base", "isp.example.com");
    const sub = await generateTenantSubdomain(sql, { tenantId: "ten_cus", actorUserId: "usr_p" });
    await verifyTenantDomainDns(sql, { domainId: sub!.id, actorUserId: "usr_p", lookup: dnsOk });
    await verifyTenantDomainHttps(sql, { domainId: sub!.id, actorUserId: "usr_p", probe: tlsOk });

    const custom = await setTenantCustomDomain(sql, {
      tenantId: "ten_cus",
      hostname: "portal.imaninetworks.co.ke",
      actorUserId: "usr_p",
    });
    invalidateDomainCache("ten_cus");
    let resolved = await resolveTenantPublicDomain(sql, "ten_cus", "router_bootstrap");
    assert.equal(resolved.origin, "https://imani.isp.example.com");
    assert.equal(resolved.source, "subdomain");

    await verifyTenantDomainDns(sql, { domainId: custom!.id, actorUserId: "usr_p", lookup: dnsOk });
    await verifyTenantDomainHttps(sql, { domainId: custom!.id, actorUserId: "usr_p", probe: tlsOk });
    invalidateDomainCache("ten_cus");
    resolved = await resolveTenantPublicDomain(sql, "ten_cus", "router_bootstrap");
    assert.equal(resolved.origin, "https://portal.imaninetworks.co.ke");
    assert.equal(resolved.source, "custom");

    await sql`update tenant_domains set https_status = 'expired', domain_status = 'cert_expired',
      certificate_expires_at = ${"2020-01-01T00:00:00.000Z"}, is_verified = false, is_active = false
      where id = ${custom!.id}`;
    invalidateDomainCache("ten_cus");
    resolved = await resolveTenantPublicDomain(sql, "ten_cus", "router_bootstrap");
    assert.equal(resolved.source, "subdomain");
    assert.match(resolved.fallback_reason, /certificate/i);

    await disableTenantDomain(sql, { domainId: custom!.id, actorUserId: "usr_p" });
    await removeTenantDomain(sql, { domainId: custom!.id, actorUserId: "usr_p" });
    invalidateDomainCache("ten_cus");
    resolved = await resolveTenantPublicDomain(sql, "ten_cus", "router_bootstrap");
    assert.equal(resolved.origin, "https://imani.isp.example.com");
  } finally {
    await close();
  }
});

test("duplicate hostnames and reserved slugs are rejected", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_a", "imani");
    await seedTenant(sql, "ten_b", "jolinks");
    await setTenantCustomDomain(sql, {
      tenantId: "ten_a",
      hostname: "billing.shared.co.ke",
      actorUserId: "usr_p",
    });
    await assert.rejects(
      () =>
        setTenantCustomDomain(sql, {
          tenantId: "ten_b",
          hostname: "billing.shared.co.ke",
          actorUserId: "usr_p",
        }),
      /another ISP/,
    );
    await setSetting(sql, "tenant_subdomain_base", "isp.example.com");
    await assert.rejects(
      () => generateTenantSubdomain(sql, { tenantId: "ten_a", actorUserId: "usr_p", slug: "www" }),
      /reserved/,
    );
  } finally {
    await close();
  }
});

test("missing or placeholder APP_PUBLIC_URL cannot generate a bootstrap script", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedRouter(sql, "ten_none");
    await setSetting(sql, "app_public_url", "");
    invalidateDomainCache();
    await assert.rejects(() => resolveTenantPublicDomain(sql, "ten_none", "router_bootstrap"), new RegExp("public HTTPS domain"));
    const preview = await previewTenantDomain(sql, "ten_none");
    assert.equal(preview.ok, false);
    assert.match(preview.error, /public HTTPS domain/);
    assert.throws(() => bootstrapFetchUrl("", "prv_x"), /public HTTPS domain/);
    assert.throws(() => bootstrapFetchUrl("https://YOUR-PUBLIC-URL", "prv_x"));
    await assert.rejects(
      () => issueProvisioningToken(sql, { tenantId: "ten_none", routerId: "rtr_ten_none", actorUserId: "usr_a" }),
      new RegExp("public HTTPS domain|public domain"),
    );
  } finally {
    await close();
  }
});

test("issued bootstrap uses the resolved HTTPS domain and never a placeholder", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedRouter(sql, "ten_boot");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    invalidateDomainCache();
    await asRole("ten_boot");
    const issued = await issueProvisioningToken(sql, {
      tenantId: "ten_boot",
      routerId: "rtr_ten_boot",
      actorUserId: "usr_a",
    });
    assert.match(issued.bootstrap, /https:\/\/isp\.example\.com\/api\/vpn\/routers\//);
    assert.match(issued.bootstrap, /check-certificate=no/);
    assert.match(issued.bootstrap, /dst-path="flash\/ispsolutions-bootstrap.rsc"/);
    assert.doesNotMatch(issued.bootstrap, /YOUR-PUBLIC-URL/);
    assert.doesNotMatch(issued.bootstrap, /\{\{BOOTSTRAP_URL\}\}/);
    assert.doesNotMatch(issued.bootstrap, /localhost/);
    assert.doesNotMatch(issued.bootstrap, /check-certificate=yes/);
    assert.equal(issued.fetch_url.includes(issued.token), true);
    assert.equal(issued.domain_source, "central");
    const paste = bootstrapPasteScript({ url: issued.fetch_url });
    assert.doesNotMatch(paste, /YOUR-PUBLIC-URL/);
    await bypass();
    const [stored] = await sql<{ provision_token_hash: string }>`
      select provision_token_hash from routers where id = ${"rtr_ten_boot"}`;
    assert.equal(stored?.provision_token_hash, hashProvisionToken(issued.token));
  } finally {
    await close();
  }
});

test("tenant isolation: tenant B cannot read or use tenant A domains", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_iso_a", "imani");
    await seedTenant(sql, "ten_iso_b", "jolinks");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    const custom = await setTenantCustomDomain(sql, {
      tenantId: "ten_iso_a",
      hostname: "portal.imani.co.ke",
      actorUserId: "usr_p",
    });
    await verifyTenantDomainDns(sql, { domainId: custom!.id, actorUserId: "usr_p", lookup: dnsOk });
    await verifyTenantDomainHttps(sql, { domainId: custom!.id, actorUserId: "usr_p", probe: tlsOk });
    invalidateDomainCache();
    const a = await resolveTenantPublicDomain(sql, "ten_iso_a", "customer_portal");
    const b = await resolveTenantPublicDomain(sql, "ten_iso_b", "customer_portal");
    assert.equal(a.origin, "https://portal.imani.co.ke");
    assert.equal(b.origin, "https://isp.example.com");
    await asRole("ten_iso_b");
    const leaked = await sql<{ hostname: string }>`select hostname from tenant_domains`;
    assert.equal(leaked.some((r) => r.hostname === "portal.imani.co.ke"), false);
    await applyRls(sql, { tenantId: "ten_iso_a", bypass: false });
  } finally {
    await close();
  }
});

test("legacy public_base_url is used only when no central domain is configured", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_legacy", "imani", "https://ops.imani.ke");
    await setSetting(sql, "app_public_url", "");
    invalidateDomainCache();
    const legacy = await resolveTenantPublicDomain(sql, "ten_legacy", "public_api");
    assert.equal(legacy.origin, "https://ops.imani.ke");
    assert.equal(legacy.source, "legacy");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    invalidateDomainCache("ten_legacy");
    const central = await resolveTenantPublicDomain(sql, "ten_legacy", "public_api");
    assert.equal(central.origin, "https://isp.example.com");
    assert.equal(central.source, "central");
  } finally {
    await close();
  }
});

test("payment and portal helpers never return a placeholder", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_pay", "imani");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    invalidateDomainCache();
    const origin = await tenantPublicOriginOrEmpty(sql, "ten_pay", "payment_links");
    assert.equal(origin, "https://isp.example.com");
    assert.equal(containsPlaceholder(origin), false);
    await setSetting(sql, "app_public_url", "");
    invalidateDomainCache();
    assert.equal(await tenantPublicOriginOrEmpty(sql, "ten_pay", "payment_links"), "");
  } finally {
    await close();
  }
});

test("HTTP production URLs are rejected; development localhost is allowed only in preview", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_http", "imani");
    await setSetting(sql, "app_public_url", "http://isp.example.com");
    invalidateDomainCache();
    await assert.rejects(
      () => resolveTenantPublicDomain(sql, "ten_http", "router_bootstrap", { production: true, requireHttps: true }),
      new RegExp("public HTTPS domain"),
    );
    await setSetting(sql, "app_public_url", "http://localhost:3000");
    invalidateDomainCache("ten_http");
    const dev = await resolveTenantPublicDomain(sql, "ten_http", "router_bootstrap", {
      production: false,
      requireHttps: false,
    });
    assert.equal(dev.origin, "http://localhost:3000");
    await assert.rejects(
      () => resolveTenantPublicDomain(sql, "ten_http", "router_bootstrap", { production: true, requireHttps: true }),
      /public HTTPS domain/,
    );
  } finally {
    await close();
  }
});

test("central-domain-only ignores verified tenant domains", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_cdo", "imani");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    await setSetting(sql, "tenant_subdomain_base", "isp.example.com");
    const custom = await setTenantCustomDomain(sql, {
      tenantId: "ten_cdo",
      hostname: "portal.imaninetworks.co.ke",
      actorUserId: "usr_p",
    });
    await verifyTenantDomainDns(sql, { domainId: custom!.id, actorUserId: "usr_p", lookup: dnsOk });
    await verifyTenantDomainHttps(sql, { domainId: custom!.id, actorUserId: "usr_p", probe: tlsOk });
    invalidateDomainCache("ten_cdo");
    assert.equal((await resolveTenantPublicDomain(sql, "ten_cdo", "router_bootstrap")).source, "custom");
    await setSetting(sql, "central_domain_only", "true");
    invalidateDomainCache("ten_cdo");
    const forced = await resolveTenantPublicDomain(sql, "ten_cdo", "router_bootstrap");
    assert.equal(forced.source, "central");
    assert.equal(forced.origin, "https://isp.example.com");
  } finally {
    await close();
  }
});

test("expired custom domain is marked unavailable and cache is invalidated on revoke", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_exp", "imani");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    const custom = await setTenantCustomDomain(sql, {
      tenantId: "ten_exp",
      hostname: "billing.imani.co.ke",
      actorUserId: "usr_p",
    });
    await verifyTenantDomainDns(sql, { domainId: custom!.id, actorUserId: "usr_p", lookup: dnsOk });
    await verifyTenantDomainHttps(sql, { domainId: custom!.id, actorUserId: "usr_p", probe: tlsOk });
    invalidateDomainCache("ten_exp");
    assert.equal((await resolveTenantPublicDomain(sql, "ten_exp", "public_api")).source, "custom");

    await sql`update tenant_domains set certificate_expires_at = ${"2020-01-01T00:00:00.000Z"} where id = ${custom!.id}`;
    invalidateDomainCache("ten_exp");
    const fell = await resolveTenantPublicDomain(sql, "ten_exp", "router_bootstrap");
    assert.equal(fell.source, "central");
    assert.match(fell.fallback_reason, /certificate/i);
    const [marked] = await sql<{ domain_status: string; is_verified: boolean }>`
      select domain_status, is_verified from tenant_domains where id = ${custom!.id}`;
    assert.equal(marked?.domain_status, "cert_expired");
    assert.equal(marked?.is_verified, false);

    await sql`update tenant_domains set
      https_status = 'verified', domain_status = 'active', is_verified = true, is_active = true, is_primary = true,
      certificate_expires_at = ${"2099-01-01T00:00:00.000Z"}
      where id = ${custom!.id}`;
    invalidateDomainCache("ten_exp");
    assert.equal((await resolveTenantPublicDomain(sql, "ten_exp", "public_api")).source, "custom");
    await revokeTenantDomain(sql, { domainId: custom!.id, actorUserId: "usr_p" });
    const afterRevoke = await resolveTenantPublicDomain(sql, "ten_exp", "public_api");
    assert.equal(afterRevoke.source, "central");
  } finally {
    await close();
  }
});

test("resolver cache does not keep a stale custom domain after invalidation", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_cache", "jolinks");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    invalidateDomainCache("ten_cache");
    const first = await resolveTenantPublicDomain(sql, "ten_cache", "public_api");
    assert.equal(first.source, "central");
    await sql`insert into tenant_domains (
        id, tenant_id, hostname, kind, domain_status, dns_status, https_status,
        is_primary, is_active, is_verified, certificate_expires_at
      ) values (
        'tdom_cache', 'ten_cache', 'portal.jolinks.co.ke', 'custom', 'active', 'verified', 'verified',
        true, true, true, ${"2099-01-01T00:00:00.000Z"}
      )`;
    const cached = await resolveTenantPublicDomain(sql, "ten_cache", "public_api");
    assert.equal(cached.source, "central");
    invalidateDomainCache("ten_cache");
    const fresh = await resolveTenantPublicDomain(sql, "ten_cache", "public_api");
    assert.equal(fresh.origin, "https://portal.jolinks.co.ke");
    assert.equal(fresh.source, "custom");
  } finally {
    await close();
  }
});

test("portal, payment, and SMS helpers use the same resolved origin", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedTenant(sql, "ten_links", "finality");
    await setSetting(sql, "app_public_url", "https://isp.example.com");
    invalidateDomainCache("ten_links");
    assert.equal(await resolveTenantPublicUrl(sql, "ten_links", "customer_portal"), "https://isp.example.com/portal");
    assert.equal(await resolveTenantPublicUrl(sql, "ten_links", "payment_links"), "https://isp.example.com/portal/pay");
    assert.equal(await resolveTenantPublicUrl(sql, "ten_links", "sms_links"), "https://isp.example.com/portal");
    const vars = await loadNetworkNotifyContext(sql, "ten_links", "Finality");
    assert.equal(vars.portal_url, "https://isp.example.com/portal");
    assert.equal(vars.pay_url, "https://isp.example.com/portal/pay");
    assert.equal(vars.login_url, "https://isp.example.com");
    assert.equal(vars.portal_url.includes("YOUR-PUBLIC-URL"), false);
  } finally {
    await close();
  }
});
