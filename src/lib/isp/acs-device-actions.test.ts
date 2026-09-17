import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAcsWifi, readAcsOptical, retryAcsTask, runAcsDeviceAction, sanitizeAuditDetails } from "./acs-device-actions.ts";
import { ACS_FACTORY_RESET_PHRASE } from "./acs-device-format.ts";
import { saveAcsConfig } from "./acs.ts";
import { hasPermission } from "./rbac.ts";
import { openTestDb } from "./test-db.ts";

function mockNbi(opts?: { failPost?: boolean; device?: Record<string, unknown> | null }) {
  const calls: { url: string; method: string; body: string }[] = [];
  const device = opts?.device ?? {
    _id: "1A2B3C-F670L-SN001",
    _lastInform: new Date().toISOString(),
    InternetGatewayDevice: {
      LANDevice: { "1": { WLANConfiguration: { "1": { SSID: { _value: "Imani-Home" } } } } },
      WANDevice: {
        "1": {
          "X_ZTE-COM_WANPONInterfaceConfig": { RXPower: { _value: "-1850" }, TXPower: { _value: "250" } },
        },
      },
    },
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url, method, body: String(init?.body || "") });
    if (url.includes("/tasks") && method === "POST") {
      if (opts?.failPost) return new Response("offline", { status: 504 });
      return new Response(JSON.stringify({ _id: "task_1" }), { status: 200 });
    }
    if (opts?.device === null) return new Response("[]", { status: 200 });
    return new Response(JSON.stringify([device]), { status: 200 });
  };
  return { fetchImpl, calls };
}

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_acs', 'Fibre', 'fibre')`;
  await sql`insert into cpe_devices (id, tenant_id, serial, product_class, manufacturer, model, acs_device_id, status, source)
    values ('cpe_1', 'ten_acs', 'SN001', 'F670L', 'ZTE', 'F670L', '1A2B3C-F670L-SN001', 'offline', 'nbi')`;
  await saveAcsConfig(sql, "ten_acs", { nbiUrl: "http://genieacs:7557", user: "", oui: "1A2B3C" });
}

test("wifi task is not successful until the device reports the SSID; password is not audited", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    const { fetchImpl, calls } = mockNbi();
    const out = await applyAcsWifi(
      sql,
      "ten_acs",
      "cpe_1",
      { ssid: "Imani-Home", password: "supersecret1", confirm: true, band: "2.4", security: "WPA2" },
      { actor: { id: "usr_1", label: "Net" }, fetch: fetchImpl },
    );
    assert.equal(out.nbi_accepted, true);
    assert.equal(out.verified, true);
    assert.equal(out.phase, "verified");
    const body = calls.find((c) => c.body.includes("setParameterValues"))?.body || "";
    assert.match(body, /Imani-Home/);
    assert.match(body, /supersecret1/);
    const [task] = await sql<{ payload: string; phase: string }>`
      select payload, coalesce(nullif(phase,''), status) as phase from acs_tasks where cpe_id = 'cpe_1' order by created_at desc limit 1`;
    assert.equal(task?.payload.includes("supersecret1"), false);
    assert.equal(task?.phase, "verified");
    const sanitized = sanitizeAuditDetails({ ssid: "Imani-Home", password: "supersecret1", pass_ref: "enc:v1:x" });
    assert.equal("password" in sanitized, false);
    assert.equal("pass_ref" in sanitized, false);
  } finally {
    await close();
  }
});

test("offline devices wait for Inform instead of claiming success", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    const { fetchImpl } = mockNbi({ failPost: true });
    const out = await runAcsDeviceAction(sql, "ten_acs", "cpe_1", "reboot", {}, { confirm: true, fetch: fetchImpl });
    assert.equal(out.phase, "waiting_for_inform");
    assert.equal(out.nbi_accepted, false);
    await assert.rejects(
      () => runAcsDeviceAction(sql, "ten_acs", "cpe_1", "reboot", {}, { fetch: fetchImpl }),
      /confirm/i,
    );
    await assert.rejects(
      () => runAcsDeviceAction(sql, "ten_acs", "cpe_1", "factoryReset", {}, { confirm: true, fetch: fetchImpl }),
      /RESET/,
    );
    const reset = await runAcsDeviceAction(
      sql,
      "ten_acs",
      "cpe_1",
      "factoryReset",
      {},
      { confirm: true, confirmPhrase: ACS_FACTORY_RESET_PHRASE, fetch: fetchImpl },
    );
    assert.equal(reset.kind, "factoryReset");
  } finally {
    await close();
  }
});

test("optical read uses device parameters and does not invent values", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    const { fetchImpl } = mockNbi();
    const optical = await readAcsOptical(sql, "ten_acs", "cpe_1", { fetch: fetchImpl });
    assert.equal(optical.available, true);
    assert.equal(optical.metrics.find((m) => m.key === "rx")?.value, "-18.50");
    const empty = mockNbi({ device: { _id: "1A2B3C-F670L-SN001" } });
    const missing = await readAcsOptical(sql, "ten_acs", "cpe_1", { fetch: empty.fetchImpl });
    assert.equal(missing.available, false);
    assert.match(missing.message, /not exposed/i);
  } finally {
    await close();
  }
});

test("failed wifi task can be retried; duplicate in-flight actions are blocked", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    const fail = mockNbi({ failPost: true });
    const first = await applyAcsWifi(
      sql,
      "ten_acs",
      "cpe_1",
      { ssid: "RetryNet", confirm: true },
      { fetch: fail.fetchImpl },
    );
    assert.equal(first.verified, false);
    await assert.rejects(
      () => applyAcsWifi(sql, "ten_acs", "cpe_1", { ssid: "Hold", confirm: true }, { fetch: fail.fetchImpl }),
      /already in progress/i,
    );
    const ok = mockNbi();
    const retried = await retryAcsTask(sql, "ten_acs", first.id, { fetch: ok.fetchImpl });
    assert.equal(retried.kind, "setWifi");
  } finally {
    await close();
  }
});

test("RBAC: finance and technicians cannot control devices; network staff can", () => {
  assert.equal(hasPermission("network_engineer", "acs.devices.view"), true);
  assert.equal(hasPermission("network_engineer", "acs.devices.wifi.manage"), true);
  assert.equal(hasPermission("network_engineer", "acs.devices.factory_reset"), true);
  assert.equal(hasPermission("customer_care", "acs.devices.assign"), true);
  assert.equal(hasPermission("customer_care", "acs.devices.reboot"), false);
  assert.equal(hasPermission("technician", "acs.devices.view"), true);
  assert.equal(hasPermission("technician", "acs.devices.wifi.manage"), false);
  assert.equal(hasPermission("finance", "acs.devices.view"), false);
  assert.equal(hasPermission("support", "acs.devices.optical.view"), true);
});
