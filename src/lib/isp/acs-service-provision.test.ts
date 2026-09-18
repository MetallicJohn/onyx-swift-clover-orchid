import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAcsCredentials, saveAcsCredentialSettings } from "./acs-credentials.ts";
import { applyGenieAcsSecurity, handleAcsAuthRequest } from "./acs-security.ts";
import { assignAcsDevice } from "./acs-devices.ts";
import {
  SERVICE_PROVISION_SCRIPT,
  ensureServiceWifi,
  lookupAcsServiceProfile,
  sanitizeWifiSsid,
  suggestServiceSsid,
} from "./acs-service-provision.ts";
import { applyAcsWifi } from "./acs-device-actions.ts";
import { saveAcsConfig } from "./acs.ts";
import { seal } from "./secrets.ts";
import { openTestDb } from "./test-db.ts";

function authRequest(body: unknown, token = "edge-secret") {
  return new Request("http://web/api/internal/acs-auth", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("SSID sanitise and suggest stay within Wi-Fi limits", () => {
  assert.equal(sanitizeWifiSsid("  Home\nNet  "), "HomeNet");
  assert.equal(sanitizeWifiSsid("Home   Fibre"), "Home Fibre");
  assert.equal(sanitizeWifiSsid("x".repeat(40)).length, 32);
  assert.equal(suggestServiceSsid({ customerName: "Amina Otieno", accountNumber: "SRV-A1" }), "Amina-RVA1");
  assert.equal(suggestServiceSsid({}), "WiFi");
});

test("service provision script writes WAN and Wi-Fi on both TR-098 and TR-181", () => {
  assert.match(SERVICE_PROVISION_SCRIPT, /DeviceID\.SerialNumber/);
  assert.match(SERVICE_PROVISION_SCRIPT, /ext\("ispsolutions", "serviceFor", username, serial\)/);
  assert.match(SERVICE_PROVISION_SCRIPT, /WANPPPConnection\.1\.Username/);
  assert.match(SERVICE_PROVISION_SCRIPT, /Device\.PPP\.Interface\.1\.Username/);
  assert.match(SERVICE_PROVISION_SCRIPT, /WLANConfiguration\.1\.SSID/);
  assert.match(SERVICE_PROVISION_SCRIPT, /Device\.WiFi\.SSID\.1\.SSID/);
  assert.match(SERVICE_PROVISION_SCRIPT, /KeyPassphrase/);
  assert.match(SERVICE_PROVISION_SCRIPT, /if \(p && p\.wan_username && p\.wan_password\)/);
  assert.match(SERVICE_PROVISION_SCRIPT, /if \(p && p\.ssid\)/);
  assert.match(SERVICE_PROVISION_SCRIPT, /if \(p && p\.wifi_password\)/);
});

async function seedTenants(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into platform_settings (key, value) values ('acs_public_host', '203.0.113.10')
    on conflict (key) do update set value = '203.0.113.10'`;
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
    values ('cus_a1', 'ten_a', 'Amina Otieno', '0712001001', 'amina@example.com', 'CUST-A1'),
           ('cus_b1', 'ten_b', 'Other ISP', '0712001999', 'other@example.com', 'CUST-B1')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
    values ('pkg_a', 'ten_a', 'Home 20', 'pppoe', 20, 10, 2500),
           ('pkg_hot', 'ten_a', 'Hotspot', 'hotspot', 5, 5, 500),
           ('pkg_b', 'ten_b', 'Other 10', 'pppoe', 10, 10, 1)`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, account_number)
    values ('svc_a1', 'ten_a', 'cus_a1', 'pkg_a', 'pppoe', 'amina', 'active', 'SRV-A1'),
           ('svc_hot', 'ten_a', 'cus_a1', 'pkg_hot', 'hotspot', 'hotspot1', 'active', 'SRV-HOT'),
           ('svc_b1', 'ten_b', 'cus_b1', 'pkg_b', 'pppoe', 'other', 'active', 'SRV-B1')`;
  await sql`insert into cpe_devices (id, tenant_id, serial, product_class, manufacturer, model, status, acs_device_id, source)
    values ('cpe_free', 'ten_a', 'SN-FREE', 'F670L', 'ZTE', 'F670L', 'online', '1A2B3C-F670L-SN-FREE', 'nbi'),
           ('cpe_b', 'ten_b', 'SN-FREE', 'HG8245', 'Huawei', 'HG8245', 'online', '1A2B3C-HG8245-SN-FREE', 'nbi')`;
  await sql`insert into radius_accounts (id, tenant_id, service_id, username, password)
    values ('rad_a1', 'ten_a', 'svc_a1', 'amina', ${seal("pppoe-secret")}),
           ('rad_b1', 'ten_b', 'svc_b1', 'other', ${seal("other-secret")})`;
}

test("lookup skips unassigned, other tenants, disabled ACS, and hotspot WAN", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  const prev = process.env.ACS_EDGE_TOKEN;
  process.env.ACS_EDGE_TOKEN = "edge-secret";
  try {
    await bypass();
    await seedTenants(sql);
    await asRole("ten_a");
    const a = await generateAcsCredentials(sql, { tenantId: "ten_a", slug: "alpha" });
    await asRole("ten_b");
    const b = await generateAcsCredentials(sql, { tenantId: "ten_b", slug: "beta" });
    await bypass();
    const empty = await lookupAcsServiceProfile(sql, a.username, "SN-FREE");
    assert.equal(empty.ok, true);
    if (empty.ok) {
      assert.equal(empty.assigned, false);
      assert.equal(empty.wan_username, "");
      assert.equal(empty.ssid, "");
    }
    await asRole("ten_a");
    await assignAcsDevice(sql, "ten_a", "cpe_free", "cus_a1", "svc_a1");
    await bypass();
    const hit = await lookupAcsServiceProfile(sql, a.username, "SN-FREE");
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.assigned, true);
      assert.equal(hit.wan_username, "amina");
      assert.equal(hit.wan_password, "pppoe-secret");
      assert.ok(hit.ssid);
      assert.equal(hit.wifi_password.length >= 8, true);
    }
    const other = await lookupAcsServiceProfile(sql, b.username, "SN-FREE");
    assert.equal(other.ok, true);
    if (other.ok) {
      assert.equal(other.assigned, false);
      assert.equal(other.wan_password, "");
    }
    await asRole("ten_a");
    await saveAcsCredentialSettings(sql, "ten_a", { enabled: false });
    await bypass();
    assert.equal((await lookupAcsServiceProfile(sql, a.username, "SN-FREE")).ok, false);
    assert.equal((await lookupAcsServiceProfile(sql, "tenant_missing", "SN-FREE")).ok, false);
    await asRole("ten_a");
    await saveAcsCredentialSettings(sql, "ten_a", { enabled: true });
    await sql`update cpe_devices set service_id = 'svc_hot' where id = 'cpe_free'`;
    await bypass();
    const hot = await lookupAcsServiceProfile(sql, a.username, "SN-FREE");
    assert.equal(hot.ok, true);
    if (hot.ok) {
      assert.equal(hot.assigned, true);
      assert.equal(hot.wan_username, "");
      assert.equal(hot.wan_password, "");
    }
    const res = await handleAcsAuthRequest(
      sql,
      authRequest({ username: b.username, kind: "service", serial: "SN-FREE" }),
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ok: boolean; assigned?: boolean; wan_password?: string };
    assert.equal(json.ok, true);
    assert.equal(json.assigned, false);
    assert.equal(json.wan_password, "");
    const [audit] = await sql<{ n: number }>`select count(*)::int as n from audit_logs where action like 'acs.auth%' or action like 'acs.inform%'`;
    assert.equal(audit?.n ?? 0, 0);
  } finally {
    if (prev == null) delete process.env.ACS_EDGE_TOKEN;
    else process.env.ACS_EDGE_TOKEN = prev;
    await close();
  }
});

test("ensureServiceWifi is idempotent and does not rotate an existing password", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTenants(sql);
    await asRole("ten_a");
    const first = await ensureServiceWifi(sql, "ten_a", "svc_a1", { customerName: "Amina Otieno", accountNumber: "SRV-A1" });
    assert.equal(first.ssid, "Amina-RVA1");
    assert.equal(first.password.length >= 8, true);
    const again = await ensureServiceWifi(sql, "ten_a", "svc_a1");
    assert.equal(again.ssid, first.ssid);
    assert.equal(again.password, first.password);
    const named = await ensureServiceWifi(sql, "ten_a", "svc_a1", { ssid: "HomeFibre", password: "supersecret1" });
    assert.equal(named.ssid, "HomeFibre");
    assert.equal(named.password, "supersecret1");
  } finally {
    await close();
  }
});

test("staff Wi-Fi change on an assigned device updates the service used on Inform", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedTenants(sql);
    await saveAcsConfig(sql, "ten_a", { nbiUrl: "http://genieacs:7557", user: "", oui: "1A2B3C" });
    await asRole("ten_a");
    await assignAcsDevice(sql, "ten_a", "cpe_free", "cus_a1", "svc_a1");
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.includes("/tasks") && (init?.method || "GET").toUpperCase() === "POST") {
        return new Response(JSON.stringify({ _id: "task_1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            _id: "1A2B3C-F670L-SN-FREE",
            InternetGatewayDevice: {
              LANDevice: { "1": { WLANConfiguration: { "1": { SSID: { _value: "DeskNet" } } } } },
            },
          },
        ]),
        { status: 200 },
      );
    };
    await applyAcsWifi(
      sql,
      "ten_a",
      "cpe_free",
      { ssid: "DeskNet", password: "deskpass12", confirm: true, band: "2.4", security: "WPA2" },
      { fetch: fetchImpl },
    );
    const [row] = await sql<{ wifi_ssid: string }>`select wifi_ssid from services where id = 'svc_a1'`;
    assert.equal(row?.wifi_ssid, "DeskNet");
    await bypass();
    const a = await generateAcsCredentials(sql, { tenantId: "ten_a", slug: "alpha" });
    const profile = await lookupAcsServiceProfile(sql, a.username, "SN-FREE");
    assert.equal(profile.ok, true);
    if (profile.ok) {
      assert.equal(profile.ssid, "DeskNet");
      assert.equal(profile.wifi_password, "deskpass12");
    }
  } finally {
    await close();
  }
});

test("applyGenieAcsSecurity uploads the service provision and can turn the preset off", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: (init?.method || "GET").toUpperCase(), body: String(init?.body || "") });
      return new Response("", { status: 200 });
    };
    const nbi = { nbiUrl: "http://genieacs:7557", user: "", pass: "", oui: "" };
    const on = await applyGenieAcsSecurity(sql, { nbi, fetchImpl });
    assert.equal(on.ok, true);
    assert.ok(on.steps.includes("service-provision"));
    assert.ok(on.steps.includes("service-preset"));
    assert.match(calls.find((c) => c.url.includes("/provisions/ispsolutions-service"))?.body || "", /WANPPPConnection/);
    await sql`insert into platform_settings (key, value) values ('acs_provision_service', 'false')
      on conflict (key) do update set value = 'false'`;
    calls.length = 0;
    const off = await applyGenieAcsSecurity(sql, { nbi, fetchImpl });
    assert.equal(off.steps.includes("service-preset-off"), true);
    assert.equal(calls.some((c) => c.url.includes("/presets/ispsolutions-service") && c.method === "DELETE"), true);
  } finally {
    await close();
  }
});
