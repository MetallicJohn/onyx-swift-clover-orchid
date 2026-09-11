import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDb } from "./test-db.ts";
import {
  bulkAssignTags,
  broadcastToCustomers,
  createTag,
  customerHasTags,
  deleteTag,
  listTags,
  loadAssignments,
  normalizeTagName,
  renameTag,
  setCustomerTags,
  setTagEnabled,
  tagSlug,
} from "./tags.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'CoastNet', 'coastnet')`;
  await sql`insert into tenants (id, name, slug) values ('ten_b', 'OtherNet', 'othernet')`;
  await sql`insert into customers (id, tenant_id, name, phone, status)
    values ('cus_1', 'ten_a', 'Amina', '0711000001', 'active'),
           ('cus_2', 'ten_a', 'Otieno', '0711000002', 'active'),
           ('cus_3', 'ten_a', 'Wanjiku', '0711000003', 'suspended'),
           ('cus_x', 'ten_b', 'Other', '0711999999', 'active')`;
}

test("tag names are one word", () => {
  assert.equal(normalizeTagName(" VIP "), "VIP");
  assert.equal(tagSlug("Fibre"), "fibre");
  assert.throws(() => normalizeTagName("Estate A"), /one word/);
  assert.throws(() => normalizeTagName(""), /Enter a tag/);
});

test("tags are tenant-specific, assignable, and filterable", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const vip = await createTag(sql, "ten_a", "VIP");
    const fibre = await createTag(sql, "ten_a", "Fibre");
    await createTag(sql, "ten_a", "Student");
    await assert.rejects(createTag(sql, "ten_a", "vip"), /already exists/);

    await setCustomerTags(sql, "ten_a", "cus_1", [vip.id, fibre.id]);
    await setCustomerTags(sql, "ten_a", "cus_2", [vip.id]);
    const assigned = await loadAssignments(sql, "ten_a");
    const byCustomer = new Map<string, string[]>();
    for (const row of assigned) {
      const list = byCustomer.get(row.customer_id) ?? [];
      list.push(row.id);
      byCustomer.set(row.customer_id, list);
    }
    assert.equal(byCustomer.get("cus_1")?.length, 2);
    assert.ok(customerHasTags(byCustomer.get("cus_1") ?? [], [vip.id, fibre.id], "all"));
    assert.equal(customerHasTags(byCustomer.get("cus_2") ?? [], [vip.id, fibre.id], "all"), false);
    assert.ok(customerHasTags(byCustomer.get("cus_2") ?? [], [vip.id, fibre.id], "any"));

    const catalog = await listTags(sql, "ten_a");
    assert.equal(catalog.find((t) => t.id === vip.id)?.customer_count, 2);
    assert.equal(catalog.find((t) => t.id === fibre.id)?.customer_count, 1);

    await asRole("ten_b");
    const other = await listTags(sql, "ten_b");
    assert.equal(other.length, 0);
    await assert.rejects(setCustomerTags(sql, "ten_b", "cus_1", []), /not found/);
  } finally {
    await close();
  }
});

test("rename, disable, delete, and bulk assign stay consistent", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const promo = await createTag(sql, "ten_a", "Promo");
    await createTag(sql, "ten_a", "Rural");
    const renamed = await renameTag(sql, "ten_a", promo.id, "Priority");
    assert.equal(renamed.name, "Priority");
    assert.equal(renamed.slug, "priority");

    await setTagEnabled(sql, "ten_a", promo.id, false);
    await assert.rejects(setCustomerTags(sql, "ten_a", "cus_1", [promo.id]), /disabled/);

    await setTagEnabled(sql, "ten_a", promo.id, true);
    const first = await bulkAssignTags(sql, "ten_a", ["cus_1", "cus_2"], [promo.id], "add");
    const second = await bulkAssignTags(sql, "ten_a", ["cus_1", "cus_2"], [promo.id], "add");
    assert.equal(first.changed, 2);
    assert.equal(second.changed, 0);

    await bulkAssignTags(sql, "ten_a", ["cus_1"], [promo.id], "remove");
    const left = await loadAssignments(sql, "ten_a");
    assert.equal(left.filter((r) => r.customer_id === "cus_1").length, 0);
    assert.equal(left.filter((r) => r.customer_id === "cus_2").length, 1);

    await deleteTag(sql, "ten_a", promo.id);
    const after = await listTags(sql, "ten_a");
    assert.equal(after.some((t) => t.id === promo.id), false);
    const leftover = await loadAssignments(sql, "ten_a");
    assert.equal(leftover.filter((r) => r.id === promo.id).length, 0);
  } finally {
    await close();
  }
});

test("broadcast writes inbox and logs SMS without marking invoices paid", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const result = await broadcastToCustomers(sql, {
      tenantId: "ten_a",
      customerIds: ["cus_1", "cus_2"],
      channels: ["sms", "in_app"],
      subject: "Promo",
      body: "VIP weekend rates",
    });
    assert.equal(result.customers, 2);
    assert.equal(result.inbox, 2);
    assert.equal(result.sms, 2);
    const inbox = await sql<{ n: number }>`select count(*)::int as n from customer_inbox where tenant_id = 'ten_a'`;
    assert.equal(inbox[0]?.n, 2);
    const logs = await sql<{ n: number }>`select count(*)::int as n from notification_logs where tenant_id = 'ten_a' and event_code in ('staff.sms','staff.message')`;
    assert.equal(logs[0]?.n, 4);
  } finally {
    await close();
  }
});
