import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { generateAcsCredentials, saveAcsCredentialSettings } from "./acs-credentials.ts";
import { buildAcsUrl } from "./acs-ports.ts";
import {
  acsSecurityFromPlatform,
  applyGenieAcsCwmp,
  applyGenieAcsSecurity,
  authorizedAcsEdge,
  CWMP_AUTH_DIGEST,
  handleAcsAuthRequest,
  loadGenieAcsCwmp,
  LOCK_URL_SCRIPT,
  lookupAcsAuth,
  rewriteAcsUrls,
  safeEqual,
} from "./acs-security.ts";
import { loadAcsPlatformSettings } from "./acs-ports.ts";
import { SERVICE_PROVISION_SCRIPT } from "./acs-service-provision.ts";
import { openTestDb } from "./test-db.ts";

function authRequest(body: unknown, token = "edge-secret") {
  return new Request("http://web/api/internal/acs-auth", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("timing-safe compare and edge token reject empty or wrong secrets", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
  const prev = process.env.ACS_EDGE_TOKEN;
  process.env.ACS_EDGE_TOKEN = "edge-secret";
  try {
    assert.equal(authorizedAcsEdge(new Request("http://x", { headers: { authorization: "Bearer edge-secret" } })), true);
    assert.equal(authorizedAcsEdge(new Request("http://x", { headers: { authorization: "Bearer other" } })), false);
    assert.equal(authorizedAcsEdge(new Request("http://x")), false);
  } finally {
    if (prev == null) delete process.env.ACS_EDGE_TOKEN;
    else process.env.ACS_EDGE_TOKEN = prev;
  }
});

test("ACS URL lock script writes TR-098 and TR-181 ManagementServer.URL", () => {
  assert.match(LOCK_URL_SCRIPT, /InternetGatewayDevice\.ManagementServer\.URL/);
  assert.match(LOCK_URL_SCRIPT, /Device\.ManagementServer\.URL/);
  assert.match(LOCK_URL_SCRIPT, /ConnectionRequestUsername/);
  assert.match(LOCK_URL_SCRIPT, /ext\("ispsolutions", "acsUrlFor"/);
  assert.match(CWMP_AUTH_DIGEST, /EXT\("ispsolutions", "passwordFor", USERNAME\)/);
  const init = readFileSync(new URL("../../../deploy/vps/genieacs/init-config.js", import.meta.url), "utf8");
  assert.ok(init.includes(LOCK_URL_SCRIPT.trim()));
  assert.ok(init.includes(SERVICE_PROVISION_SCRIPT.trim()));
  assert.match(init, /cwmp\.connectionRequestAllowBasicAuth/);
  assert.match(init, /cwmp\.debug/);
});

test("lookup rejects unknown, disabled, and cross-ISP usernames; does not audit informs", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  const prev = process.env.ACS_EDGE_TOKEN;
  process.env.ACS_EDGE_TOKEN = "edge-secret";
  try {
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_public_host', '203.0.113.10')
      on conflict (key) do update set value = '203.0.113.10'`;
    await sql`insert into tenants (id, name, slug) values ('ten_sec_a', 'A', 'sec-a'), ('ten_sec_b', 'B', 'sec-b')`;
    await asRole("ten_sec_a");
    const a = await generateAcsCredentials(sql, { tenantId: "ten_sec_a", slug: "sec-a" });
    await asRole("ten_sec_b");
    const b = await generateAcsCredentials(sql, { tenantId: "ten_sec_b", slug: "sec-b" });
    await bypass();
    const hit = await lookupAcsAuth(sql, a.username, "password");
    assert.equal(hit.ok, true);
    if (hit.ok) assert.equal(hit.password, a.password);
    const other = await lookupAcsAuth(sql, b.username, "profile");
    assert.equal(other.ok, true);
    if (other.ok) {
      assert.equal(other.password, b.password);
      assert.notEqual(other.password, a.password);
      assert.equal(other.url, b.cwmp_url);
      assert.equal(other.connreq_user, b.connreq_user);
      assert.equal(other.connreq_password, b.connreq_password);
    }
    assert.equal((await lookupAcsAuth(sql, "tenant_missing")).ok, false);
    await asRole("ten_sec_a");
    await saveAcsCredentialSettings(sql, "ten_sec_a", { enabled: false });
    await bypass();
    assert.equal((await lookupAcsAuth(sql, a.username)).ok, false);
    const res = await handleAcsAuthRequest(sql, authRequest({ username: b.username, kind: "password" }));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; password?: string };
    assert.equal(json.ok, true);
    assert.equal(json.password, b.password);
    const denied = await handleAcsAuthRequest(sql, authRequest({ username: b.username }, "wrong"));
    assert.equal(denied.status, 401);
    const [audit] = await sql<{ n: number }>`select count(*)::int as n from audit_logs where action like 'acs.auth%' or action like 'acs.inform%'`;
    assert.equal(audit?.n ?? 0, 0);
  } finally {
    if (prev == null) delete process.env.ACS_EDGE_TOKEN;
    else process.env.ACS_EDGE_TOKEN = prev;
    await close();
  }
});

test("HTTPS scheme rewrites issued ACS URLs; checklist reflects platform flags", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_public_host', 'acs.example.com')
      on conflict (key) do update set value = 'acs.example.com'`;
    await sql`insert into tenants (id, name, slug) values ('ten_sec_h', 'H', 'sec-h')`;
    const plat = await loadAcsPlatformSettings(sql);
    assert.equal(plat.acs_tls, "http");
    assert.equal(plat.acs_require_cpe_auth, true);
    assert.equal(plat.acs_lock_url, true);
    await asRole("ten_sec_h");
    const first = await generateAcsCredentials(sql, { tenantId: "ten_sec_h", slug: "sec-h" });
    assert.equal(first.cwmp_url, "http://acs.example.com:7551/");
    const list = acsSecurityFromPlatform(plat, first);
    assert.equal(list.items.find((i) => i.id === "digest")?.ok, true);
    assert.equal(list.items.find((i) => i.id === "scheme")?.ok, false);
    assert.equal(list.items.find((i) => i.id === "lock")?.ok, true);
    assert.equal(list.items.find((i) => i.id === "service")?.ok, true);
    assert.equal(list.items.find((i) => i.id === "nbi")?.ok, true);
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_tls', 'https')
      on conflict (key) do update set value = 'https'`;
    await rewriteAcsUrls(sql);
    await asRole("ten_sec_h");
    const { loadAcsCredentials } = await import("./acs-credentials.ts");
    const next = await loadAcsCredentials(sql, "ten_sec_h");
    assert.equal(next?.cwmp_url, "https://acs.example.com:7551/");
    assert.equal(buildAcsUrl("10.0.0.5", 7552, "https"), "https://10.0.0.5:7552/");
  } finally {
    await close();
  }
});

test("applyGenieAcsSecurity puts URL-lock provision/preset and digest auth expression", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      calls.push({ url, method, body: String(init?.body || "") });
      return new Response("", { status: 200 });
    };
    const nbi = { nbiUrl: "http://genieacs:7557", user: "", pass: "", oui: "" };
    const on = await applyGenieAcsSecurity(sql, { nbi, fetchImpl });
    assert.equal(on.ok, true);
    assert.ok(on.steps.includes("provision"));
    assert.ok(on.steps.includes("preset"));
    assert.ok(on.steps.includes("service-provision"));
    assert.ok(on.steps.includes("service-preset"));
    assert.match(calls.find((c) => c.url.includes("/provisions/ispsolutions-lock-url"))?.body || "", /ManagementServer\.URL/);
    assert.match(calls.find((c) => c.url.includes("/presets/ispsolutions-lock-url"))?.body || "", /ispsolutions-lock-url/);
    assert.match(calls.find((c) => c.url.includes("/provisions/ispsolutions-service"))?.body || "", /WLANConfiguration/);
    assert.match(calls.find((c) => c.url.includes("cwmp.auth"))?.body || "", /passwordFor/);
    assert.match(calls.find((c) => c.url.includes("cwmp.connectionRequestAuth"))?.body || "", /AUTH\(username, password\)/);
    assert.match(calls.find((c) => c.url.includes("cwmp.connectionRequestAllowBasicAuth"))?.body || "", /true/);
    assert.match(calls.find((c) => c.url.includes("cwmp.debug"))?.body || "", /false/);
    await sql`insert into platform_settings (key, value) values ('acs_lock_url', 'false')
      on conflict (key) do update set value = 'false'`;
    calls.length = 0;
    const off = await applyGenieAcsSecurity(sql, { nbi, fetchImpl });
    assert.equal(off.steps.includes("preset-off"), true);
    assert.equal(calls.some((c) => c.url.includes("/presets/") && c.method === "DELETE"), true);
  } finally {
    await close();
  }
});

test("applyGenieAcsCwmp rewrites ACS URLs and reads cwmp.* config", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_public_host', 'acs.example.com')
      on conflict (key) do update set value = 'acs.example.com'`;
    await sql`insert into tenants (id, name, slug) values ('ten_cwmp', 'Cwmp', 'cwmp-isp')`;
    await asRole("ten_cwmp");
    const creds = await generateAcsCredentials(sql, { tenantId: "ten_cwmp", slug: "cwmp-isp" });
    assert.equal(creds.cwmp_url, "http://acs.example.com:7551/");
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_public_host', 'acs2.example.com')
      on conflict (key) do update set value = 'acs2.example.com'`;
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: (init?.method || "GET").toUpperCase() });
      if ((init?.method || "GET").toUpperCase() === "GET" && url.includes("/config/")) {
        return new Response(
          JSON.stringify([
            { _id: "cwmp.auth", value: 'AUTH(USERNAME, EXT("ispsolutions", "passwordFor", USERNAME))' },
            { _id: "cwmp.debug", value: "false" },
            { _id: "ui.pageSize", value: "10" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 200 });
    };
    const nbi = { nbiUrl: "http://genieacs:7557", user: "", pass: "", oui: "" };
    const result = await applyGenieAcsCwmp(sql, { nbi, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.rewritten, 1);
    assert.equal(result.cwmp.values["cwmp.auth"]?.includes("passwordFor"), true);
    assert.equal(result.cwmp.values["cwmp.debug"], "false");
    assert.equal(result.cwmp.values["ui.pageSize"], undefined);
    const [row] = await sql<{ cwmp_url: string; public_host: string }>`
      select cwmp_url, public_host from acs_isp_credentials where tenant_id = 'ten_cwmp'`;
    assert.equal(row?.public_host, "acs2.example.com");
    assert.equal(row?.cwmp_url, "http://acs2.example.com:7551/");
    const snap = await loadGenieAcsCwmp({ nbi, fetchImpl });
    assert.equal(snap.ok, true);
    assert.ok(calls.some((c) => c.method === "GET" && c.url.includes("/config/")));
  } finally {
    await close();
  }
});
