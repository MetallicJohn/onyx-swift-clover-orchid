import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyDnsRecord, verifyHttpsCertificate, type DnsLookupResult } from "./domain-verify.ts";

const empty: DnsLookupResult = { a: [], aaaa: [], cname: [], txt: [] };

test("DNS verification accepts matching TXT, CNAME, or A records", async () => {
  const txt = await verifyDnsRecord(
    {
      hostname: "portal.imani.co.ke",
      expectedTxt: "token-1",
      expectedTxtName: "_isp-solutions-verification.portal.imani.co.ke",
      systemHost: "isp.example.com",
    },
    async (host) => {
      if (host.startsWith("_isp-solutions-verification")) {
        return { ...empty, txt: [["token-1"]] };
      }
      return { ...empty, a: ["203.0.113.10"] };
    },
  );
  assert.equal(txt.ok, true);
  assert.equal(txt.method, "txt");

  const cname = await verifyDnsRecord(
    { hostname: "portal.imani.co.ke", systemHost: "isp.example.com" },
    async () => ({ ...empty, cname: ["isp.example.com"] }),
  );
  assert.equal(cname.ok, true);
  assert.equal(cname.method, "cname");

  const a = await verifyDnsRecord(
    { hostname: "portal.imani.co.ke", systemHost: "isp.example.com", systemIps: ["203.0.113.9"] },
    async () => ({ ...empty, a: ["203.0.113.9"] }),
  );
  assert.equal(a.ok, true);
  assert.equal(a.method, "a");
});

test("DNS verification fails on NXDOMAIN, wrong target, and private IPs", async () => {
  const missing = await verifyDnsRecord(
    { hostname: "portal.imani.co.ke", systemHost: "isp.example.com" },
    async () => empty,
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /does not resolve/);

  const wrong = await verifyDnsRecord(
    { hostname: "portal.imani.co.ke", systemHost: "isp.example.com", systemIps: ["203.0.113.9"] },
    async () => ({ ...empty, a: ["198.51.100.2"] }),
  );
  assert.equal(wrong.ok, false);

  const priv = await verifyDnsRecord(
    { hostname: "portal.imani.co.ke", systemHost: "isp.example.com", production: true },
    async () => ({ ...empty, a: ["10.0.0.8"] }),
  );
  assert.equal(priv.ok, false);
  assert.match(priv.error, /private/i);
});

test("HTTPS verification requires a trusted, unexpired, matching certificate", async () => {
  const ok = await verifyHttpsCertificate("portal.imani.co.ke", async () => ({
    ok: true,
    authorized: true,
    subject: "portal.imani.co.ke",
    issuer: "Let's Encrypt",
    expiresAt: "2099-01-01T00:00:00.000Z",
    hostMatched: true,
    statusCode: 200,
    error: "",
  }));
  assert.equal(ok.ok, true);

  const expired = await verifyHttpsCertificate("portal.imani.co.ke", async () => ({
    ok: false,
    authorized: true,
    subject: "portal.imani.co.ke",
    issuer: "Let's Encrypt",
    expiresAt: "2020-01-01T00:00:00.000Z",
    hostMatched: true,
    statusCode: 200,
    error: "Certificate expired",
  }));
  assert.equal(expired.ok, false);
  assert.match(expired.error, /expired/i);

  const mismatch = await verifyHttpsCertificate("portal.imani.co.ke", async () => ({
    ok: false,
    authorized: true,
    subject: "other.example",
    issuer: "Let's Encrypt",
    expiresAt: "2099-01-01T00:00:00.000Z",
    hostMatched: false,
    statusCode: 200,
    error: "Certificate hostname does not match",
  }));
  assert.equal(mismatch.ok, false);
});
