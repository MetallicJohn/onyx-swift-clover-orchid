import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  allocateCustomerId,
  formatCustomerId,
  getCustomerIdSettings,
  normalizeCustomerId,
  saveCustomerIdStart,
} from "./customer-ids.ts";
import { archiveCustomer, restoreCustomer } from "./recycle-bin.ts";
import { ensureServiceAccountNumber, saveAccountNumberSettings } from "./account-numbers.ts";
import { openTestDb } from "./test-db.ts";

test("customer IDs are unpadded numeric strings", () => {
  assert.equal(formatCustomerId(1), "1");
  assert.equal(formatCustomerId(25), "25");
  assert.equal(formatCustomerId(1000), "1000");
  assert.equal(normalizeCustomerId("01"), "1");
  assert.equal(normalizeCustomerId("25"), "25");
  assert.equal(normalizeCustomerId("CUS-1"), "");
  assert.equal(normalizeCustomerId(""), "");
});

test("first customer receives ID 1 by default", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_id1', 'One', 'one')`;
    await asRole("ten_id1");
    const desk = await getCustomerIdSettings(sql, "ten_id1");
    assert.equal(desk.start_n, 1);
    assert.equal(desk.configured, false);
    assert.equal(desk.locked, false);
    assert.equal(desk.next_preview, "1");
    const first = await allocateCustomerId(sql, "ten_id1");
    assert.equal(first, "1");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_id1', 'ten_id1', 'Amina', ${first})`;
    const second = await allocateCustomerId(sql, "ten_id1");
    assert.equal(second, "2");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_id2', 'ten_id1', 'John', ${second})`;
    const after = await getCustomerIdSettings(sql, "ten_id1");
    assert.equal(after.configured, true);
    assert.equal(after.issued, true);
    assert.equal(after.locked, true);
    assert.equal(after.next_preview, "3");
  } finally {
    await close();
  }
});

test("custom starting number works before the first customer; skip starts from 1", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_start', 'Start', 'start'), ('ten_skip', 'Skip', 'skipid')`;
    await asRole("ten_start");
    const saved = await saveCustomerIdStart(sql, "ten_start", 50);
    assert.equal(saved.start_n, 50);
    assert.equal(saved.next_preview, "50");
    assert.equal(await allocateCustomerId(sql, "ten_start"), "50");
    assert.equal(await allocateCustomerId(sql, "ten_start"), "51");
    await asRole("ten_skip");
    assert.equal(await allocateCustomerId(sql, "ten_skip"), "1");
  } finally {
    await close();
  }
});

test("IDs increment numerically and stay unique per tenant", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_seq_a', 'A', 'ida'), ('ten_seq_b', 'B', 'idb')`;
    await asRole("ten_seq_a");
    const a1 = await allocateCustomerId(sql, "ten_seq_a");
    const a2 = await allocateCustomerId(sql, "ten_seq_a");
    const a3 = await allocateCustomerId(sql, "ten_seq_a");
    assert.deepEqual([a1, a2, a3], ["1", "2", "3"]);
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_seq_a1', 'ten_seq_a', 'A1', ${a1}), ('cus_seq_a2', 'ten_seq_a', 'A2', ${a2})`;
    await asRole("ten_seq_b");
    const b1 = await allocateCustomerId(sql, "ten_seq_b");
    assert.equal(b1, "1");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_seq_b1', 'ten_seq_b', 'B1', ${b1})`;
    await bypass();
    const same = await sql<{ n: number }>`
      select count(*)::int as n from customers where tenant_id = 'ten_seq_a' and account_number = '1'`;
    assert.equal(same[0]?.n, 1);
  } finally {
    await close();
  }
});

test("concurrent creation cannot create duplicate IDs", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_cc', 'CC', 'ccid')`;
    await asRole("ten_cc");
    const ids = await Promise.all([
      allocateCustomerId(sql, "ten_cc"),
      allocateCustomerId(sql, "ten_cc"),
      allocateCustomerId(sql, "ten_cc"),
      allocateCustomerId(sql, "ten_cc"),
    ]);
    assert.equal(new Set(ids).size, ids.length);
    ids.sort((a, b) => Number(a) - Number(b));
    assert.deepEqual(ids, ["1", "2", "3", "4"]);
  } finally {
    await close();
  }
});

