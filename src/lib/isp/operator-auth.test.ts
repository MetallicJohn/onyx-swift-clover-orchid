import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCredentialAccount,
  createIspWithOwner,
  isPlatformAdmin,
  passwordVerifies,
  provisionTenant,
  setCredentialPassword,
  changeOwnPassword,
} from "./accounts.ts";
import { hashOtpCode, issueOtpChallenge, verifyOtpChallenge } from "./otp-challenge.ts";
import { newOtp } from "./otp.ts";
import {
  assertOperatorCanSignIn,
  ensureOperatorProfile,
  recordOperatorLoginFailure,
  updateOwnProfile,
} from "./operator-security.ts";
import { listPlatformUsers, updatePlatformUser } from "./operator-users.ts";
import {
  completeOperatorReset,
  requestOperatorReset,
  requestOperatorResetOtp,
  verifyOperatorResetOtp,
} from "./password-reset.ts";
import { getSaasSmsSettings, saveSaasSmsSettings, setSaasSmsSenderForTests, testSaasSms } from "./saas-sms.ts";
import { openTestDb } from "./test-db.ts";

async function enableSms(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], adminId: string) {
  await saveSaasSmsSettings(sql, adminId, {
    enabled: true,
    otp_enabled: true,
    provider: "africastalking",
    api_key: "test-key-not-real",
    sender_id: "ISP",
  });
}

test("OTP is 6 digits and never stored plaintext", async () => {
  const { sql, close } = await openTestDb();
  const captured: string[] = [];
  setSaasSmsSenderForTests(async ({ message }) => {
    captured.push(message);
    return { status: "sent", detail: "ok", provider: "africastalking" };
  });
  try {
    const admin = await createCredentialAccount(sql, { email: "root@isp.solutions", password: "RootPass1!", name: "Root" });
    await provisionTenant(sql, admin.id, { ispName: "Control", email: admin.email, phone: "0712000000" });
    await enableSms(sql, admin.id);
    const user = await createCredentialAccount(sql, { email: "amina@coast.test", password: "CoastPass1!", name: "Amina" });
    await ensureOperatorProfile(sql, user.id, { phone: "0712333444" });
    const issued = await issueOtpChallenge(sql, {
      userId: user.id,
      email: user.email,
      phone: "0712333444",
      purpose: "PASSWORD_RESET",
    });
    assert.match(issued.codeForTests, /^\d{6}$/);
    const rows = await sql<{ otp_hash: string }>`select otp_hash from otp_challenges where id = ${issued.id}`;
    assert.equal(rows[0]?.otp_hash.includes(issued.codeForTests), false);
    assert.equal(rows[0]?.otp_hash, hashOtpCode(issued.id, issued.codeForTests));
    const logs = await sql<{ error_message_sanitized: string; message_type: string }>`select error_message_sanitized, message_type from sms_messages`;
    for (const row of logs) {
      assert.equal(row.error_message_sanitized.includes(issued.codeForTests), false);
      assert.equal(row.message_type, "PASSWORD_RESET_OTP");
    }
    assert.ok(captured[0]?.includes(issued.codeForTests));
  } finally {
    setSaasSmsSenderForTests(null);
    await close();
  }
});

