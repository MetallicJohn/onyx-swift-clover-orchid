import { randomInt } from "node:crypto";

/** Cryptographically random 6-digit OTP. Sandbox portal logins keep a fixed demo code. */
export function newOtp(sandbox = false) {
  if (sandbox) return "000000";
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
