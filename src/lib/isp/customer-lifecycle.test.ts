import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customerTraffic,
  deleteCustomer,
  deleteService,
  listAssignedServices,
  loadCustomerRecord,
  reassignService,
  searchReassignCustomers,
  updateService,
} from "./customer-lifecycle.ts";
import { hasPermission } from "./rbac.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into customers (id, tenant_id, name, phone, notes)
    values ('cus_a1', 'ten_a', 'Amina', '0712001001', 'Home in Kasarani'),
           ('cus_a2', 'ten_a', 'Brian', '0712001002', ''),
           ('cus_b1', 'ten_b', 'Other', '0712001999', '')`;
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
    assert.equal(out.customer_kept, true);
    const [gone] = await sql<{ deleted_at: string | null }>`
      select deleted_at::text as deleted_at from services where id = 'svc_drop'`;
    const [kept] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_keep' and deleted_at is null`;
    const [cus] = await sql<{ n: number }>`select count(*)::int as n from customers where id = 'cus_a1' and deleted_at is null`;
    assert.ok(gone?.deleted_at);
    assert.equal(kept?.n, 1);
    assert.equal(cus?.n, 1);
    await bypass();
    const [other] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_b'`;
    assert.equal(other?.n, 1);
  } finally {
    await close();
  }
});

test("customer deletion is blocked while services remain", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const assigned = await listAssignedServices(sql, "ten_a", "cus_a1");
    assert.equal(assigned.length, 2);
    await assert.rejects(() => deleteCustomer(sql, "ten_a", "cus_a1"), /still assigned/);
    const [cus] = await sql<{ n: number }>`select count(*)::int as n from customers where id = 'cus_a1'`;
    const [svcs] = await sql<{ n: number }>`select count(*)::int as n from services where customer_id = 'cus_a1'`;
    assert.equal(cus?.n, 1);
    assert.equal(svcs?.n, 2);
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
    const del = await deleteCustomer(sql, "ten_a", "cus_a1", { deleteServices: true });
    assert.equal(del.services_removed, 1);
    const [amina] = await sql<{ deleted_at: string | null }>`
      select deleted_at::text as deleted_at from customers where id = 'cus_a1'`;
    const [brian] = await sql<{ n: number }>`select count(*)::int as n from customers where id = 'cus_a2' and deleted_at is null`;
    const [kept] = await sql<{ customer_id: string; deleted_at: string | null }>`
      select customer_id, deleted_at::text as deleted_at from services where id = 'svc_keep'`;
    const [dropped] = await sql<{ deleted_at: string | null }>`
      select deleted_at::text as deleted_at from services where id = 'svc_drop'`;
    assert.ok(amina?.deleted_at);
    assert.equal(brian?.n, 1);
    assert.equal(kept?.customer_id, "cus_a2");
    assert.equal(kept?.deleted_at, null);
    assert.ok(dropped?.deleted_at);
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
    const [row] = await sql<{ customer_id: string }>`select customer_id from services where id = 'svc_keep'`;
    assert.equal(row?.customer_id, "cus_a1");
  } finally {
    await close();
  }
});

