import assert from "node:assert/strict";
import { test } from "node:test";
import { newOtp } from "./otp.ts";
import { rateLimit } from "./rate-limit.ts";

test("sandbox OTP is fixed; live OTP is six digits", () => {
  assert.equal(newOtp(true), "000000");
  assert.match(newOtp(false), /^\d{6}$/);
});

test("rate limit trips after max hits", () => {
  const key = `t-${Math.random()}`;
  for (let i = 0; i < 3; i += 1) assert.equal(rateLimit(key, 3, 60_000).ok, true);
  assert.equal(rateLimit(key, 3, 60_000).ok, false);
});
