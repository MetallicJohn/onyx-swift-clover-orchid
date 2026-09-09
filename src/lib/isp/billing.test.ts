import assert from "node:assert/strict";
import { test } from "node:test";
import { intervalDays, needsRecurringInvoice } from "./billing.ts";

test("billing intervals", () => {
  assert.equal(intervalDays("daily"), 1);
  assert.equal(intervalDays("weekly"), 7);
  assert.equal(intervalDays("monthly"), 30);
});

test("does not stack invoices while one is unpaid", () => {
  assert.equal(
    needsRecurringInvoice({ hasUnpaid: true, lastIssuedAt: "2026-01-01", interval: "monthly" }),
    false,
  );
});

test("issues first invoice when none exist", () => {
  assert.equal(needsRecurringInvoice({ hasUnpaid: false, lastIssuedAt: null, interval: "monthly" }), true);
});

test("renews after the package interval", () => {
  const today = new Date("2026-09-09");
  assert.equal(
    needsRecurringInvoice({ hasUnpaid: false, lastIssuedAt: "2026-08-01", interval: "monthly", today }),
    true,
  );
  assert.equal(
    needsRecurringInvoice({ hasUnpaid: false, lastIssuedAt: "2026-09-01", interval: "monthly", today }),
    false,
  );
});
