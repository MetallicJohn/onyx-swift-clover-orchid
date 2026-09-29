import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compilePattern,
  isReserved,
  luhnCheckDigit,
  normalizeReservation,
  parsePattern,
  periodStamp,
  presetPattern,
  renderPattern,
  sequenceScopeKey,
  usesPatternMode,
  validateAccountValue,
} from "./account-pattern.ts";
import { hasPermission } from "./rbac.ts";

const when = new Date("2026-09-30T12:00:00Z");

test("parses and renders pattern components", () => {
  const parsed = parsePattern("ACC-{SEQ:6}");
  assert.equal(parsed.errors.length, 0);
  assert.equal(compilePattern(parsed.parts), "ACC-{SEQ:6}");
  assert.equal(renderPattern("ACC-{SEQ:6}", { seq: 1 }).value, "ACC-000001");
  assert.equal(renderPattern("{BRANCH}-{SEQ:6}", { seq: 2, branchCode: "NYK" }).value, "NYK-000002");
  assert.equal(renderPattern("{TYPE}-{SEQ:6}", { seq: 1, typeCode: "RES" }).value, "RES-000001");
  assert.equal(renderPattern("{YEAR}-{SEQ:6}", { seq: 1, when }).value, "2026-000001");
  assert.equal(renderPattern("{BRANCH}-{YEAR}-{SEQ:5}", { seq: 15, branchCode: "NYK", when }).value, "NYK-2026-00015");
  assert.equal(renderPattern("{PREFIX}{SEP}{TYPE}-{SEQ:6}", { seq: 1, prefix: "IMN", separator: "-", typeCode: "RES" }).value, "IMN-RES-000001");
  assert.match(renderPattern("{BRANCH}-{SEQ:4}", { seq: 1 }).errors[0] || "", /branch code/i);
  assert.equal(presetPattern("sequential", { digits: 4 }), "{SEQ:4}");
  assert.equal(usesPatternMode("legacy"), false);
  assert.equal(usesPatternMode("prefix"), true);
});

test("check digit, charset, and reserved numbers", () => {
  assert.equal(luhnCheckDigit("7992739871"), "3");
  const withCheck = renderPattern("{SEQ:4}{CHECK}", { seq: 1 });
  assert.equal(withCheck.errors.length, 0);
  assert.equal(withCheck.value.length, 5);
  assert.equal(validateAccountValue(withCheck.value, { minLength: 1, maxLength: 32, charset: "numeric", check: true }).errors.length, 0);
  assert.equal(validateAccountValue("79927398713", { minLength: 1, maxLength: 32, charset: "numeric", check: true }).errors.length, 0);
  assert.equal(validateAccountValue("IMN 1", { minLength: 1, maxLength: 32, charset: "alnum" }).errors[0]?.includes("space") || false, true);
  const reserved = normalizeReservation("prefix", "TEST-*");
  assert.equal(reserved.value, "TEST-*");
  assert.equal(isReserved("TEST-9", [{ kind: "prefix", value: reserved.value }]), true);
  assert.equal(isReserved("ACC-000001", [{ kind: "number", value: "ACC-000001" }]), true);
  assert.equal(isReserved("000002", [{ kind: "range", value: "000001", valueEnd: "000003" }]), true);
  assert.equal(isReserved("000004", [{ kind: "range", value: "000001", valueEnd: "000003" }]), false);
});

test("sequence scope and reset period do not share a key", () => {
  const base = { scope: "branch" as const, reset: "never" as const };
  assert.notEqual(sequenceScopeKey({ ...base, branch: "NYK" }), sequenceScopeKey({ ...base, branch: "NBO" }));
  assert.notEqual(
    sequenceScopeKey({ scope: "tenant", reset: "year", when }),
    sequenceScopeKey({ scope: "tenant", reset: "year", when: new Date("2027-06-15T12:00:00Z") }),
  );
  assert.equal(periodStamp("never", when), "");
  assert.match(periodStamp("month", when), /^m:202609$/);
});

test("account number permissions stay off ordinary customer care", () => {
  assert.equal(hasPermission("customer_care", "account_numbers.view"), true);
  assert.equal(hasPermission("customer_care", "account_numbers.configure"), false);
  assert.equal(hasPermission("customer_care", "account_numbers.assign"), false);
  assert.equal(hasPermission("customer_care", "account_numbers.override"), false);
  assert.equal(hasPermission("network_engineer", "account_numbers.assign"), true);
  assert.equal(hasPermission("network_engineer", "account_numbers.configure"), false);
  assert.equal(hasPermission("finance", "account_numbers.migrate"), false);
  assert.equal(hasPermission("support", "account_numbers.view"), true);
  assert.equal(hasPermission("isp_admin", "account_numbers.override"), true);
});
