import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAccountReservation,
  allocateAccountNumber,
  changeCustomerAccountNumber,
  ensureServiceAccountNumber,
  listAccountVersions,
  saveAccountNumberSettings,
  testAccountNumbers,
} from "./account-numbers.ts";
import { searchOnboardCustomers } from "./onboard-create.ts";
import { linkLegacyAccountNumber } from "./account-numbers.ts";
import { openTestDb } from "./test-db.ts";

const when = new Date("2026-06-15T12:00:00Z");
const nextYear = new Date("2027-06-15T12:00:00Z");

async function tenant(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], id: string, slug: string) {
  await sql`insert into tenants (id, name, slug) values (${id}, ${slug}, ${slug})`;
}

test("pattern prefix sequence skips taken and reserved numbers", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_pat", "pat");
    await asRole("ten_pat");
    await saveAccountNumberSettings(sql, "ten_pat", "pat", {
      enabled: true,
      mode: "prefix",
      scheme: "sequence",
      prefix: "ACC",
      separator: "-",
      digits: 6,
      start_n: 1,
      next_n: 1,
      pattern: "ACC-{SEQ:6}",
      allow_manual: false,
    });
    await sql`insert into customers (id, tenant_id, name, account_number) values ('cus_pat', 'ten_pat', 'Held', 'acc-000001')`;
    await addAccountReservation(sql, "ten_pat", "usr", { kind: "number", value: "ACC-000002" });
    await addAccountReservation(sql, "ten_pat", "usr", { kind: "prefix", value: "TEST-*" });
    const next = await allocateAccountNumber(sql, "ten_pat");
    assert.equal(next, "ACC-000003");
    await assert.rejects(() => allocateAccountNumber(sql, "ten_pat", "TEST-9", { source: "import" }), /reserved/i);
    await assert.rejects(
      () => changeCustomerAccountNumber(sql, { tenantId: "ten_pat", customerId: "cus_pat", next: "ACC-000009", allowManual: false }),
      /turned off/i,
    );
  } finally {
    await close();
  }
});

test("customer type and branch use separate sequences", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_scope", "scope");
    await asRole("ten_scope");
    await saveAccountNumberSettings(sql, "ten_scope", "scope", {
      enabled: true,
      mode: "pattern",
      prefix: "IMN",
      digits: 3,
      start_n: 1,
      next_n: 1,
      pattern: "{TYPE}-{SEQ:3}",
      seq_scope: "type",
    });
    const res = await allocateAccountNumber(sql, "ten_scope", null, { customerType: "individual" });
    const bus = await allocateAccountNumber(sql, "ten_scope", null, { customerType: "business" });
    const res2 = await allocateAccountNumber(sql, "ten_scope", null, { customerType: "individual" });
    assert.equal(res, "RES-001");
    assert.equal(bus, "BUS-001");
    assert.equal(res2, "RES-002");
    await saveAccountNumberSettings(sql, "ten_scope", "scope", {
      mode: "branch",
      pattern: "{BRANCH}-{SEQ:3}",
      seq_scope: "branch",
      branch_codes: JSON.stringify({ nanyuki: "NYK", nairobi: "NBO" }),
    });
    const nyk = await allocateAccountNumber(sql, "ten_scope", null, { branch: "nanyuki" });
    const nbo = await allocateAccountNumber(sql, "ten_scope", null, { branch: "nairobi" });
    assert.equal(nyk, "NYK-001");
    assert.equal(nbo, "NBO-001");
  } finally {
    await close();
  }
});

test("missing branch fails before a sequence row is written", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_miss", "miss");
    await asRole("ten_miss");
    await saveAccountNumberSettings(sql, "ten_miss", "miss", {
      enabled: true,
      mode: "branch",
      pattern: "{BRANCH}-{SEQ:4}",
      start_n: 1,
      next_n: 1,
    });
    await assert.rejects(
      () => allocateAccountNumber(sql, "ten_miss", null, { area: "Kilimani Road" }),
      /branch code/i,
    );
    const [row] = await sql<{ n: number }>`select count(*)::int as n from account_sequences where tenant_id = 'ten_miss'`;
    assert.equal(row?.n, 0);
  } finally {
    await close();
  }
});

test("import preserves a number and test generation does not consume the sequence", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_imp", "imp");
    await asRole("ten_imp");
    await saveAccountNumberSettings(sql, "ten_imp", "imp", {
      enabled: true,
      mode: "prefix",
      prefix: "IMN",
      separator: "-",
      digits: 4,
      start_n: 1,
      next_n: 1,
      pattern: "{PREFIX}-{SEQ:4}",
      import_preserve: true,
      allow_manual: false,
    });
    const kept = await allocateAccountNumber(sql, "ten_imp", "CUST-10482", { source: "import" });
    assert.equal(kept, "CUST-10482");
    const preview = await testAccountNumbers(sql, "ten_imp", 3);
    assert.equal(preview.unchanged, true);
    assert.equal(preview.sequence_rows, 0);
    assert.equal(preview.samples[0]?.value, "IMN-0001");
    assert.equal(preview.samples[1]?.value, "IMN-0002");
    const issued = await allocateAccountNumber(sql, "ten_imp", "HELLO1");
    assert.notEqual(issued, "HELLO1");
    assert.equal(issued, "IMN-0001");
  } finally {
    await close();
  }
});

test("manual mode does not block service creation and does not draw a sequence", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_manp", "manp");
    await asRole("ten_manp");
    await saveAccountNumberSettings(sql, "ten_manp", "manp", { enabled: true, mode: "manual", allow_manual: true });
    assert.equal(await allocateAccountNumber(sql, "ten_manp"), "");
    const [row] = await sql<{ n: number }>`select count(*)::int as n from account_sequences where tenant_id = 'ten_manp'`;
    assert.equal(row?.n, 0);
  } finally {
    await close();
  }
});

