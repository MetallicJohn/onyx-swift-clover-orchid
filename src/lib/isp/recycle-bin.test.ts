import assert from "node:assert/strict";
import { test } from "node:test";
import { generateRecurringInvoices } from "./billing.ts";
import { resolveAudience } from "./comms.ts";
import { deleteCustomer, deleteService, loadCustomerRecord, reassignService } from "./customer-lifecycle.ts";
import { hasPermission } from "./rbac.ts";
import {
  archiveCustomer,
  archiveService,
  listRecycleBin,
  PERMANENT_DELETE_PHRASE,
  purgeCustomer,
  purgeService,
  recycleCounts,
  restoreCustomer,
  restoreService,
} from "./recycle-bin.ts";
import { openTestDb } from "./test-db.ts";

const actor = { actorId: "usr_jane", actorLabel: "Jane", reason: "Left coverage" };

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
  await sql`insert into customers (id, tenant_id, name, phone, account_number, notes, status)
    values ('cus_a1', 'ten_a', 'Amina', '0712001001', 'ACC-A1', 'Home in Kasarani', 'active'),
           ('cus_a2', 'ten_a', 'Brian', '0712001002', 'ACC-A2', '', 'active'),
           ('cus_b1', 'ten_b', 'Other', '0712001999', 'ACC-B1', '', 'active')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval)
    values ('pkg_a', 'ten_a', 'Home 10', 'pppoe', 10, 5, 2500, 'monthly'),
           ('pkg_a2', 'ten_a', 'Home 20', 'pppoe', 20, 10, 4000, 'monthly'),
           ('pkg_b', 'ten_b', 'Other 10', 'pppoe', 10, 10, 1, 'monthly')`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status)
    values ('svc_keep', 'ten_a', 'cus_a1', 'pkg_a', 'pppoe', 'amina', null, 'active'),
           ('svc_drop', 'ten_a', 'cus_a1', 'pkg_a', 'pppoe', 'amina2', null, 'active'),
           ('svc_exp', 'ten_a', 'cus_a2', 'pkg_a2', 'pppoe', 'brian', null, 'active'),
           ('svc_b', 'ten_b', 'cus_b1', 'pkg_b', 'pppoe', 'other', null, 'active')`;
  await sql`update services set period_end = now() + interval '20 days' where id in ('svc_keep','svc_drop')`;
  await sql`update services set period_end = now() - interval '3 days', access_until = now() - interval '3 days', expiry_source = 'staff' where id = 'svc_exp'`;
}

test("deleted customers and services stay in the Recycle Bin and leave live searches", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveService(sql, "ten_a", "svc_drop", actor);
    const [live] = await sql<{ n: number }>`
      select count(*)::int as n from services where tenant_id = 'ten_a' and deleted_at is null`;
    assert.equal(live?.n, 2);
    const rec = await loadCustomerRecord(sql, "ten_a", "cus_a1");
    assert.equal(rec.services.some((s) => s.id === "svc_drop"), false);
    await archiveCustomer(sql, "ten_a", "cus_a1", { ...actor, archiveServices: true });
    await assert.rejects(() => loadCustomerRecord(sql, "ten_a", "cus_a1"), /Customer not found/);
    const [liveCus] = await sql<{ n: number }>`
      select count(*)::int as n from customers where tenant_id = 'ten_a' and deleted_at is null`;
    assert.equal(liveCus?.n, 1);
    const bin = await listRecycleBin(sql, "ten_a", { kind: "all" });
    assert.equal(bin.some((r) => r.id === "cus_a1" && r.kind === "customer"), true);
    assert.equal(bin.some((r) => r.id === "svc_drop" && r.kind === "service"), true);
    assert.equal(bin.some((r) => r.id === "svc_keep" && r.kind === "service"), true);
    const counts = await recycleCounts(sql, "ten_a");
    assert.equal(counts.customers, 1);
    assert.equal(counts.services, 2);
    const other = await listRecycleBin(sql, "ten_b", {});
    assert.equal(other.length, 0);
  } finally {
    await close();
  }
});

test("restore customer default does not reactivate services", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveCustomer(sql, "ten_a", "cus_a1", { ...actor, archiveServices: true });
    const out = await restoreCustomer(sql, "ten_a", "cus_a1", { ...actor, reason: "Came back" });
    assert.equal(out.services_restored, 0);
    assert.equal(out.trigger_billing, false);
    assert.equal(out.send_customer_notifications, false);
    const rec = await loadCustomerRecord(sql, "ten_a", "cus_a1");
    assert.equal(rec.customer.name, "Amina");
    assert.equal(rec.customer.notes, "Home in Kasarani");
    assert.equal(rec.services.length, 0);
    const still = await listRecycleBin(sql, "ten_a", { kind: "service" });
    assert.equal(still.filter((r) => r.customer_id === "cus_a1").length, 2);
  } finally {
    await close();
  }
});

test("restore selected services reuses ids and does not duplicate", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveCustomer(sql, "ten_a", "cus_a1", { ...actor, archiveServices: true });
    const out = await restoreCustomer(sql, "ten_a", "cus_a1", {
      ...actor,
      reason: "Restore one line",
      serviceIds: ["svc_keep"],
    });
    assert.equal(out.services_restored, 1);
    const rec = await loadCustomerRecord(sql, "ten_a", "cus_a1");
    assert.deepEqual(rec.services.map((s) => s.id).sort(), ["svc_keep"]);
    const [count] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_keep'`;
    assert.equal(count?.n, 1);
    const [svc] = await sql<{ customer_id: string; username: string | null }>`
      select customer_id, username from services where id = 'svc_keep'`;
    assert.equal(svc?.customer_id, "cus_a1");
    assert.equal(svc?.username, "amina");
  } finally {
    await close();
  }
});

