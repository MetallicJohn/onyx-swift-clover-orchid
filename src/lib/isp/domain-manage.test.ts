import assert from "node:assert/strict";
import { test } from "node:test";
import {
  revokeTenantDomain,
  setTenantCustomDomain,
  verifyTenantDomainDns,
  verifyTenantDomainHttps,
} from "./domain-manage.ts";
import { isDomainUsable } from "./domain-format.ts";
import { openTestDb } from "./test-db.ts";

test("failed DNS or HTTPS does not activate a custom domain", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_fail', 'Fail ISP', 'failisp')`;
    const row = await setTenantCustomDomain(sql, {
      tenantId: "ten_fail",
      hostname: "portal.failisp.co.ke",
      actorUserId: "usr_p",
    });
    const dns = await verifyTenantDomainDns(sql, {
      domainId: row!.id,
      actorUserId: "usr_p",
      lookup: async () => ({ a: [], aaaa: [], cname: [], txt: [] }),
    });
    assert.equal(dns.ok, false);
    assert.equal(dns.domain?.usable, false);
    assert.equal(isDomainUsable(dns.domain!), false);

    await assert.rejects(
      () =>
        verifyTenantDomainHttps(sql, {
          domainId: row!.id,
          actorUserId: "usr_p",
          probe: async () => ({
            ok: true,
            authorized: true,
            subject: "x",
            issuer: "y",
            expiresAt: "2099-01-01T00:00:00.000Z",
            hostMatched: true,
            statusCode: 200,
            error: "",
          }),
        }),
      /Verify DNS/,
    );

    const [audit] = await sql<{ n: number }>`
      select count(*)::int as n from platform_audit_log where action = 'platform.domain.dns_failed' and entity_id = ${row!.id}`;
    assert.equal((audit?.n ?? 0) > 0, true);
  } finally {
    await close();
  }
});

test("HTTPS failure after DNS does not activate; revoke stops use immediately", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_https', 'HTTPS ISP', 'httpsisp')`;
    await sql`insert into platform_settings (key, value, updated_at) values ('app_public_url', 'https://isp.example.com', now())
      on conflict (key) do update set value = 'https://isp.example.com', updated_at = now()`;
    const row = await setTenantCustomDomain(sql, {
      tenantId: "ten_https",
      hostname: "portal.httpsisp.co.ke",
      actorUserId: "usr_p",
    });
    const dnsOk = async () => ({ a: ["203.0.113.10"], aaaa: [] as string[], cname: ["isp.example.com"], txt: [["x"]] });
    const dns = await verifyTenantDomainDns(sql, {
      domainId: row!.id,
      actorUserId: "usr_p",
      lookup: dnsOk,
    });
    assert.equal(dns.ok, true);
    const https = await verifyTenantDomainHttps(sql, {
      domainId: row!.id,
      actorUserId: "usr_p",
      probe: async () => ({
        ok: false,
        authorized: false,
        subject: "",
        issuer: "",
        expiresAt: null,
        hostMatched: false,
        statusCode: null,
        error: "Certificate hostname does not match",
      }),
    });
    assert.equal(https.ok, false);
    assert.equal(https.domain?.usable, false);
    assert.equal(https.domain?.domain_status, "https_failed");

    const ok = await verifyTenantDomainHttps(sql, {
      domainId: row!.id,
      actorUserId: "usr_p",
      probe: async () => ({
        ok: true,
        authorized: true,
        subject: "portal.httpsisp.co.ke",
        issuer: "le",
        expiresAt: "2099-01-01T00:00:00.000Z",
        hostMatched: true,
        statusCode: 200,
        error: "",
      }),
    });
    assert.equal(ok.ok, true);
    const revoked = await revokeTenantDomain(sql, { domainId: row!.id, actorUserId: "usr_p" });
    assert.equal(revoked?.domain_status, "revoked");
    assert.equal(revoked?.is_verified, false);
    const [audit] = await sql<{ n: number }>`
      select count(*)::int as n from platform_audit_log where action = 'platform.domain.revoked' and entity_id = ${row!.id}`;
    assert.equal((audit?.n ?? 0) > 0, true);
  } finally {
    await close();
  }
});
