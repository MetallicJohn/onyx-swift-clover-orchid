import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("login, profile, OTP, and Superadmin SMS/user pages exist", () => {
  const login = readFileSync(new URL("../../routes/login.tsx", import.meta.url), "utf8");
  const forgot = readFileSync(new URL("../../routes/forgot-password.tsx", import.meta.url), "utf8");
  const otp = readFileSync(new URL("../../routes/verify-otp.tsx", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../../routes/app/profile.tsx", import.meta.url), "utf8");
  const security = readFileSync(new URL("../../routes/app/profile.security.tsx", import.meta.url), "utf8");
  const sms = readFileSync(new URL("../../routes/platform/settings.sms.tsx", import.meta.url), "utf8");
  const users = readFileSync(new URL("../../routes/platform/users.tsx", import.meta.url), "utf8");
  const otpSrc = readFileSync(new URL("./otp.ts", import.meta.url), "utf8");
  const challenge = readFileSync(new URL("./otp-challenge.ts", import.meta.url), "utf8");
  const smsLib = readFileSync(new URL("./saas-sms.ts", import.meta.url), "utf8");

  assert.match(login, /Forgot password\?/);
  assert.match(login, /\/forgot-password/);
  assert.match(forgot, /requestPasswordReset/);
  assert.match(otp, /verifyPasswordResetOtp/);
  assert.match(profile, /getMyProfile/);
  assert.match(security, /changeMyPassword/);
  assert.match(sms, /saveSaasSmsGateway/);
  assert.match(sms, /testSaasSmsGateway/);
  assert.match(users, /listSaasUsers/);
  assert.match(otpSrc, /randomInt/);
  assert.doesNotMatch(otpSrc, /Math\.random/);
  assert.match(challenge, /otp_hash/);
  assert.doesNotMatch(challenge, /console\.log/);
  assert.match(smsLib, /sendSms/);
  assert.match(smsLib, /api_key_hint/);
});