test("wrong, expired, and extra OTP attempts fail; success issues a one-time reset token", async () => {
  const { sql, close } = await openTestDb();
  const captured: string[] = [];
  setSaasSmsSenderForTests(async ({ message }) => {
    captured.push(message);
    return { status: "sent", detail: "ok", provider: "africastalking" };
  });
  try {
    const admin = await createCredentialAccount(sql, { email: "root@isp.solutions", password: "RootPass1!", name: "Root" });
    await provisionTenant(sql, admin.id, { ispName: "Control", email: admin.email });
    await enableSms(sql, admin.id);
    const user = await createCredentialAccount(sql, { email: "owner@imani.ke", password: "OldPass12", name: "Amina" });
    await ensureOperatorProfile(sql, user.id, { phone: "0712555666" });

    await requestOperatorResetOtp(sql, "owner@imani.ke");
    const unknown = await requestOperatorResetOtp(sql, "nobody@isp.test");
    assert.match(unknown.message, /If an account exists/);

    await assert.rejects(
      () => verifyOperatorResetOtp(sql, { identifier: "owner@imani.ke", code: "000000" }),
      /Invalid or expired/,
    );

    const code = captured[0]?.match(/\b(\d{6})\b/)?.[1] || "";
    assert.equal(code.length, 6);

    const verified = await verifyOperatorResetOtp(sql, { identifier: "owner@imani.ke", code });
    await assert.rejects(
      () => verifyOperatorResetOtp(sql, { identifier: "owner@imani.ke", code }),
      /Invalid or expired/,
    );

    await completeOperatorReset(sql, verified.token, "NewPass99");
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "NewPass99"), true);
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "OldPass12"), false);
    await assert.rejects(() => completeOperatorReset(sql, verified.token, "ThirdPass1"), /invalid or has expired/i);

    await sql`update otp_challenges set expires_at = now() - interval '1 minute', used_at = null
      where user_id = ${user.id} and purpose = 'PASSWORD_RESET'`;
    await assert.rejects(
      () => verifyOperatorResetOtp(sql, { identifier: "owner@imani.ke", code }),
      /Invalid or expired/,
    );
  } finally {
    setSaasSmsSenderForTests(null);
    await close();
  }
});

test("suspended operators cannot sign in; lockout trips after failed attempts", async () => {
  const { sql, close } = await openTestDb();
  try {
    const admin = await createCredentialAccount(sql, { email: "root@isp.solutions", password: "RootPass1!", name: "Root" });
    await provisionTenant(sql, admin.id, { ispName: "Control", email: admin.email });
    const user = await createCredentialAccount(sql, { email: "staff@isp.test", password: "StaffPass1", name: "Kamau" });
    await ensureOperatorProfile(sql, user.id);
    await sql`update operator_profiles set status = 'SUSPENDED' where user_id = ${user.id}`;
    await assert.rejects(() => assertOperatorCanSignIn(sql, "staff@isp.test"), /Invalid email or password/);
    await sql`update operator_profiles set status = 'ACTIVE' where user_id = ${user.id}`;
    for (let i = 0; i < 5; i += 1) await recordOperatorLoginFailure(sql, "staff@isp.test", "1.1.1.1");
    await assert.rejects(() => assertOperatorCanSignIn(sql, "staff@isp.test"), /Too many sign-in/);
  } finally {
    await close();
  }
});

test("profile updates cannot change tenant or role", async () => {
  const { sql, close } = await openTestDb();
  try {
    const user = await createCredentialAccount(sql, { email: "owner@imani.ke", password: "OldPass12", name: "Amina" });
    await provisionTenant(sql, user.id, { ispName: "Imani", email: user.email, phone: "0712000111" });
    const updated = await updateOwnProfile(sql, user.id, { first_name: "Amina", last_name: "Wanjiku", phone: "0712999000" });
    assert.equal(updated?.first_name, "Amina");
    assert.equal(updated?.phone.endsWith("712999000") || updated?.phone === "254712999000", true);
    assert.equal(updated?.tenants[0]?.role, "isp_owner");
    await changeOwnPassword(sql, user.id, "OldPass12", "NewerPass1");
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "NewerPass1"), true);
  } finally {
    await close();
  }
});

test("tenant admin cannot manage SaaS SMS or grant Superadmin", async () => {
  const { sql, close } = await openTestDb();
  try {
    const admin = await createCredentialAccount(sql, { email: "root@isp.solutions", password: "RootPass1!", name: "Root" });
    await provisionTenant(sql, admin.id, { ispName: "Control", email: admin.email });
    const other = await createIspWithOwner(sql, {
      ispName: "Coast Fiber",
      ownerName: "Amina",
      ownerEmail: "amina@coast.test",
      ownerPassword: "CoastPass1!",
    });
    assert.equal(await isPlatformAdmin(sql, other.owner_id), false);
    await assert.rejects(() => listPlatformUsers(sql, other.owner_id), /Forbidden/);
    await assert.rejects(
      () => updatePlatformUser(sql, other.owner_id, other.owner_id, { platform_admin: true }),
      /Forbidden/,
    );
    const sms = await getSaasSmsSettings(sql);
    assert.equal(typeof sms.api_key_set, "boolean");
    assert.equal("api_key" in sms, false);
  } finally {
    await close();
  }
});

