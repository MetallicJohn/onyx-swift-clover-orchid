import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceAging, tallyAging } from "./aging.ts";

test("paid invoices stay in paid regardless of due date", () => {
  assert.equal(invoiceAging("paid", "2020-01-01", new Date("2026-09-09")), "paid");
});

test("overdue buckets by days past due", () => {
  const today = new Date("2026-09-09");
  assert.equal(invoiceAging("due", "2026-09-20", today), "current");
  assert.equal(invoiceAging("overdue", "2026-08-20", today), "1-30");
  assert.equal(invoiceAging("overdue", "2026-07-01", today), "31-60");
  assert.equal(invoiceAging("overdue", "2026-01-01", today), "60+");
});

test("tally sums amounts per bucket", () => {
  const t = tallyAging(
    [
      { status: "paid", due_date: "2026-01-01", amount_kes: 100 },
      { status: "due", due_date: "2026-09-30", amount_kes: 50 },
    ],
    new Date("2026-09-09"),
  );
  assert.equal(t.paid.amount, 100);
  assert.equal(t.current.amount, 50);
});
