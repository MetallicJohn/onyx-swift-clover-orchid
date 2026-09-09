import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeOwnPassword,
  createCredentialAccount,
  passwordVerifies,
  provisionTenant,
  setCredentialPassword,
} from "./accounts.ts";
import { completeOperatorReset, completePortalPasswordReset, requestOperatorReset } from "./password-reset.ts";
import { changePortalPassword, issuePortalOtp, portalPasswordLogin, setPortalPassword } from "./portal.ts";
import { openTestDb } from "./test-db.ts";

test("unknown email does not leak a reset link", async () => {
  const { sql, close } = await openTestDb();
  try {
    const r = await requestOperatorReset(sql, "nobody@isp.test");
    assert.equal(r.sent, true);
    assert.equal(r.hint, undefined);
  } finally {
    await close();
  }
});

test("operator reset replaces the password and cannot be reused", async () => {
  const { sql, close } = await openTestDb();
  try {
    const user = await createCredentialAccount(sql, {
      email: "owner@imani.ke",
      password: "OldPass12",
      name: "Amina",
    });
    await provisionTenant(sql, user.id, { ispName: "Imani", email: user.email });
    const asked = await requestOperatorReset(sql, "owner@imani.ke", "http://gridline.test");
    assert.ok(asked.hint?.includes("token="));
    const token = asked.hint!.split("token=")[1] ?? "";
    await completeOperatorReset(sql, token, "NewPass99");
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "NewPass99"), true);
    assert.equal(await passwordVerifies(sql, "owner@imani.ke", "OldPass12"), false);
    await assert.rejects(() => completeOperatorReset(sql, token, "ThirdPass1"), /invalid or has expired/i);
  } finally {
    await close();
  }
});

test("superadmin can set an operator password directly", async () => {
  const { sql, close } = await openTestDb();
  try {
    await createCredentialAccount(sql, { email: "staff@isp.test", password: "TempPass1", name: "Kamau" });
    await setCredentialPassword(sql, "staff@isp.test", "ForcedPass1");
    assert.equal(await passwordVerifies(sql, "staff@isp.test", "ForcedPass1"), true);
  } finally {
    await close();
  }
});

test("customer portal password login and OTP reset", async () => {
  const { sql, close } = await openTestDb();
  try {
    const owner = await createCredentialAccount(sql, {
      email: "boss@isp.test",
      password: "OwnerPass1",
      name: "Boss",
    });
    const ws = await provisionTenant(sql, owner.id, { ispName: "Northline" });
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_p', ${ws.tenantId}, 'Dina', '0712000111')`;
    await assert.rejects(
      () => portalPasswordLogin(sql, ws.slug, "0712000111", "Portal99!"),
      /No portal password/,
    );
    await setPortalPassword(sql, ws.tenantId, "cus_p", "Portal99!");
    const session = await portalPasswordLogin(sql, ws.slug, "0712000111", "Portal99!");
    assert.ok(session.token.startsWith("prt_"));
    await assert.rejects(() => portalPasswordLogin(sql, ws.slug, "0712000111", "wrong-pass"), /Wrong phone or password/);

    const otp = await issuePortalOtp(sql, ws.slug, "0712000111");
    const reset = await completePortalPasswordReset(sql, {
      slug: ws.slug,
      phone: "0712000111",
      code: otp.hint,
      password: "ResetPass1",
    });
    assert.ok(reset.token.startsWith("prt_"));
    await portalPasswordLogin(sql, ws.slug, "0712000111", "ResetPass1");
    await assert.rejects(
      () => changePortalPassword(sql, ws.tenantId, "cus_p", "wrong", "NewerPass1"),
      /Current password is wrong/,
    );
    await changePortalPassword(sql, ws.tenantId, "cus_p", "ResetPass1", "NewerPass1");
    await portalPasswordLogin(sql, ws.slug, "0712000111", "NewerPass1");
  } finally {
    await close();
  }
});

test("signed-in operator must prove the current password", async () => {
  const { sql, close } = await openTestDb();
  try {
    const user = await createCredentialAccount(sql, {
      email: "ops@isp.test",
      password: "Current12",
      name: "Ops",
    });
    await assert.rejects(() => changeOwnPassword(sql, user.id, "nope", "NextPass12"), /Current password is wrong/);
    await changeOwnPassword(sql, user.id, "Current12", "NextPass12");
    assert.equal(await passwordVerifies(sql, "ops@isp.test", "NextPass12"), true);
    assert.equal(await passwordVerifies(sql, "ops@isp.test", "Current12"), false);
  } finally {
    await close();
  }
});