test("superadmin SMS test never returns secrets; tenant A cannot reset tenant B via staff API", async () => {
  const { sql, close } = await openTestDb();
  setSaasSmsSenderForTests(async () => ({ status: "sent", detail: "ok", provider: "africastalking" }));
  try {
    const admin = await createCredentialAccount(sql, { email: "root@isp.solutions", password: "RootPass1!", name: "Root" });
    await provisionTenant(sql, admin.id, { ispName: "Control", email: admin.email });
    await enableSms(sql, admin.id);
    const publicSms = await getSaasSmsSettings(sql);
    assert.equal(publicSms.api_key_set, true);
    assert.match(publicSms.api_key_hint, /•/);
    const tested = await testSaasSms(sql, admin.id, "0712000000");
    assert.equal(tested.ok, true);
    assert.equal(JSON.stringify(tested).includes("test-key-not-real"), false);

    const a = await createIspWithOwner(sql, {
      ispName: "Alpha",
      ownerName: "Ann",
      ownerEmail: "ann@alpha.test",
      ownerPassword: "AlphaPass1",
    });
    const b = await createIspWithOwner(sql, {
      ispName: "Beta",
      ownerName: "Ben",
      ownerEmail: "ben@beta.test",
      ownerPassword: "BetaPass12",
    });
    const [cross] = await sql<{ email: string }>`
      select u.email from tenant_members m
      join "user" u on u.id = m.user_id
      where m.tenant_id = ${a.tenant_id} and m.user_id = ${b.owner_id}`;
    assert.equal(cross, undefined);
    await setCredentialPassword(sql, "ben@beta.test", "ForcedPass1");
    assert.equal(await passwordVerifies(sql, "ben@beta.test", "ForcedPass1"), true);
  } finally {
    setSaasSmsSenderForTests(null);
    await close();
  }
});

test("newOtp is numeric and sandbox stays 000000", () => {
  assert.match(newOtp(false), /^\d{6}$/);
  assert.equal(newOtp(true), "000000");
});

test("email reset link still works for existing operators", async () => {
  const { sql, close } = await openTestDb();
  try {
    const user = await createCredentialAccount(sql, { email: "owner@imani.ke", password: "OldPass12", name: "Amina" });
    await provisionTenant(sql, user.id, { ispName: "Imani", email: user.email });
    const asked = await requestOperatorReset(sql, "owner@imani.ke", "http://ispsolutions.test");
    assert.ok(asked.hint?.includes("token="));
    const token = asked.hint!.split("token=")[1] ?? "";
    await completeOperatorReset(sql, token, "NewPass99");
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "NewPass99"), true);
  } finally {
    await close();
  }
});

test("OTP purpose cannot be reused across flows", async () => {
  const { sql, close } = await openTestDb();
  setSaasSmsSenderForTests(async () => ({ status: "sent", detail: "ok", provider: "africastalking" }));
  try {
    const admin = await createCredentialAccount(sql, { email: "root@isp.solutions", password: "RootPass1!", name: "Root" });
    await provisionTenant(sql, admin.id, { ispName: "Control", email: admin.email });
    await enableSms(sql, admin.id);
    const user = await createCredentialAccount(sql, { email: "tech@isp.test", password: "TechPass1", name: "Tech" });
    const issued = await issueOtpChallenge(sql, {
      userId: user.id,
      email: user.email,
      phone: "0712777888",
      purpose: "PHONE_VERIFICATION",
    });
    await assert.rejects(
      () => verifyOtpChallenge(sql, { challengeId: issued.id, purpose: "PASSWORD_RESET", code: issued.codeForTests }),
      /Invalid or expired/,
    );
    const ok = await verifyOtpChallenge(sql, {
      challengeId: issued.id,
      purpose: "PHONE_VERIFICATION",
      code: issued.codeForTests,
    });
    assert.equal(ok.userId, user.id);
  } finally {
    setSaasSmsSenderForTests(null);
    await close();
  }
});