test("expired restored service stays offline", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveService(sql, "ten_a", "svc_exp", actor);
    const out = await restoreService(sql, "ten_a", "svc_exp", { ...actor, reason: "Bring record back" });
    assert.equal(out.status, "suspended");
    assert.equal(out.trigger_billing, false);
    assert.equal(out.send_customer_notifications, false);
    const [row] = await sql<{ status: string; username: string | null }>`
      select status, username from services where id = 'svc_exp'`;
    assert.equal(row?.status, "suspended");
    assert.equal(row?.username, "brian");
  } finally {
    await close();
  }
});

test("restoring a service onto another ISP's customer is blocked", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveService(sql, "ten_a", "svc_drop", actor);
    await assert.rejects(
      () => restoreService(sql, "ten_a", "svc_drop", { ...actor, reason: "move", assignCustomerId: "cus_b1" }),
      /live customer|not found/i,
    );
    const [row] = await sql<{ deleted_at: string | null; customer_id: string }>`
      select deleted_at::text as deleted_at, customer_id from services where id = 'svc_drop'`;
    assert.ok(row?.deleted_at);
    assert.equal(row?.customer_id, "cus_a1");
  } finally {
    await close();
  }
});

test("username conflict blocks restore without creating a second line", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveService(sql, "ten_a", "svc_drop", actor);
    await sql`update services set username = 'amina2' where id = 'svc_keep'`;
    await assert.rejects(
      () => restoreService(sql, "ten_a", "svc_drop", { ...actor, reason: "conflict" }),
      /already assigned/,
    );
    const [n] = await sql<{ n: number }>`select count(*)::int as n from services where username = 'amina2'`;
    assert.equal(n?.n, 2);
    const [live] = await sql<{ n: number }>`
      select count(*)::int as n from services where username = 'amina2' and deleted_at is null`;
    assert.equal(live?.n, 1);
  } finally {
    await close();
  }
});

test("permanent deletion requires the confirmation phrase and keeps invoices", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_a', 'ten_a', 'cus_a1', 'INV-A1', 2500, 'paid', '2026-09-01')`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
      values ('pay_a', 'ten_a', 'cus_a1', 'inv_a', 'mpesa', 2500, 'TX-A1', 'confirmed')`;
    await asRole("ten_a");
    await archiveCustomer(sql, "ten_a", "cus_a1", { ...actor, archiveServices: true });
    await assert.rejects(
      () => purgeCustomer(sql, "ten_a", "cus_a1", { ...actor, reason: "wipe", confirmPhrase: "delete" }),
      /PERMANENTLY DELETE/,
    );
    const kept = await purgeCustomer(sql, "ten_a", "cus_a1", {
      ...actor,
      reason: "Closed account",
      confirmPhrase: PERMANENT_DELETE_PHRASE,
    });
    assert.equal(kept.tombstone, true);
    const [cus] = await sql<{ name: string; phone: string; purged_at: string | null }>`
      select name, phone, purged_at::text as purged_at from customers where id = 'cus_a1'`;
    assert.equal(cus?.name, "Deleted customer");
    assert.equal(cus?.phone, "");
    assert.ok(cus?.purged_at);
    const [inv] = await sql<{ n: number }>`select count(*)::int as n from invoices where id = 'inv_a'`;
    const [pay] = await sql<{ n: number }>`select count(*)::int as n from payments where id = 'pay_a'`;
    assert.equal(inv?.n, 1);
    assert.equal(pay?.n, 1);
    const bin = await listRecycleBin(sql, "ten_a", {});
    assert.equal(bin.some((r) => r.id === "cus_a1"), false);
    const audit = await sql<{ action: string }>`
      select action from audit_logs where tenant_id = 'ten_a' and entity_id = 'cus_a1' order by created_at`;
    assert.equal(audit.some((a) => a.action === "customer.purged"), true);
    assert.equal(audit.some((a) => a.action === "customer.archived"), true);
  } finally {
    await close();
  }
});

test("permanent service delete does not remove the customer or sibling lines", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveService(sql, "ten_a", "svc_drop", actor);
    await purgeService(sql, "ten_a", "svc_drop", {
      ...actor,
      reason: "Duplicate line",
      confirmPhrase: PERMANENT_DELETE_PHRASE,
    });
    const [drop] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_drop'`;
    const [keep] = await sql<{ n: number }>`select count(*)::int as n from services where id = 'svc_keep'`;
    const [cus] = await sql<{ n: number }>`select count(*)::int as n from customers where id = 'cus_a1'`;
    assert.equal(drop?.n, 0);
    assert.equal(keep?.n, 1);
    assert.equal(cus?.n, 1);
  } finally {
    await close();
  }
});

