import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acsConnreqUserFor,
  acsUsernameFor,
  generateAcsCredentials,
  loadAcsCredentials,
  oltSnippets,
  revealAcsSecrets,
  saveAcsCredentialSettings,
} from "./acs-credentials.ts";
import { buildAcsUrl } from "./acs-ports.ts";
import { createCredentialAccount, provisionTenant } from "./accounts.ts";
import { getPlatformSettings, savePlatformSettings } from "./platform.ts";
import { seal } from "./secrets.ts";
import { openTestDb } from "./test-db.ts";

test("ACS username uses the ISP name and stays within the configured length", () => {
  assert.equal(acsUsernameFor("imani-networks"), "imaninetwork");
  assert.equal(acsUsernameFor("fibre-ke"), "fibreke");
  assert.equal(acsConnreqUserFor("fibre-ke", 12, "fibreke"), "cfibreke");
  assert.equal(acsUsernameFor("imani-networks", 24).length <= 24, true);
  assert.notEqual(acsUsernameFor("alpha"), acsUsernameFor("beta"));
  assert.equal(buildAcsUrl("203.0.113.10", 7551), "http://203.0.113.10:7551/");
  assert.equal(buildAcsUrl("203.0.113.10", 7551, "https"), "https://203.0.113.10:7551/");
});

test("generate issues unique sealed credentials, masks on load, and reveal is audited", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_public_host', '203.0.113.10')
      on conflict (key) do update set value = '203.0.113.10'`;
    await sql`insert into tenants (id, name, slug, public_base_url)
      values ('ten_acs2', 'Fibre', 'fibre-ke', 'https://ops.fibre.ke')`;
    await asRole("ten_acs2");
    const first = await generateAcsCredentials(sql, {
      tenantId: "ten_acs2",
      slug: "fibre-ke",
      publicBase: "https://ops.fibre.ke",
      userId: "usr_1",
    });
    assert.equal(first.username, "fibreke");
    assert.equal(first.connreq_user, "cfibreke");
    assert.notEqual(first.connreq_user, first.username);
    assert.equal(first.cwmp_url, "http://203.0.113.10:7551/");
    assert.equal(first.cwmp_port, 7551);
    assert.equal(first.password.length, 12);
    assert.equal(first.connreq_password.length, 12);
    assert.match(first.password, /^fibr[a-z0-9]+$/);
    assert.equal(first.credentials_fit, true);
    assert.notEqual(first.password, first.connreq_password);
    const masked = await loadAcsCredentials(sql, "ten_acs2");
    assert.equal(masked?.password, "");
    assert.match(masked?.password_hint || "", /•/);
    const again = await generateAcsCredentials(sql, {
      tenantId: "ten_acs2",
      slug: "fibre-ke",
    });
    assert.equal(again.password, first.password);
    const rotated = await generateAcsCredentials(sql, {
      tenantId: "ten_acs2",
      slug: "fibre-ke",
      rotate: true,
      userId: "usr_1",
    });
    assert.notEqual(rotated.password, first.password);
    assert.equal(rotated.username, first.username);
    const saved = await saveAcsCredentialSettings(sql, "ten_acs2", {
      inform_interval: 600,
      enabled: true,
    });
    assert.equal(saved?.inform_interval, 600);
    assert.equal(saved?.cwmp_url, first.cwmp_url);
    await assert.rejects(
      () => saveAcsCredentialSettings(sql, "ten_acs2", { credential_length: 25 }),
      /24/,
    );
    const sized = await saveAcsCredentialSettings(sql, "ten_acs2", { credential_length: 16 });
    assert.equal(sized?.credential_length, 16);
    assert.equal(sized?.credentials_fit, false);
    const resized = await generateAcsCredentials(sql, {
      tenantId: "ten_acs2",
      slug: "fibre-ke",
      rotate: true,
      userId: "usr_1",
    });
    assert.equal(resized.password.length, 16);
    assert.equal(resized.connreq_password.length, 16);
    assert.equal(resized.username.length <= 16, true);
    assert.match(resized.username, /fibre/);
    assert.equal(resized.credentials_fit, true);
    const revealed = await revealAcsSecrets(sql, "ten_acs2", "usr_1");
    const snip = oltSnippets(revealed);
    assert.match(snip.huawei, /203\.0\.113\.10:7551/);
    assert.match(snip.zte, /fibreke/);
    assert.match(snip.fiberhome, /inform-interval 600/);
    assert.match(snip.params, /ConnectionRequestUsername=cfibreke/);
    assert.match(snip.tenda, /ACS username: fibreke/);
    const [audit] = await sql<{ n: number }>`select count(*)::int as n from audit_logs where tenant_id = 'ten_acs2' and action like 'acs.%'`;
    assert.ok((audit?.n ?? 0) >= 3);
    const blob = JSON.stringify(await sql`select action, details from audit_logs where tenant_id = 'ten_acs2'`);
    assert.equal(blob.includes(rotated.password), false);
  } finally {
    await close();
  }
});

test("two ISPs get different ACS usernames and ports", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into platform_settings (key, value) values ('acs_public_host', 'acs.example.com')
      on conflict (key) do update set value = 'acs.example.com'`;
    await sql`insert into tenants (id, name, slug) values ('ten_a', 'A', 'alpha'), ('ten_b', 'B', 'beta')`;
    await asRole("ten_a");
    const a = await generateAcsCredentials(sql, { tenantId: "ten_a", slug: "alpha" });
    await asRole("ten_b");
    const b = await generateAcsCredentials(sql, { tenantId: "ten_b", slug: "beta" });
    assert.equal(a.username, "alpha");
    assert.equal(b.username, "beta");
    assert.equal(a.password.length, 12);
    assert.equal(b.password.length, 12);
    assert.notEqual(a.password, b.password);
    assert.notEqual(a.cwmp_port, b.cwmp_port);
    await asRole("ten_a");
    const peek = await loadAcsCredentials(sql, "ten_b");
    assert.equal(peek, null);
  } finally {
    await close();
  }
});

