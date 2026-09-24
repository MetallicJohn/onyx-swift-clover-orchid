import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCredentialAccount, isPlatformAdmin, provisionTenant } from "./accounts.ts";
import { ensureBootstrapSuperadmin } from "./bootstrap-superadmin.ts";
import { listPlatformUsers } from "./operator-users.ts";
import { ensureOperatorProfile, recordOperatorLogin } from "./operator-security.ts";
import { requestOperatorReset, requestOperatorResetOtp } from "./password-reset.ts";
import { setPortalPassword } from "./portal.ts";
import {
  authenticatePlatformPassword,
  hasPlatformCredential,
  INVALID_LOGIN_MESSAGE,
  platformSessionAllowed,
} from "./platform-login.ts";
import { openTestDb } from "./test-db.ts";

test("platform password login accepts only an active platform account", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const user = await createCredentialAccount(sql, {
      email: "owner@imani.ke",
      password: "OwnerPass1",
      name: "Amina",
    });
    await provisionTenant(sql, user.id, { ispName: "Imani", email: user.email, phone: "0712000111" });
    await ensureOperatorProfile(sql, user.id, { phone: "0712000111" });

    const ok = await authenticatePlatformPassword(sql, "  Owner@Imani.ke ", "OwnerPass1");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.userId, user.id);
      assert.equal(await platformSessionAllowed(sql, ok.userId), true);
      await recordOperatorLogin(sql, ok.userId, "127.0.0.1");
    }

    const unknown = await authenticatePlatformPassword(sql, "nobody@isp.test", "OwnerPass1");
    const wrong = await authenticatePlatformPassword(sql, "owner@imani.ke", "WrongPass1");
    assert.equal(unknown.ok, false);
    assert.equal(wrong.ok, false);
    if (!unknown.ok && !wrong.ok) assert.equal(unknown.message, wrong.message);
    assert.equal(unknown.ok ? "" : unknown.message, INVALID_LOGIN_MESSAGE);

    await sql`update operator_profiles set status = 'DISABLED' where user_id = ${user.id}`;
    const disabled = await authenticatePlatformPassword(sql, "owner@imani.ke", "OwnerPass1");
    assert.equal(disabled.ok, false);
    if (!disabled.ok) assert.equal(disabled.message, INVALID_LOGIN_MESSAGE);
    assert.equal(await platformSessionAllowed(sql, user.id), false);

    await sql`update operator_profiles set status = 'SUSPENDED' where user_id = ${user.id}`;
    const suspended = await authenticatePlatformPassword(sql, "owner@imani.ke", "OwnerPass1");
    assert.equal(suspended.ok, false);
    if (!suspended.ok) assert.equal(suspended.message, unknown.ok ? "" : unknown.message);

    const audits = await sql<{ action: string; metadata: string }>`
      select action, metadata::text as metadata from platform_audit_log`;
    const blob = JSON.stringify(audits);
    assert.equal(blob.includes("OwnerPass1"), false);
    assert.equal(blob.includes("WrongPass1"), false);
    assert.ok(audits.some((row) => row.action === "LOGIN_FAILED"));
    assert.ok(audits.some((row) => row.action === "LOGIN_SUCCESS"));
  } finally {
    await close();
  }
});