test("reassignment stays on the same tenant before a customer is archived", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await assert.rejects(() => reassignService(sql, "ten_a", "svc_keep", "cus_b1"), /Customer not found/);
    await reassignService(sql, "ten_a", "svc_keep", "cus_a2");
    await deleteCustomer(sql, "ten_a", "cus_a1", { deleteServices: true, ...actor });
    const [kept] = await sql<{ customer_id: string; deleted_at: string | null }>`
      select customer_id, deleted_at::text as deleted_at from services where id = 'svc_keep'`;
    assert.equal(kept?.customer_id, "cus_a2");
    assert.equal(kept?.deleted_at, null);
    const [archived] = await sql<{ deleted_at: string | null }>`
      select deleted_at::text as deleted_at from customers where id = 'cus_a1'`;
    assert.ok(archived?.deleted_at);
  } finally {
    await close();
  }
});

test("billing cron and communications skip archived records", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveCustomer(sql, "ten_a", "cus_a1", { ...actor, archiveServices: true });
    const created = await generateRecurringInvoices(sql, "ten_a");
    assert.equal(created.some((row) => row.customerId === "cus_a1"), false);
    const audience = await resolveAudience(sql, "ten_a", {});
    assert.equal(audience.some((row) => row.customer_id === "cus_a1"), false);
    assert.equal(audience.some((row) => row.customer_id === "cus_a2"), true);
    const audit = await sql<{ details: string }>`
      select coalesce(details,'') as details from audit_logs
      where tenant_id = 'ten_a' and action = 'customer.archived'`;
    assert.match(audit[0]?.details || "", /"trigger_billing":false/);
    assert.match(audit[0]?.details || "", /"send_customer_notifications":false/);
  } finally {
    await close();
  }
});

test("deleting a service never archives the customer or sibling lines", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const out = await deleteService(sql, "ten_a", "svc_drop", actor);
    assert.equal(out.customer_kept, true);
    assert.equal(out.archived, true);
    const rec = await loadCustomerRecord(sql, "ten_a", "cus_a1");
    assert.equal(rec.services.some((s) => s.id === "svc_keep"), true);
    assert.equal(rec.services.some((s) => s.id === "svc_drop"), false);
    const [cus] = await sql<{ deleted_at: string | null }>`
      select deleted_at::text as deleted_at from customers where id = 'cus_a1'`;
    assert.equal(cus?.deleted_at, null);
  } finally {
    await close();
  }
});

test("Recycle Bin permissions stay role-scoped", () => {
  assert.equal(hasPermission("technician", "recycle_bin.view"), false);
  assert.equal(hasPermission("finance", "recycle_bin.view"), true);
  assert.equal(hasPermission("finance", "recycle_bin.restore_customer"), false);
  assert.equal(hasPermission("finance", "recycle_bin.permanent_delete"), false);
  assert.equal(hasPermission("customer_care", "recycle_bin.restore_customer"), true);
  assert.equal(hasPermission("customer_care", "recycle_bin.permanent_delete"), false);
  assert.equal(hasPermission("network_engineer", "recycle_bin.restore_service"), true);
  assert.equal(hasPermission("network_engineer", "recycle_bin.restore_customer"), false);
  assert.equal(hasPermission("isp_owner", "recycle_bin.permanent_delete"), true);
  assert.equal(hasPermission("support", "recycle_bin.view"), true);
  assert.equal(hasPermission("support", "recycle_bin.restore_service"), false);
});

test("inactive package blocks restore until a replacement is chosen", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveService(sql, "ten_a", "svc_drop", actor);
    await sql`update packages set active = false where id = 'pkg_a'`;
    await assert.rejects(
      () => restoreService(sql, "ten_a", "svc_drop", { ...actor, reason: "Bring line back" }),
      /inactive|replacement/i,
    );
    const out = await restoreService(sql, "ten_a", "svc_drop", {
      ...actor,
      reason: "Bring line back",
      packageId: "pkg_a2",
    });
    assert.equal(out.id, "svc_drop");
    const [row] = await sql<{ package_id: string; deleted_at: string | null }>`
      select package_id, deleted_at::text as deleted_at from services where id = 'svc_drop'`;
    assert.equal(row?.package_id, "pkg_a2");
    assert.equal(row?.deleted_at, null);
  } finally {
    await close();
  }
});

test("Recycle Bin search finds archived PPPoE usernames that live search excludes", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await archiveService(sql, "ten_a", "svc_drop", actor);
    const live = await loadCustomerRecord(sql, "ten_a", "cus_a1");
    assert.equal(live.services.some((s) => s.username === "amina2"), false);
    const bin = await listRecycleBin(sql, "ten_a", { q: "amina2" });
    assert.equal(bin.some((r) => r.id === "svc_drop" && r.kind === "service"), true);
  } finally {
    await close();
  }
});
