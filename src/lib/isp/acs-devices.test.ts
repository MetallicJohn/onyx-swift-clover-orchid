import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addManualAcsDevice,
  assignAcsDevice,
  queryAcsDeviceDesk,
  searchAcsAssignmentTargets,
  searchAvailableAcsDevices,
  unassignAcsDevice,
} from "./acs-devices.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
    values ('cus_a1', 'ten_a', 'Amina Otieno', '0712001001', 'amina@example.com', 'CUST-A1'),
           ('cus_a2', 'ten_a', 'Brian Mwangi', '0712001002', 'brian@example.com', 'CUST-A2'),
           ('cus_b1', 'ten_b', 'Other ISP', '0712001999', 'other@example.com', 'CUST-B1')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
    values ('pkg_a', 'ten_a', 'Home 20', 'pppoe', 20, 10, 2500),
           ('pkg_b', 'ten_b', 'Other 10', 'pppoe', 10, 10, 1)`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, account_number, static_ip)
    values ('svc_a1', 'ten_a', 'cus_a1', 'pkg_a', 'pppoe', 'amina', 'active', 'SRV-A1', ''),
           ('svc_a2', 'ten_a', 'cus_a2', 'pkg_a', 'pppoe', 'brian', 'active', 'SRV-A2', '10.8.0.22'),
           ('svc_a1b', 'ten_a', 'cus_a1', 'pkg_a', 'pppoe', 'amina-extra', 'active', 'SRV-A1B', ''),
           ('svc_b1', 'ten_b', 'cus_b1', 'pkg_b', 'pppoe', 'other', 'active', 'SRV-B1', '')`;
  await sql`insert into cpe_devices (id, tenant_id, serial, product_class, manufacturer, model, status, acs_device_id, source, last_inform)
    values ('cpe_free', 'ten_a', 'SN-FREE', 'F670L', 'ZTE', 'F670L', 'online', '1A2B3C-F670L-SN-FREE', 'nbi', now()),
           ('cpe_busy', 'ten_a', 'SN-BUSY', 'F670L', 'ZTE', 'F670L', 'offline', '1A2B3C-F670L-SN-BUSY', 'nbi', now() - interval '2 hours'),
           ('cpe_b', 'ten_b', 'SN-B', 'HG8245', 'Huawei', 'HG8245', 'online', '1A2B3C-HG8245-SN-B', 'nbi', now())`;
}

test("device desk search is tenant-scoped and lists unassigned devices without forcing a query", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const desk = await queryAcsDeviceDesk(sql, "ten_a", { q: "SN-FREE" });
    assert.ok(desk.devices.some((d) => d.serial === "SN-FREE"));
    assert.ok(desk.devices.every((d) => d.serial !== "SN-B"));
    const available = await searchAvailableAcsDevices(sql, "ten_a", "");
    assert.ok(available.some((d) => d.id === "cpe_free"));
    const bySerial = await searchAvailableAcsDevices(sql, "ten_a", "sn-free");
    assert.equal(bySerial[0]?.id, "cpe_free");
    await asRole("ten_b");
    const other = await searchAvailableAcsDevices(sql, "ten_b", "SN-FREE");
    assert.equal(other.length, 0);
  } finally {
    await close();
  }
});

test("assignment search matches name, phone, customer number and service number", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const byName = await searchAcsAssignmentTargets(sql, "ten_a", "AMINA");
    assert.equal(byName[0]?.customer_id, "cus_a1");
    assert.equal(byName[0]?.service_id, "svc_a1");
    const byPhone = await searchAcsAssignmentTargets(sql, "ten_a", "0712001002");
    assert.ok(byPhone.some((h) => h.customer_id === "cus_a2"));
    const byCust = await searchAcsAssignmentTargets(sql, "ten_a", "cust-a1");
    assert.ok(byCust.some((h) => h.service_account === "SRV-A1"));
    const bySvc = await searchAcsAssignmentTargets(sql, "ten_a", "srv-a2");
    assert.ok(bySvc.some((h) => h.service_id === "svc_a2"));
    const byUser = await searchAcsAssignmentTargets(sql, "ten_a", "brian");
    assert.ok(byUser.some((h) => h.username === "brian"));
    assert.equal((await searchAcsAssignmentTargets(sql, "ten_a", "a")).length, 0);
    await asRole("ten_b");
    assert.equal((await searchAcsAssignmentTargets(sql, "ten_b", "amina")).length, 0);
  } finally {
    await close();
  }
});