test("reassignment preserves invoices and payments on the original customer", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_a', 'ten_a', 'cus_a1', 'INV-A1', 2500, 'paid', '2026-09-01')`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
      values ('pay_a', 'ten_a', 'cus_a1', 'inv_a', 'mpesa', 2500, 'TX-A1', 'confirmed')`;
    await asRole("ten_a");
    await reassignService(sql, "ten_a", "svc_keep", "cus_a2");
    await reassignService(sql, "ten_a", "svc_drop", "cus_a2");
    const [inv] = await sql<{ customer_id: string; amount_kes: number }>`
      select customer_id, amount_kes from invoices where id = 'inv_a'`;
    const [pay] = await sql<{ customer_id: string }>`select customer_id from payments where id = 'pay_a'`;
    assert.equal(inv?.customer_id, "cus_a1");
    assert.equal(inv?.amount_kes, 2500);
    assert.equal(pay?.customer_id, "cus_a1");
    const del = await deleteCustomer(sql, "ten_a", "cus_a1");
    assert.equal(del.archived, true);
    assert.equal(del.services_removed, 0);
    const [stillInv] = await sql<{ n: number }>`select count(*)::int as n from invoices where id = 'inv_a'`;
    const [stillPay] = await sql<{ n: number }>`select count(*)::int as n from payments where id = 'pay_a'`;
    const [archived] = await sql<{ deleted_at: string | null; status: string }>`
      select deleted_at::text as deleted_at, status from customers where id = 'cus_a1'`;
    assert.equal(stillInv?.n, 1);
    assert.equal(stillPay?.n, 1);
    assert.ok(archived?.deleted_at);
    assert.equal(archived?.status, "deleted");
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
    await updateService(sql, "ten_a", { id: "svc_keep", package_id: "pkg_a2", mac_address: "aa-bb-cc-dd-ee-ff", notes: "CPE on roof" });
    const [row] = await sql<{ package_id: string; mac_address: string; notes: string }>`
      select package_id, mac_address, notes from services where id = 'svc_keep'`;
    assert.equal(row?.package_id, "pkg_a2");
    assert.equal(row?.mac_address, "AA:BB:CC:DD:EE:FF");
    assert.equal(row?.notes, "CPE on roof");
    const traffic = await customerTraffic(sql, "ten_a", "cus_a1");
    const live = traffic.lines.find((l) => l.service_id === "svc_keep");
    assert.equal(live?.online, true);
    assert.equal(live?.framed_ip, "10.10.10.8");
    assert.equal(live?.bytes_out, 9000);
    assert.equal(live?.download_mbps, 20);
    assert.equal(traffic.source, "radius-accounting");
    const idle = traffic.lines.find((l) => l.service_id === "svc_drop");
    assert.equal(idle?.online, false);
  } finally {
    await close();
  }
});

test("customer record is tenant scoped and lists notes", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_b");
    await assert.rejects(() => loadCustomerRecord(sql, "ten_b", "cus_a1"), /Customer not found/);
    await asRole("ten_a");
    const rec = await loadCustomerRecord(sql, "ten_a", "cus_a1");
    assert.equal(rec.customer.name, "Amina");
    assert.equal(rec.customer.notes, "Home in Kasarani");
    assert.equal(rec.services.length, 2);
    assert.ok(rec.packages.length >= 1);
  } finally {
    await close();
  }
});

test("RBAC maps view/delete/reassign/traffic onto existing roles", () => {
  assert.equal(hasPermission("customer_care", "services.delete"), true);
  assert.equal(hasPermission("customer_care", "services.reassign"), true);
  assert.equal(hasPermission("customer_care", "traffic.view"), true);
  assert.equal(hasPermission("network_engineer", "services.delete"), true);
  assert.equal(hasPermission("finance", "services.delete"), false);
  assert.equal(hasPermission("finance", "traffic.view"), true);
  assert.equal(hasPermission("technician", "customers.manage"), false);
  assert.equal(hasPermission("technician", "services.reassign"), false);
  assert.equal(hasPermission("technician", "traffic.view"), true);
  assert.equal(hasPermission("support", "customers.manage"), false);
});

test("confirmed customer delete with leftover services tears them down", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const del = await deleteCustomer(sql, "ten_a", "cus_a1", { deleteServices: true });
    assert.equal(del.services_removed, 2);
    assert.equal(del.archived, true);
    const [svcs] = await sql<{ n: number }>`
      select count(*)::int as n from services where customer_id = 'cus_a1' and deleted_at is null`;
    const [cus] = await sql<{ deleted_at: string | null }>`
      select deleted_at::text as deleted_at from customers where id = 'cus_a1'`;
    assert.equal(svcs?.n, 0);
    assert.ok(cus?.deleted_at);
    await bypass();
    const [stillOther] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_b'`;
    assert.equal(stillOther?.n, 1);
  } finally {
    await close();
  }
});

test("destination search is case-insensitive, tenant-scoped, and skips the current customer", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`update customers set account_number = 'CUST-A1', email = 'amina@example.com', address = 'Kasarani' where id = 'cus_a1'`;
    await sql`update customers set account_number = 'CUST-A2', email = 'brian@example.com' where id = 'cus_a2'`;
    await sql`update customers set account_number = 'CUST-B1' where id = 'cus_b1'`;
    await sql`update services set account_number = 'SVC-KEEP' where id = 'svc_keep'`;
    await asRole("ten_a");
    const byName = await searchReassignCustomers(sql, "ten_a", "AMINA", { excludeCustomerId: "cus_a2" });
    assert.equal(byName.length, 1);
    assert.equal(byName[0]?.id, "cus_a1");
    const byAccount = await searchReassignCustomers(sql, "ten_a", "cust-a2");
    assert.ok(byAccount.some((c) => c.id === "cus_a2"));
    const byPhone = await searchReassignCustomers(sql, "ten_a", "0712001002");
    assert.ok(byPhone.some((c) => c.id === "cus_a2"));
    const byLast9 = await searchReassignCustomers(sql, "ten_a", "254712001002");
    assert.ok(byLast9.some((c) => c.id === "cus_a2"));
    const byEmail = await searchReassignCustomers(sql, "ten_a", "amina@example.com");
    assert.ok(byEmail.some((c) => c.id === "cus_a1"));
    const byService = await searchReassignCustomers(sql, "ten_a", "SVC-KEEP");
    assert.ok(byService.some((c) => c.id === "cus_a1"));
    assert.equal(byName[0]?.active_services, 2);
    const excluded = await searchReassignCustomers(sql, "ten_a", "amina", { excludeCustomerId: "cus_a1" });
    assert.ok(excluded.every((c) => c.id !== "cus_a1"));
    assert.equal(await searchReassignCustomers(sql, "ten_a", "a").then((r) => r.length), 0);
    await sql`update customers set status = 'inactive' where id = 'cus_a2'`;
    const inactive = await searchReassignCustomers(sql, "ten_a", "brian");
    assert.ok(inactive.every((c) => c.id !== "cus_a2"));
    await sql`update customers set status = 'active', deleted_at = now() where id = 'cus_a2'`;
    const live = await searchReassignCustomers(sql, "ten_a", "brian");
    assert.ok(live.every((c) => c.id !== "cus_a2"));
    await asRole("ten_b");
    const other = await searchReassignCustomers(sql, "ten_b", "amina");
    assert.equal(other.length, 0);
  } finally {
    await close();
  }
});