test("RouterOS, RADIUS, hotspot, and portal passwords cannot sign into the application", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const owner = await createCredentialAccount(sql, {
      email: "root@isp.solutions",
      password: "RootPass1!",
      name: "Root",
    });
    const tenant = await provisionTenant(sql, owner.id, { ispName: "Control", email: owner.email });
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_net', ${tenant.tenantId}, 'Amina', '0712333444')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_net', ${tenant.tenantId}, 'Home', 'pppoe', 10, 5, 2000)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values ('svc_net', ${tenant.tenantId}, 'cus_net', 'pkg_net', 'pppoe', 'pppoe-amina', 'active')`;
    await sql`insert into radius_accounts (id, tenant_id, service_id, username, password)
      values ('rad_net', ${tenant.tenantId}, 'svc_net', 'pppoe-amina', 'RadiusPass1')`;
    await sql`insert into routers (id, tenant_id, name, api_user, api_password)
      values ('rtr_net', ${tenant.tenantId}, 'edge', 'rosapi', 'RouterPass1')`;
    await setPortalPassword(sql, tenant.tenantId, "cus_net", "PortalPass1");

    const router = await authenticatePlatformPassword(sql, "rosapi", "RouterPass1");
    const radius = await authenticatePlatformPassword(sql, "pppoe-amina", "RadiusPass1");
    const portal = await authenticatePlatformPassword(sql, "0712333444", "PortalPass1");
    const missing = await authenticatePlatformPassword(sql, "nobody@isp.test", "NopePass1");
    for (const result of [router, radius, portal, missing]) {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.message, INVALID_LOGIN_MESSAGE);
    }

    const reset = await requestOperatorReset(sql, "pppoe-amina");
    assert.equal(reset.hint, undefined);
    const otp = await requestOperatorResetOtp(sql, "rosapi");
    assert.match(otp.message, /If an account exists|If that/i);
    const logged = JSON.stringify(await sql`select metadata::text as metadata, action from platform_audit_log`);
    assert.equal(logged.includes("RouterPass1"), false);
    assert.equal(logged.includes("RadiusPass1"), false);
    assert.equal(logged.includes("PortalPass1"), false);
  } finally {
    await close();
  }
});

test("external identities are not application sessions; superadmin uses the same login", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    const created = await ensureBootstrapSuperadmin(sql);
    assert.equal(created.created, true);
    const superLogin = await authenticatePlatformPassword(sql, "superadmin", "SuperAdmin");
    assert.equal(superLogin.ok, true);
    if (superLogin.ok) {
      assert.equal(await isPlatformAdmin(sql, superLogin.userId), true);
      assert.equal(await hasPlatformCredential(sql, superLogin.userId), true);
    }

    const googleId = "usr_google_only";
    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${googleId}, 'Google User', 'amina@gmail.com', true, now(), now())`;
    await sql`insert into account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
      values ('acc_google_only', 'google-sub', 'grok-google', ${googleId}, now(), now())`;
    const google = await authenticatePlatformPassword(sql, "amina@gmail.com", "AnyPass12");
    assert.equal(google.ok, false);
    if (!google.ok) assert.equal(google.message, INVALID_LOGIN_MESSAGE);
    assert.equal(await platformSessionAllowed(sql, googleId), false);

    const tenant = await createCredentialAccount(sql, {
      email: "staff@coast.test",
      password: "CoastPass1",
      name: "Kamau",
    });
    await provisionTenant(sql, tenant.id, { ispName: "Coast", email: tenant.email });
    const staff = await authenticatePlatformPassword(sql, "staff@coast.test", "CoastPass1");
    assert.equal(staff.ok, true);
    if (staff.ok) {
      assert.equal(await isPlatformAdmin(sql, staff.userId), false);
      await assert.rejects(() => listPlatformUsers(sql, staff.userId), /Forbidden/);
    }
  } finally {
    await close();
  }
});

test("application login does not offer external providers or a dev bypass", () => {
  const providers = readFileSync(new URL("../auth/providers.ts", import.meta.url), "utf8");
  const login = readFileSync(new URL("../../routes/login.tsx", import.meta.url), "utf8");
  const verify = readFileSync(new URL("../auth/verify.server.ts", import.meta.url), "utf8");
  const authServer = readFileSync(new URL("../auth/server.ts", import.meta.url), "utf8");
  const gate = readFileSync(new URL("../auth/gate-session.server.ts", import.meta.url), "utf8");
  assert.match(providers, /GROK_PROVIDERS: readonly GrokProvider\[\] = \[\]/);
  assert.match(providers, /applicationExternalIdentityEnabled = false/);
  assert.equal(login.includes("Continue with"), false);
  assert.equal(login.includes("signIn("), false);
  assert.match(verify, /platformSessionAllowed/);
  assert.match(verify, /NODE_ENV === "production"/);
  assert.match(authServer, /GROK_PROVIDERS\.length > 0/);
  assert.match(gate, /applicationExternalIdentityEnabled/);
  assert.equal(readFileSync(new URL("./platform-login.ts", import.meta.url), "utf8").includes("radius_accounts"), false);
  assert.equal(readFileSync(new URL("./platform-login.ts", import.meta.url), "utf8").includes("api_password"), false);
});