test("platform default length is configurable, capped at 24, and does not rewrite existing secrets", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    const admin = await createCredentialAccount(sql, {
      email: "acs-root@isp.solutions",
      password: "RootPass1!",
      name: "Platform",
    });
    await provisionTenant(sql, admin.id, { ispName: "Control Plane", email: admin.email });
    await sql`insert into platform_settings (key, value) values ('acs_public_host', '203.0.113.20')
      on conflict (key) do update set value = '203.0.113.20'`;
    await assert.rejects(() => savePlatformSettings(sql, admin.id, { acs_credential_length: 30 }), /24/);
    await assert.rejects(() => savePlatformSettings(sql, admin.id, { acs_credential_length: 7 }), /8/);
    const saved = await savePlatformSettings(sql, admin.id, { acs_credential_length: 10 });
    assert.equal(saved.acs_credential_length, 10);
    assert.equal((await getPlatformSettings(sql)).acs_credential_length, 10);

    await sql`insert into tenants (id, name, slug) values
      ('ten_nai', 'Nairobi Fiber', 'nairobi'),
      ('ten_oldacs', 'Old ACS', 'old-acs')`;
    const legacyPass = "0123456789abcdef0123456789abcdef";
    await sql`insert into acs_isp_credentials
      (tenant_id, username, connreq_user, password_ref, connreq_pass_ref, credential_length, enabled)
      values ('ten_oldacs', 'tenant_old_acs', 'cr_old_acs', ${seal(legacyPass)}, ${seal(`${legacyPass}x`)}, 32, true)`;

    await asRole("ten_nai");
    const fresh = await generateAcsCredentials(sql, { tenantId: "ten_nai", slug: "nairobi", userId: "usr_acs" });
    assert.equal(fresh.username, "nairobi");
    assert.equal(fresh.connreq_user, "cnairobi");
    assert.equal(fresh.password.length, 10);
    assert.equal(fresh.connreq_password.length, 10);
    assert.match(fresh.password, /^nair[a-z0-9]+$/);
    assert.equal(fresh.credentials_fit, true);

    await bypass();
    await savePlatformSettings(sql, admin.id, { acs_credential_length: 14 });
    await asRole("ten_nai");
    const same = await generateAcsCredentials(sql, { tenantId: "ten_nai", slug: "nairobi" });
    assert.equal(same.password, fresh.password);
    assert.equal(same.username, "nairobi");
    assert.equal(same.credential_length, 10);

    await asRole("ten_oldacs");
    const legacy = await loadAcsCredentials(sql, "ten_oldacs", { secrets: true });
    assert.equal(legacy?.password, legacyPass);
    assert.equal(legacy?.credentials_fit, false);
    assert.equal(legacy?.credential_length, 14);
    const rotated = await generateAcsCredentials(sql, {
      tenantId: "ten_oldacs",
      slug: "old-acs",
      rotate: true,
      userId: "usr_acs",
    });
    assert.equal(rotated.password.length, 14);
    assert.notEqual(rotated.password, legacyPass);
    assert.equal(rotated.username, "oldacs");
    assert.equal(rotated.username.includes("_"), false);
    assert.equal(rotated.credentials_fit, true);
    const [raw] = await sql<{ password_ref: string }>`select password_ref from acs_isp_credentials where tenant_id = 'ten_oldacs'`;
    assert.equal((raw?.password_ref || "").includes(rotated.password), false);
    assert.match(raw?.password_ref || "", /^enc:v1:/);
    const blob = JSON.stringify(await sql`select details from audit_logs where tenant_id = 'ten_oldacs'`);
    assert.equal(blob.includes(rotated.password), false);
  } finally {
    await close();
  }
});