test("assign, reassign, duplicate prevention, and deleted customer rejection", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const first = await assignAcsDevice(sql, "ten_a", "cpe_free", "cus_a1", "svc_a1", {
      actorId: "usr_1",
      actorLabel: "Amina Staff",
    });
    assert.equal(first.moved, true);
    const [row] = await sql<{ customer_id: string; service_id: string }>`
      select customer_id, service_id from cpe_devices where id = 'cpe_free'`;
    assert.equal(row?.customer_id, "cus_a1");
    assert.equal(row?.service_id, "svc_a1");
    await assert.rejects(
      () => assignAcsDevice(sql, "ten_a", "cpe_busy", "cus_a1", "svc_a1"),
      /already has/i,
    );
    const extra = await assignAcsDevice(sql, "ten_a", "cpe_busy", "cus_a1", "svc_a1b");
    assert.equal(extra.to_service, "svc_a1b");
    await assert.rejects(
      () => assignAcsDevice(sql, "ten_a", "cpe_free", "cus_a2", "svc_a2"),
      /already assigned/i,
    );
    const moved = await assignAcsDevice(sql, "ten_a", "cpe_free", "cus_a2", "svc_a2", { confirmMove: true, reason: "Swap site" });
    assert.equal(moved.to_service, "svc_a2");
    await sql`update customers set deleted_at = now() where id = 'cus_a1'`;
    await assert.rejects(
      () => assignAcsDevice(sql, "ten_a", "cpe_busy", "cus_a1", "svc_a1", { confirmMove: true }),
      /not found/i,
    );
    await sql`update services set deleted_at = now() where id = 'svc_a2'`;
    await assert.rejects(
      () => assignAcsDevice(sql, "ten_a", "cpe_busy", "cus_a2", "svc_a2", { confirmMove: true }),
      /service not found/i,
    );
    await assert.rejects(() => assignAcsDevice(sql, "ten_a", "cpe_busy", "cus_b1", "svc_b1"), /not found/i);
    const dropped = await unassignAcsDevice(sql, "ten_a", "cpe_free");
    assert.equal(dropped.from_service, "svc_a2");
    const [after] = await sql<{ service_id: string | null }>`select service_id from cpe_devices where id = 'cpe_free'`;
    assert.equal(after?.service_id, null);
    const [still] = await sql<{ username: string; status: string }>`select username, status from services where id = 'svc_a1'`;
    assert.equal(still?.username, "amina");
    assert.equal(still?.status, "active");
    const [invoices] = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = 'ten_a'`;
    assert.equal(invoices?.n ?? 0, 0);
  } finally {
    await close();
  }
});

test("manual add is not marked online and stays on this tenant", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const added = await addManualAcsDevice(sql, "ten_a", {
      serial: "SN-MANUAL",
      manufacturer: "ZTE",
      model: "F670L",
      notes: "Warehouse spare",
    });
    assert.equal(added.status, "unknown");
    assert.equal(added.source, "manual");
    const [row] = await sql<{ status: string; last_inform: string | null; tenant_id: string }>`
      select status, last_inform::text as last_inform, tenant_id from cpe_devices where id = ${added.id}`;
    assert.equal(row?.status, "unknown");
    assert.equal(row?.last_inform, null);
    assert.equal(row?.tenant_id, "ten_a");
    await assert.rejects(() => addManualAcsDevice(sql, "ten_a", { serial: "SN-MANUAL" }), /already/);
  } finally {
    await close();
  }
});