test("concurrent pattern allocation returns 20 unique numbers", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_con", "con");
    await asRole("ten_con");
    await saveAccountNumberSettings(sql, "ten_con", "con", {
      enabled: true,
      mode: "sequential",
      pattern: "{SEQ:6}",
      start_n: 1,
      next_n: 1,
      digits: 6,
      increment_by: 1,
    });
    const numbers = await Promise.all(Array.from({ length: 20 }, () => allocateAccountNumber(sql, "ten_con")));
    assert.equal(new Set(numbers).size, 20);
    assert.equal(numbers[0], "000001");
    assert.equal(numbers[19], "000020");
  } finally {
    await close();
  }
});

test("a yearly reset does not duplicate an assigned number", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_reset", "reset");
    await asRole("ten_reset");
    await saveAccountNumberSettings(sql, "ten_reset", "reset", {
      enabled: true,
      mode: "sequential",
      pattern: "{SEQ:4}",
      start_n: 1,
      next_n: 1,
      reset_policy: "year",
      digits: 4,
    });
    const first = await allocateAccountNumber(sql, "ten_reset", null, { when });
    await sql`insert into customers (id, tenant_id, name, account_number) values ('cus_reset', 'ten_reset', 'A', ${first})`;
    const second = await allocateAccountNumber(sql, "ten_reset", null, { when: nextYear });
    assert.equal(first, "0001");
    assert.notEqual(second, first);
    assert.equal(second, "0002");
  } finally {
    await close();
  }
});

test("tenants do not share sequences and existing service numbers stay put", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_iso_a", "isoa");
    await tenant(sql, "ten_iso_b", "isob");
    await asRole("ten_iso_a");
    await saveAccountNumberSettings(sql, "ten_iso_a", "isoa", {
      enabled: true,
      mode: "prefix",
      prefix: "IMN",
      separator: "-",
      digits: 4,
      start_n: 1,
      next_n: 1,
      pattern: "{PREFIX}-{SEQ:4}",
    });
    const a = await allocateAccountNumber(sql, "ten_iso_a");
    await asRole("ten_iso_b");
    await saveAccountNumberSettings(sql, "ten_iso_b", "isob", {
      enabled: true,
      mode: "prefix",
      prefix: "IMN",
      separator: "-",
      digits: 4,
      start_n: 1,
      next_n: 1,
      pattern: "{PREFIX}-{SEQ:4}",
    });
    const b = await allocateAccountNumber(sql, "ten_iso_b");
    assert.equal(a, b);

    await asRole("ten_iso_a");
    await sql`insert into customers (id, tenant_id, name, type, address, account_number)
      values ('cus_iso', 'ten_iso_a', 'A', 'business', 'Kilimani Road', '1001')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_iso', 'ten_iso_a', 'Home', 'pppoe', 10, 10, 1000)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_iso', 'ten_iso_a', 'cus_iso', 'pkg_iso', 'pppoe', 'a', 'active')`;
    await saveAccountNumberSettings(sql, "ten_iso_a", "isoa", {
      mode: "pattern",
      pattern: "{TYPE}-{SERVICE}-{SEQ:3}",
      seq_scope: "service",
      default_branch: "NYK",
      digits: 3,
    });
    const issued = await ensureServiceAccountNumber(sql, "ten_iso_a", "svc_iso");
    assert.equal(issued, "BUS-PP-001");
    await sql`update customers set type = 'corporate' where id = 'cus_iso'`;
    await saveAccountNumberSettings(sql, "ten_iso_a", "isoa", { pattern: "{YEAR}-{SEQ:5}", mode: "period" });
    const again = await ensureServiceAccountNumber(sql, "ten_iso_a", "svc_iso");
    assert.equal(again, issued);
    const versions = await listAccountVersions(sql, "ten_iso_a");
    assert.ok(versions.length >= 2);
  } finally {
    await close();
  }
});

test("legacy alias is searchable and case duplicates are rejected", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_alias", "alias");
    await asRole("ten_alias");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_alias', 'ten_alias', 'Legacy', 'IMN-000245'), ('cus_other', 'ten_alias', 'Other', 'IMN-000001')`;
    await linkLegacyAccountNumber(sql, {
      tenantId: "ten_alias",
      alias: "cust-10482",
      accountNumber: "IMN-000245",
      entityType: "customer",
      entityId: "cus_alias",
    });
    const hits = await searchOnboardCustomers(sql, "ten_alias", "CUST-10482");
    assert.equal(hits[0]?.id, "cus_alias");
    await saveAccountNumberSettings(sql, "ten_alias", "alias", { allow_manual: true, mode: "prefix", prefix: "IMN", pattern: "{PREFIX}-{SEQ:6}" });
    await assert.rejects(
      () =>
        changeCustomerAccountNumber(sql, {
          tenantId: "ten_alias",
          customerId: "cus_other",
          next: "imn-000245",
          allowManual: true,
        }),
      /already assigned/i,
    );
  } finally {
    await close();
  }
});

test("check digit numbers allocate and default branch is not guessed from an address", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await tenant(sql, "ten_chk", "chk");
    await asRole("ten_chk");
    await saveAccountNumberSettings(sql, "ten_chk", "chk", {
      enabled: true,
      mode: "pattern",
      pattern: "{BRANCH}-{SEQ:4}{CHECK}",
      default_branch: "NYK",
      start_n: 1,
      next_n: 1,
      digits: 4,
    });
    const number = await allocateAccountNumber(sql, "ten_chk", null, { area: "Kilimani Road Estate" });
    assert.match(number, /^NYK-0001\d$/);
    assert.doesNotMatch(number, /KILIMANI/);
  } finally {
    await close();
  }
});
