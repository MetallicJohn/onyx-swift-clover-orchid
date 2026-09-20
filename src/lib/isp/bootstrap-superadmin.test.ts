import assert from "node:assert/strict";
import { test } from "node:test";
import { changeOwnPassword, createCredentialAccount, isPlatformAdmin, passwordVerifies, provisionTenant } from "./accounts.ts";
import { ensureBootstrapSuperadmin, BOOTSTRAP_SUPERADMIN_EMAIL, BOOTSTRAP_SUPERADMIN_USERNAME } from "./bootstrap-superadmin.ts";
import { loginDestination, normalizeLoginEmail } from "./login-next.ts";
import { assertPasswordPolicy } from "./operator-security.ts";
import { openTestDb } from "./test-db.ts";

const INITIAL = "SuperAdmin";

test("fresh install creates exactly one platform Superadmin with a hashed password and no tenant", async () => {
  const { sql, close } = await openTestDb();
  try {
    const first = await ensureBootstrapSuperadmin(sql);
    assert.equal(first.created, true);
    const second = await ensureBootstrapSuperadmin(sql);
    assert.equal(second.created, false);

    const users = await sql<{ id: string; email: string; n: number }>`
      select id, email, 1 as n from "user" where lower(email) = ${BOOTSTRAP_SUPERADMIN_EMAIL}`;
    assert.equal(users.length, 1);
    const user = users[0]!;
    const [cred] = await sql<{ password: string }>`
      select password from account where "userId" = ${user.id} and "providerId" = 'credential'`;
    assert.ok(cred?.password);
    assert.notEqual(cred.password, INITIAL);
    assert.equal(cred.password.toLowerCase().includes("superadmin"), false);
    assert.equal(await passwordVerifies(sql, BOOTSTRAP_SUPERADMIN_USERNAME, INITIAL), true);
    assert.equal(await isPlatformAdmin(sql, user.id), true);

    const members = await sql<{ n: number }>`select count(*)::int as n from tenant_members where user_id = ${user.id}`;
    assert.equal(members[0]?.n ?? 0, 0);
    const tenants = await sql<{ n: number }>`select count(*)::int as n from tenants`;
    assert.equal(tenants[0]?.n ?? 0, 0);

    const [profile] = await sql<{ is_default_password: boolean }>`
      select is_default_password from operator_profiles where user_id = ${user.id}`;
    assert.equal(profile?.is_default_password, true);

    const audits = await sql<{ action: string; metadata: string }>`
      select action, metadata from platform_audit_log where action = ${"PLATFORM_SUPERADMIN_CREATED"}`;
    assert.equal(audits.length, 1);
    assert.equal(JSON.stringify(audits[0]).includes(INITIAL), false);
  } finally {
    await close();
  }
});

test("redeploy does not reset the Superadmin password or create a duplicate", async () => {
  const { sql, close } = await openTestDb();
  try {
    await ensureBootstrapSuperadmin(sql);
    const user = await createCredentialAccount(sql, {
      email: "ops@isp.test",
      password: "OpsPass12",
      name: "Ops",
    }).catch(() => null);
    void user;
    await changeOwnPassword(sql, "usr_platform_superadmin", INITIAL, "NewSafePass1");
    assert.equal(await passwordVerifies(sql, BOOTSTRAP_SUPERADMIN_EMAIL, INITIAL), false);
    assert.equal(await passwordVerifies(sql, BOOTSTRAP_SUPERADMIN_USERNAME, "NewSafePass1"), true);

    const again = await ensureBootstrapSuperadmin(sql);
    assert.equal(again.created, false);
    assert.equal(await passwordVerifies(sql, BOOTSTRAP_SUPERADMIN_EMAIL, "NewSafePass1"), true);
    assert.equal(await passwordVerifies(sql, BOOTSTRAP_SUPERADMIN_EMAIL, INITIAL), false);

    const [n] = await sql<{ n: number }>`select count(*)::int as n from "user" where lower(email) = ${BOOTSTRAP_SUPERADMIN_EMAIL}`;
    assert.equal(n?.n, 1);
    const [profile] = await sql<{ is_default_password: boolean }>`
      select is_default_password from operator_profiles where user_id = ${"usr_platform_superadmin"}`;
    assert.equal(profile?.is_default_password, false);

    const events = await sql<{ action: string }>`
      select action from platform_audit_log where action = ${"PLATFORM_SUPERADMIN_DEFAULT_PASSWORD_CHANGED"}`;
    assert.equal(events.length >= 1, true);
  } finally {
    await close();
  }
});

test("existing platform Superadmin is left alone and tenant signup still creates an ISP, not a tenant Superadmin", async () => {
  const { sql, close } = await openTestDb();
  try {
    await ensureBootstrapSuperadmin(sql);
    const owner = await createCredentialAccount(sql, {
      email: "amina@coast.test",
      password: "CoastPass1!",
      name: "Amina",
    });
    const ws = await provisionTenant(sql, owner.id, { ispName: "Coast Fiber", email: owner.email, phone: "0712000000" });
    assert.equal(ws.role, "isp_owner");
    assert.equal(await isPlatformAdmin(sql, owner.id), false);
    const [superMembers] = await sql<{ n: number }>`
      select count(*)::int as n from tenant_members where user_id = ${"usr_platform_superadmin"}`;
    assert.equal(superMembers?.n ?? 0, 0);
    const skipped = await ensureBootstrapSuperadmin(sql);
    assert.equal(skipped.created, false);
  } finally {
    await close();
  }
});

test("default password is rejected as the new password", () => {
  assert.throws(() => assertPasswordPolicy(INITIAL), /less common/i);
});

test("superadmin username maps to the platform login and SaaS console", () => {
  assert.equal(normalizeLoginEmail("SuperAdmin"), BOOTSTRAP_SUPERADMIN_EMAIL);
  assert.equal(normalizeLoginEmail("superadmin"), BOOTSTRAP_SUPERADMIN_EMAIL);
  assert.equal(loginDestination("", "in", "superadmin"), "/platform");
  assert.equal(loginDestination("?next=/app", "in", "superadmin"), "/platform");
  assert.equal(loginDestination("", "up", "superadmin"), "/app");
  assert.equal(loginDestination("", "in", "amina@coast.test"), "/app");
});
