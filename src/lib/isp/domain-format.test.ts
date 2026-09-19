import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MISSING_PUBLIC_DOMAIN,
  RESERVED_SUBDOMAIN_LABELS,
  assertUsableHttpsOrigin,
  bootstrapScriptForbiddenReason,
  bootstrapUrl,
  canActivateDomain,
  containsPlaceholder,
  defaultPathForPurpose,
  domainSourceLabel,
  isDomainUsable,
  isInternalHostname,
  isLoopbackHostname,
  isPlaceholderHostname,
  isPrivateIpv4,
  isValidSlug,
  joinPublicUrl,
  normalizeHostname,
  parsePublicOrigin,
  reservedSlugReason,
  subdomainHostname,
  txtVerificationName,
} from "./domain-format.ts";

test("hostname normalize strips scheme, path, port, and case", () => {
  assert.equal(normalizeHostname("https://Portal.Imani.co.ke/app"), "portal.imani.co.ke");
  assert.equal(normalizeHostname("IMANI.isp.example.com."), "imani.isp.example.com");
  assert.equal(normalizeHostname("ops.imani.ke:443"), "ops.imani.ke");
});

test("parsePublicOrigin accepts hosts and full URLs", () => {
  assert.equal(parsePublicOrigin("https://isp.example.com/portal")?.origin, "https://isp.example.com");
  assert.equal(parsePublicOrigin("imani.isp.example.com")?.protocol, "https:");
  assert.equal(parsePublicOrigin("ftp://x"), null);
});

test("reserved slugs and invalid slug characters are rejected", () => {
  for (const s of ["www", "admin", "api", "app", "platform", "mail", "support", "status"]) {
    assert.equal(RESERVED_SUBDOMAIN_LABELS.has(s), true);
    assert.match(reservedSlugReason(s), /reserved/);
    assert.equal(isValidSlug(s), false);
  }
  assert.equal(isValidSlug("imani"), true);
  assert.equal(isValidSlug("Imani"), false);
  assert.equal(isValidSlug("ima ni"), false);
  assert.equal(isValidSlug("imani/app"), false);
  assert.equal(isValidSlug("https://imani"), false);
  assert.equal(subdomainHostname("imani", "isp.example.com"), "imani.isp.example.com");
});

test("internal, loopback, docker, and placeholder hosts are never public", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isPrivateIpv4("10.0.0.1"), true);
  assert.equal(isPrivateIpv4("192.168.1.8"), true);
  assert.equal(isPrivateIpv4("172.16.4.1"), true);
  assert.equal(isInternalHostname("postgres"), true);
  assert.equal(isInternalHostname("genieacs"), true);
  assert.equal(isInternalHostname("app.internal"), true);
  assert.equal(isPlaceholderHostname("YOUR-PUBLIC-URL"), true);
  assert.equal(isInternalHostname("isp.example.com"), false);
});

test("usable domain requires verified DNS, HTTPS, active, and unexpired cert", () => {
  const base = {
    hostname: "portal.imani.co.ke",
    kind: "custom",
    domain_status: "active",
    dns_status: "verified",
    https_status: "verified",
    is_active: true,
    is_verified: true,
    certificate_expires_at: "2099-01-01T00:00:00.000Z",
  };
  assert.equal(isDomainUsable(base), true);
  assert.equal(isDomainUsable({ ...base, is_verified: false }), false);
  assert.equal(isDomainUsable({ ...base, domain_status: "pending" }), false);
  assert.equal(isDomainUsable({ ...base, dns_status: "failed" }), false);
  assert.equal(isDomainUsable({ ...base, https_status: "failed" }), false);
  assert.equal(isDomainUsable({ ...base, certificate_expires_at: "2020-01-01T00:00:00.000Z" }), false);
  assert.equal(canActivateDomain({ ...base, domain_status: "https_verified" }), true);
});

test("bootstrap URL join never invents a host", () => {
  assert.equal(
    bootstrapUrl("https://isp.example.com", "prv_abc"),
    "https://isp.example.com/api/vpn/routers/prv_abc/bootstrap.rsc",
  );
  assert.equal(joinPublicUrl("", "/portal"), "");
  assert.equal(defaultPathForPurpose("customer_portal"), "/portal");
  assert.equal(defaultPathForPurpose("payment_links"), "/portal/pay");
  assert.equal(defaultPathForPurpose("router_bootstrap"), "");
  assert.equal(containsPlaceholder("https://YOUR-PUBLIC-URL/x"), true);
  assert.equal(containsPlaceholder("url={{BOOTSTRAP_URL}}"), true);
});

test("production origin assertion rejects http, localhost, and placeholders", () => {
  assert.doesNotThrow(() => assertUsableHttpsOrigin("https://isp.example.com"));
  assert.throws(() => assertUsableHttpsOrigin("http://isp.example.com"), /HTTPS/);
  assert.throws(() => assertUsableHttpsOrigin("https://localhost"), /localhost/);
  assert.throws(() => assertUsableHttpsOrigin("https://YOUR-PUBLIC-URL"), /Placeholder|valid public HTTPS/i);
  assert.throws(() => assertUsableHttpsOrigin(""), new RegExp(MISSING_PUBLIC_DOMAIN.slice(0, 20)));
  assert.doesNotThrow(() =>
    assertUsableHttpsOrigin("http://localhost:3000", { allowLoopback: true, requireHttps: false }),
  );
});

test("bootstrap script scanner blocks placeholders, not certificate skip", () => {
  const ok = `/tool fetch url="https://isp.example.com/api/vpn/routers/prv/bootstrap.rsc" mode=https check-certificate=no;`;
  assert.equal(bootstrapScriptForbiddenReason(ok), "");
  assert.match(
    bootstrapScriptForbiddenReason(`/tool fetch url="https://YOUR-PUBLIC-URL/x" mode=https check-certificate=no;`),
    /placeholder/i,
  );
  assert.equal(
    bootstrapScriptForbiddenReason(`/tool fetch url="https://isp.example.com/x" mode=https check-certificate=no;`),
    "",
  );
  assert.match(
    bootstrapScriptForbiddenReason(`/tool fetch url="http://127.0.0.1:8080/x" mode=https check-certificate=yes;`),
    /localhost/,
  );
  assert.equal(
    bootstrapScriptForbiddenReason(`/tool fetch url="http://localhost:3000/x" mode=https check-certificate=yes;`, {
      allowLoopback: true,
    }),
    "",
  );
});

test("source labels and TXT name", () => {
  assert.equal(domainSourceLabel("custom"), "Verified custom domain");
  assert.equal(domainSourceLabel("subdomain"), "Verified tenant subdomain");
  assert.equal(domainSourceLabel("central"), "Central application domain");
  assert.equal(txtVerificationName("portal.imani.co.ke"), "_isp-solutions-verification.portal.imani.co.ke");
});
