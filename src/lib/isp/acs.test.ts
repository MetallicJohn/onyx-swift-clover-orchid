import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acsConnection,
  queueAcsTask,
  saveAcsConfig,
  syncAcsDevices,
} from "./acs.ts";
import { genieDeviceId, nbiTaskBody, serialFromGenieDevice } from "./acs-nbi.ts";
import { openTestDb } from "./test-db.ts";

test("GenieACS device id and SSID task body", () => {
  assert.equal(genieDeviceId("1a2b3c", "F670L", "ZTE123"), "1A2B3C-F670L-ZTE123");
  const body = nbiTaskBody("setSsid", { ssid: "Imani-Home" });
  assert.equal(body.name, "setParameterValues");
  assert.equal(serialFromGenieDevice({ _deviceId: { _SerialNumber: "ABC" }, _id: "x" }), "ABC");
});

function mockNbi(opts?: { failPost?: boolean; devices?: Record<string, unknown>[] }) {
  const calls: { url: string; method: string; body: string }[] = [];
  const devices = opts?.devices ?? [
    {
      _id: "1A2B3C-F670L-SN001",
      _lastInform: new Date().toISOString(),
      _deviceId: { _OUI: "1A2B3C", _ProductClass: "F670L", _SerialNumber: "SN001" },
    },
  ];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url, method, body: String(init?.body || "") });
    if (url.includes("/tasks")) {
      if (opts?.failPost) return new Response("offline", { status: 504 });
      return new Response(JSON.stringify({ _id: "task_1" }), { status: 200 });
    }
    return new Response(JSON.stringify(devices), { status: 200 });
  };
  return { fetchImpl, calls };
}

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_acs', 'Fibre', 'fibre')`;
  await sql`insert into cpe_devices (id, tenant_id, serial, product_class, ssid)
    values ('cpe_1', 'ten_acs', 'SN001', 'F670L', 'Old')`;
}

test("queued reboot stays queued until NBI is configured, then dispatches", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    const queued = await queueAcsTask(sql, "ten_acs", "cpe_1", "reboot", {});
    assert.equal(queued.status, "queued");
    assert.equal(queued.result, "waiting_for_nbi");
    const { fetchImpl, calls } = mockNbi();
    await saveAcsConfig(sql, "ten_acs", { nbiUrl: "http://genieacs:7557", user: "", oui: "1a2b3c" });
    const sent = await queueAcsTask(sql, "ten_acs", "cpe_1", "reboot", {}, { fetch: fetchImpl });
    assert.equal(sent.status, "sent");
    assert.equal(calls.some((c) => c.url.includes("/devices/") && c.url.includes("/tasks")), true);
    assert.match(calls.find((c) => c.body.includes("reboot"))?.body || "", /"name":"reboot"/);
    const conn = await acsConnection(sql, "ten_acs", fetchImpl);
    assert.equal(conn.configured, true);
    assert.equal(conn.reachable, true);
  } finally {
    await close();
  }
});

test("SSID task posts both TR-069 paths and sync upserts from NBI", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await saveAcsConfig(sql, "ten_acs", { nbiUrl: "http://nbi.local", user: "", oui: "1A2B3C" });
    const { fetchImpl, calls } = mockNbi();
    const sent = await queueAcsTask(sql, "ten_acs", "cpe_1", "setSsid", { ssid: "Imani-Home" }, { fetch: fetchImpl });
    assert.equal(sent.status, "sent");
    const body = calls.find((c) => c.body.includes("setParameterValues"))?.body || "";
    assert.match(body, /InternetGatewayDevice\.LANDevice/);
    assert.match(body, /Device\.WiFi\.SSID/);
    const [cpe] = await sql<{ ssid: string }>`select ssid from cpe_devices where id = 'cpe_1'`;
    assert.equal(cpe?.ssid, "Imani-Home");
    const sync = await syncAcsDevices(sql, "ten_acs", fetchImpl);
    assert.equal(sync.upserted, 1);
    const [after] = await sql<{ acs_device_id: string; status: string }>`
      select acs_device_id, status from cpe_devices where serial = 'SN001'`;
    assert.equal(after?.acs_device_id, "1A2B3C-F670L-SN001");
    assert.equal(after?.status, "online");
  } finally {
    await close();
  }
});