test("existing customer identifiers are never rewritten", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_keep', 'Keep', 'keep')`;
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_keep', 'ten_keep', 'Legacy', 'CUS-1000')`;
    await asRole("ten_keep");
    const desk = await getCustomerIdSettings(sql, "ten_keep");
    assert.equal(desk.issued, true);
    assert.equal(desk.locked, true);
    await assert.rejects(() => saveCustomerIdStart(sql, "ten_keep", 9), /already been issued/);
    const next = await allocateCustomerId(sql, "ten_keep");
    assert.equal(next, "1");
    const [kept] = await sql<{ account_number: string }>`
      select account_number from customers where id = 'cus_keep'`;
    assert.equal(kept?.account_number, "CUS-1000");
  } finally {
    await close();
  }
});

test("archived customers do not release IDs; restore keeps the same ID", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_bin', 'Bin', 'binid')`;
    await asRole("ten_bin");
    const first = await allocateCustomerId(sql, "ten_bin");
    assert.equal(first, "1");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_bin', 'ten_bin', 'Held', ${first})`;
    await archiveCustomer(sql, "ten_bin", "cus_bin", { actorId: "usr_1", reason: "Moved out" });
    const next = await allocateCustomerId(sql, "ten_bin");
    assert.equal(next, "2");
    await restoreCustomer(sql, "ten_bin", "cus_bin", { actorId: "usr_1", reason: "Came back" });
    const [restored] = await sql<{ account_number: string; deleted_at: string | null }>`
      select account_number, deleted_at::text as deleted_at from customers where id = 'cus_bin'`;
    assert.equal(restored?.account_number, "1");
    assert.equal(restored?.deleted_at, null);
  } finally {
    await close();
  }
});

test("customer IDs skip taken numbers and do not reuse service account numbers as IDs", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_mix', 'Mix', 'mixid')`;
    await asRole("ten_mix");
    await saveAccountNumberSettings(sql, "ten_mix", "mixid", {
      enabled: true,
      scheme: "sequence",
      prefix: "ACC",
      separator: "-",
      start_n: 8,
      next_n: 8,
      digits: 4,
    });
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_held', 'ten_mix', 'Held', '1')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_mix', 'ten_mix', 'Home', 'pppoe', 10, 10, 1000)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_mix', 'ten_mix', 'cus_held', 'pkg_mix', 'pppoe', 'held', 'active')`;
    const serviceNo = await ensureServiceAccountNumber(sql, "ten_mix", "svc_mix");
    assert.match(serviceNo, /^ACC-/);
    const next = await allocateCustomerId(sql, "ten_mix");
    assert.equal(next, "2");
    assert.notEqual(next, serviceNo);
    const [held] = await sql<{ account_number: string }>`select account_number from customers where id = 'cus_held'`;
    assert.equal(held?.account_number, "1");
    const [svc] = await sql<{ account_number: string }>`select account_number from services where id = 'svc_mix'`;
    assert.equal(svc?.account_number, serviceNo);
  } finally {
    await close();
  }
});

test("staff UI labels ID and Service Account Number, never Customer ID", () => {
  const files = [
    "../../components/isp/customer-desk-ui.tsx",
    "../../components/isp/service-desk-ui.tsx",
    "../../routes/app/customers.tsx",
    "../../routes/app/customers.$customerId.tsx",
    "../../routes/app/services.tsx",
    "../../routes/app/settings.tsx",
    "../../components/isp/customer-id-settings.tsx",
    "../../components/isp/onboard-wizard.tsx",
  ];
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.doesNotMatch(src, /Customer ID/);
    assert.doesNotMatch(src, /Customer Account Number/);
  }
  const desk = readFileSync(new URL("../../components/isp/customer-desk-ui.tsx", import.meta.url), "utf8");
  assert.match(desk, />ID</);
  const services = readFileSync(new URL("../../components/isp/service-desk-ui.tsx", import.meta.url), "utf8");
  assert.match(services, /Service Account Number/);
  const settings = readFileSync(new URL("../../routes/app/settings.tsx", import.meta.url), "utf8");
  assert.match(settings, /ID Settings/);
  const portalProfile = readFileSync(new URL("../../routes/portal/profile.tsx", import.meta.url), "utf8");
  const portalHome = readFileSync(new URL("../../routes/portal/index.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(portalProfile, /home\.customer\.account_number|c\.account_number/);
  assert.doesNotMatch(portalHome, /home\.customer\.account_number/);
});
