import assert from "node:assert/strict";
import { test } from "node:test";
import { activateVoucherClock, canActivate, canRevoke, nextVoucherStatus } from "./voucher-lifecycle.ts";

test("hours start at activate, not at print", () => {
  const now = new Date("2026-09-09T08:00:00Z");
  const clock = activateVoucherClock(24, now);
  assert.equal(clock.status, "active");
  assert.equal(clock.expires_at.toISOString(), "2026-09-10T08:00:00.000Z");
});

test("active voucher expires when the clock passes", () => {
  const exp = new Date("2026-09-09T10:00:00Z");
  assert.equal(nextVoucherStatus("active", exp, new Date("2026-09-09T10:00:01Z")), "expired");
  assert.equal(nextVoucherStatus("active", exp, new Date("2026-09-09T09:00:00Z")), "active");
  assert.equal(nextVoucherStatus("unused", exp, new Date("2026-09-09T11:00:00Z")), "unused");
});

test("only unused can activate; unused and active can revoke", () => {
  assert.equal(canActivate("unused"), true);
  assert.equal(canActivate("active"), false);
  assert.equal(canRevoke("cancelled"), false);
});
