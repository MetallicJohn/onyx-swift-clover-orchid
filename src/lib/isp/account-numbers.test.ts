import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateAccountNumber,
  changeCustomerAccountNumber,
  formatAccountNumber,
  getAccountNumberSettings,
  saveAccountNumberSettings,
} from "./account-numbers.ts";
import { openTestDb } from "./test-db.ts";

test("formats prefix, padding, separator, and suffix", () => {
  assert.equal(formatAccountNumber({ prefix: "IMN", n: 1000, digits: 4 }), "IMN1000");
  assert.equal(formatAccountNumber({ prefix: "CUS", separator: "-", n: 1, digits: 4 }), "CUS-0001");
  assert.equal(formatAccountNumber({ prefix: "2026", separator: "-", n: 1000, digits: 4 }), "2026-1000");
  assert.equal(formatAccountNumber({ prefix: "NANY", n: 1, digits: 3 }), "NANY001");
  assert.equal(formatAccountNumber({ prefix: "imn", suffix: "ke", separator: "/", n: 12, digits: 3 }), "IMN/012KE");
});

test("auto numbering issues a unique sequential account per ISP", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_acc', 'Imani', 'imani-networks')`;
    await asRole("ten_acc");
    const saved = await saveAccountNumberSettings(sql, "ten_acc", "imani-networks", {
      enabled: true,
      prefix: "IMN",
      separator: "",
      start_n: 1000,
      next_n: 1000,
      digits: 4,
      allow_manual: false,
    });
    assert.equal(formatAccountNumber({ prefix: saved.prefix, n: saved.next_n, digits: saved.digits }), "IMN1000");
    const first = await allocateAccountNumber(sql, "ten_acc");
    const second = await allocateAccountNumber(sql, "ten_acc");
    const third = await allocateAccountNumber(sql, "ten_acc");
    assert.equal(first, "IMN1000");
    assert.equal(second, "IMN1001");
    assert.equal(third, "IMN1002");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_a1', 'ten_acc', 'A', ${first}), ('cus_a2', 'ten_acc', 'B', ${second}), ('cus_a3', 'ten_acc', 'C', ${third})`;
    const fourth = await allocateAccountNumber(sql, "ten_acc");
    assert.equal(fourth, "IMN1003");
  } finally {
    await close();
  }
});

test("skips a number that is already assigned and does not reuse it", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_skip', 'Skip', 'skip')`;
    await asRole("ten_skip");
    await saveAccountNumberSettings(sql, "ten_skip", "skip", {
      enabled: true,
      prefix: "CUS",
      separator: "-",
      start_n: 1,
      next_n: 1,
      digits: 4,
      allow_manual: true,
    });
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_s1', 'ten_skip', 'Held', 'CUS-0001')`;
    const next = await allocateAccountNumber(sql, "ten_skip");
    assert.equal(next, "CUS-0002");
  } finally {
    await close();
  }
});

test("manual edit is blocked until enabled, then rejects duplicates", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_man', 'Man', 'man')`;
    await asRole("ten_man");
    await saveAccountNumberSettings(sql, "ten_man", "man", {
      enabled: true,
      prefix: "NANY",
      digits: 3,
      start_n: 1,
      next_n: 1,
      allow_manual: false,
    });
    const a = await allocateAccountNumber(sql, "ten_man");
    const b = await allocateAccountNumber(sql, "ten_man");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_m1', 'ten_man', 'One', ${a}), ('cus_m2', 'ten_man', 'Two', ${b})`;
    await assert.rejects(
      () => changeCustomerAccountNumber(sql, { tenantId: "ten_man", customerId: "cus_m1", next: "NANY099", allowManual: false }),
      /turned off/,
    );
    await saveAccountNumberSettings(sql, "ten_man", "man", { allow_manual: true });
    const changed = await changeCustomerAccountNumber(sql, {
      tenantId: "ten_man",
      customerId: "cus_m1",
      next: "NANY099",
      allowManual: true,
    });
    assert.equal(changed.next, "NANY099");
    await assert.rejects(
      () =>
        changeCustomerAccountNumber(sql, {
          tenantId: "ten_man",
          customerId: "cus_m2",
          next: "NANY099",
          allowManual: true,
        }),
      /already assigned/,
    );
  } finally {
    await close();
  }
});

test("the same formatted number can exist in two ISPs", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_x', 'X', 'xco'), ('ten_y', 'Y', 'yco')`;
    await asRole("ten_x");
    await saveAccountNumberSettings(sql, "ten_x", "xco", { enabled: true, prefix: "IMN", start_n: 1000, next_n: 1000, digits: 4 });
    const x = await allocateAccountNumber(sql, "ten_x");
    await sql`insert into customers (id, tenant_id, name, account_number) values ('cus_x', 'ten_x', 'X', ${x})`;
    await asRole("ten_y");
    await saveAccountNumberSettings(sql, "ten_y", "yco", { enabled: true, prefix: "IMN", start_n: 1000, next_n: 1000, digits: 4 });
    const y = await allocateAccountNumber(sql, "ten_y");
    assert.equal(x, y);
    await sql`insert into customers (id, tenant_id, name, account_number) values ('cus_y', 'ten_y', 'Y', ${y})`;
  } finally {
    await close();
  }
});

test("auto off leaves the number blank unless staff type one", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_off', 'Off', 'off')`;
    await asRole("ten_off");
    assert.equal(await allocateAccountNumber(sql, "ten_off"), "");
    await assert.rejects(() => allocateAccountNumber(sql, "ten_off", "CUS-1"), /turned off/);
    await saveAccountNumberSettings(sql, "ten_off", "off", { allow_manual: true });
    assert.equal(await allocateAccountNumber(sql, "ten_off", "CUS-1"), "CUS-1");
    const desk = await getAccountNumberSettings(sql, "ten_off", "off");
    assert.equal(desk.enabled, false);
  } finally {
    await close();
  }
});