test("reassignment preserves credentials, expiry, status, and billing history", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`update services set period_end = '2026-10-30T20:59:59.999+03:00', account_number = 'SVC-KEEP', status = 'active'
      where id = 'svc_keep'`;
    await sql`insert into invoices (id, tenant_id, customer_id, service_id, number, amount_kes, status, due_date)
      values ('inv_keep', 'ten_a', 'cus_a1', 'svc_keep', 'INV-KEEP', 2500, 'issued', '2026-10-01')`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
      values ('pay_keep', 'ten_a', 'cus_a1', 'inv_keep', 'mpesa', 2500, 'TX-KEEP', 'confirmed')`;
    await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
      values ('ntf_keep', 'ten_a', 'cus_a1', 'service.created.active', 'sms', 'svc_keep', 'Hi', 'Hi', '0712001001', 'sent')`;
    await asRole("ten_a");
    const first = await reassignService(sql, "ten_a", "svc_keep", "cus_a2", { reason: "Moved site" });
    assert.equal(first.from, "cus_a1");
    assert.equal(first.to, "cus_a2");
    assert.equal(first.moved, true);
    assert.equal(first.username, "amina");
    assert.equal(first.service_account, "SVC-KEEP");
    assert.equal(first.reason, "Moved site");
    const again = await reassignService(sql, "ten_a", "svc_keep", "cus_a2");
    assert.equal(again.moved, false);
    const [svc] = await sql<{
      customer_id: string;
      username: string | null;
      status: string;
      account_number: string;
      period_end: string | null;
      package_id: string;
    }>`select customer_id, username, status, coalesce(account_number,'') as account_number,
              period_end::text as period_end, package_id
       from services where id = 'svc_keep'`;
    assert.equal(svc?.customer_id, "cus_a2");
    assert.equal(svc?.username, "amina");
    assert.equal(svc?.status, "active");
    assert.equal(svc?.account_number, "SVC-KEEP");
    assert.equal(svc?.package_id, "pkg_a");
    assert.ok(svc?.period_end?.startsWith("2026-10-30"));
    const [otherLine] = await sql<{ customer_id: string }>`select customer_id from services where id = 'svc_drop'`;
    assert.equal(otherLine?.customer_id, "cus_a1");
    const [inv] = await sql<{ customer_id: string; service_id: string | null }>`
      select customer_id, service_id from invoices where id = 'inv_keep'`;
    const [pay] = await sql<{ customer_id: string }>`select customer_id from payments where id = 'pay_keep'`;
    assert.equal(inv?.customer_id, "cus_a1");
    assert.equal(inv?.service_id, "svc_keep");
    assert.equal(pay?.customer_id, "cus_a1");
    const sms = await sql<{ n: number }>`select count(*)::int as n from notification_logs where tenant_id = 'ten_a' and id = 'ntf_keep'`;
    assert.equal(sms[0]?.n, 1);
    const extra = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs where tenant_id = 'ten_a' and created_at > now() - interval '1 minute' and id <> 'ntf_keep'`;
    assert.equal(extra[0]?.n, 0);
    await assert.rejects(() => reassignService(sql, "ten_a", "svc_keep", ""), /destination customer/i);
    await sql`update customers set status = 'inactive' where id = 'cus_a1'`;
    await assert.rejects(() => reassignService(sql, "ten_a", "svc_keep", "cus_a1"), /not available/);
  } finally {
    await close();
  }
});
