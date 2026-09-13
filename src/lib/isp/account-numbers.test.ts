import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateAccountNumber,
  alphaToIndex,
  AMBIGUOUS_ACCOUNT_LETTERS,
  changeCustomerAccountNumber,
  formatAccountNumber,
  formatFromSettings,
  getAccountNumberSettings,
  indexToAlpha,
  isRandomAccountNumber,
  randomAccountNumber,
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
      scheme: "sequence",
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
      scheme: "sequence",
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
      scheme: "sequence",
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
    await saveAccountNumberSettings(sql, "ten_x", "xco", { enabled: true, scheme: "sequence", prefix: "IMN", start_n: 1000, next_n: 1000, digits: 4 });
    const x = await allocateAccountNumber(sql, "ten_x");
    await sql`insert into customers (id, tenant_id, name, account_number) values ('cus_x', 'ten_x', 'X', ${x})`;
    await asRole("ten_y");
    await saveAccountNumberSettings(sql, "ten_y", "yco", { enabled: true, scheme: "sequence", prefix: "IMN", start_n: 1000, next_n: 1000, digits: 4 });
    const y = await allocateAccountNumber(sql, "ten_y");
    assert.equal(x, y);
    await sql`insert into customers (id, tenant_id, name, account_number) values ('cus_y', 'ten_y', 'Y', ${y})`;
  } finally {
    await close();
  }
});

test("letter suffix increments A B C and can be locked permanent", async () => {
  assert.equal(indexToAlpha(0), "A");
  assert.equal(indexToAlpha(25), "Z");
  assert.equal(indexToAlpha(26), "AA");
  assert.equal(alphaToIndex("A"), 0);
  assert.equal(alphaToIndex("AA"), 26);
  assert.equal(formatFromSettings({
    prefix: "IMN",
    suffix: "A",
    separator: "",
    start_n: 1000,
    next_n: 1000,
    digits: 4,
    prefix_permanent: true,
    suffix_permanent: false,
    next_prefix_n: 0,
    next_suffix_n: 0,
  }, 0, "start"), "IMN1000A");
  assert.equal(formatFromSettings({
    prefix: "IMN",
    suffix: "A",
    separator: "",
    start_n: 1000,
    next_n: 1000,
    digits: 4,
    prefix_permanent: true,
    suffix_permanent: false,
    next_prefix_n: 0,
    next_suffix_n: 0,
  }, 25, "start"), "IMN1000Z");
  assert.equal(formatFromSettings({
    prefix: "IMN",
    suffix: "A",
    separator: "",
    start_n: 1000,
    next_n: 1000,
    digits: 4,
    prefix_permanent: true,
    suffix_permanent: false,
    next_prefix_n: 0,
    next_suffix_n: 0,
  }, 26, "start"), "IMN1000AA");

  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_az', 'Az', 'az')`;
    await asRole("ten_az");
    await saveAccountNumberSettings(sql, "ten_az", "az", {
      enabled: true,
      scheme: "sequence",
      prefix: "IMN",
      suffix: "A",
      start_n: 1000,
      next_n: 1000,
      digits: 4,
      prefix_permanent: true,
      suffix_permanent: false,
    });
    const a = await allocateAccountNumber(sql, "ten_az");
    const b = await allocateAccountNumber(sql, "ten_az");
    const c = await allocateAccountNumber(sql, "ten_az");
    assert.equal(a, "IMN1000A");
    assert.equal(b, "IMN1000B");
    assert.equal(c, "IMN1000C");
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_az1', 'ten_az', 'A', ${a}), ('cus_az2', 'ten_az', 'B', ${b})`;
    await saveAccountNumberSettings(sql, "ten_az", "az", { suffix_permanent: true, suffix: "KE" });
    const locked = await allocateAccountNumber(sql, "ten_az");
    assert.equal(locked, "IMN1000KE");
    const again = await allocateAccountNumber(sql, "ten_az");
    assert.equal(again, "IMN1001KE");
  } finally {
    await close();
  }
});

test("letter prefix increments when not permanent", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_pre', 'Pre', 'pre')`;
    await asRole("ten_pre");
    await saveAccountNumberSettings(sql, "ten_pre", "pre", {
      enabled: true,
      scheme: "sequence",
      prefix: "A",
      suffix: "",
      start_n: 1,
      next_n: 1,
      digits: 3,
      prefix_permanent: false,
      suffix_permanent: true,
    });
    assert.equal(await allocateAccountNumber(sql, "ten_pre"), "A001");
    assert.equal(await allocateAccountNumber(sql, "ten_pre"), "B001");
    assert.equal(await allocateAccountNumber(sql, "ten_pre"), "C001");
    await assert.rejects(
      () => saveAccountNumberSettings(sql, "ten_pre", "pre", { suffix_permanent: false, suffix: "" }),
      /letter suffix/,
    );
    await assert.rejects(
      () => saveAccountNumberSettings(sql, "ten_pre", "pre", { suffix_permanent: false, suffix: "K1" }),
      /letters \(A, B, C\) or digits/,
    );
  } finally {
    await close();
  }
});

test("random codes never use I O or L and mix letters with digits", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i += 1) {
    const code = randomAccountNumber();
    assert.equal(code.length, 5);
    assert.equal(isRandomAccountNumber(code), true);
    assert.equal([...AMBIGUOUS_ACCOUNT_LETTERS].some((ch) => code.includes(ch)), false);
    assert.match(code, /[A-Z]/);
    assert.match(code, /[0-9]/);
    seen.add(code);
  }
  assert.ok(seen.size > 350);
});

test("unset ISP assigns a 5-character random account with no separator", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_rnd', 'Rnd', 'rnd')`;
    await asRole("ten_rnd");
    const desk = await getAccountNumberSettings(sql, "ten_rnd", "rnd");
    assert.equal(desk.enabled, true);
    assert.equal(desk.scheme, "random");
    const first = await allocateAccountNumber(sql, "ten_rnd");
    const second = await allocateAccountNumber(sql, "ten_rnd");
    assert.equal(isRandomAccountNumber(first), true);
    assert.equal(isRandomAccountNumber(second), true);
    assert.notEqual(first, second);
    assert.equal(first.includes("-"), false);
    assert.equal(first.includes("/"), false);
    await sql`insert into customers (id, tenant_id, name, account_number)
      values ('cus_r1', 'ten_rnd', 'One', ${first})`;
    const third = await allocateAccountNumber(sql, "ten_rnd");
    assert.notEqual(third, first);
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
    await saveAccountNumberSettings(sql, "ten_off", "off", { enabled: false });
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
