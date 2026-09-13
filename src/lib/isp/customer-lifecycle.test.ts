import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customerTraffic,
  deleteCustomer,
  deleteService,
  reassignService,
  updateService,
} from "./customer-lifecycle.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into customers (id, tenant_id, name, phone)
    values ('cus_a1', 'ten_a', 'Amina', '0712001001'),
           ('cus_a2', 'ten_a', 'Brian', '0712001002'),
           ('cus_b1', 'ten_b', 'Other', '0712001999')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
    values ('pkg_a', 'ten_a', 'Home 10', 'pppoe', 10, 5, 2500),
           ('pkg_a2', 'ten_a', 'Home 20', 'pppoe', 20, 10, 4000),
           ('pkg_b', 'ten_b', 'Other 10', 'pppoe', 10, 10, 1)`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, mac_address)
    values ('svc_keep', 'ten_a', 'cus_a1', 'pkg_a', 'pppoe', 'amina', 'active', 'AABBCCDDEEFF'),
           ('svc_drop', 'ten_a', 'cus_a1', 'pkg_a', 'pppoe', 'amina2', 'active', ''),
           ('svc_b', 'ten_b', 'cus_b1', 'pkg_b', 'pppoe', 'other', 'active', '')`;
}

test("delete service keeps the customer and does not touch other ISPs", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const out = await deleteService(sql, "ten_a", "svc_drop");
    assert.equal(out.customer_id, "cus_a1");
    const [gone] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_drop'`;
    const [kept] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_keep'`;
    const [cus] = await sql<{ n: number }>`select count(*)::int as n from customers where id = 'cus_a1'`;
    assert.equal(gone?.n, 0);
    assert.equal(kept?.n, 1);
    assert.equal(cus?.n, 1);
    await bypass();
    const [other] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_b'`;
    assert.equal(other?.n, 1);
  } finally {
    await close();
  }
});

test("reassign then delete customer keeps the moved line and drops leftover lines", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const moved = await reassignService(sql, "ten_a", "svc_keep", "cus_a2");
    assert.equal(moved.from, "cus_a1");
    assert.equal(moved.to, "cus_a2");
    const del = await deleteCustomer(sql, "ten_a", "cus_a1");
    assert.equal(del.services_removed, 1);
    const [amina] = await sql<{ n: number }>`select count(*)::int as n from customers where id = 'cus_a1'`;
    const [brian] = await sql<{ n: number }>`select count(*)::int as n from customers where id = 'cus_a2'`;
    const [kept] = await sql<{ customer_id: string }>`select customer_id from services where id = 'svc_keep'`;
    const [dropped] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_drop'`;
    assert.equal(amina?.n, 0);
    assert.equal(brian?.n, 1);
    assert.equal(kept?.customer_id, "cus_a2");
    assert.equal(dropped?.n, 0);
  } finally {
    await close();
  }
});

test("cannot reassign a line onto another ISP's customer", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await assert.rejects(() => reassignService(sql, "ten_a", "svc_keep", "cus_b1"), /Customer not found/);
  } finally {
    await close();
  }
});

test("update service writes MAC and package; traffic reads live accounting", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
      values ('ses_a', 'ten_a', 'amina', '10.10.10.8', '10.200.0.2', 5000, 9000)`;
    await asRole("ten_a");
    await updateService(sql, "ten_a", { id: "svc_keep", package_id: "pkg_a2", mac_address: "aa-bb-cc-dd-ee-ff" });
    const [row] = await sql<{ package_id: string; mac_address: string }>`
      select package_id, mac_address from services where id = 'svc_keep'`;
    assert.equal(row?.package_id, "pkg_a2");
    assert.equal(row?.mac_address, "AA:BB:CC:DD:EE:FF");
    const traffic = await customerTraffic(sql, "ten_a", "cus_a1");
    const live = traffic.lines.find((l) => l.service_id === "svc_keep");
    assert.equal(live?.online, true);
    assert.equal(live?.framed_ip, "10.10.10.8");
    assert.equal(live?.bytes_out, 9000);
    assert.equal(traffic.source, "radius-accounting");
  } finally {
    await close();
  }
});
