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
import { openTestDb } from "./test-db.ts";

test("ACS username, connection-request user, and URL are tenant-specific", () => {
  assert.equal(acsUsernameFor("imani-networks"), "tenant_imani_networks");
  assert.equal(acsConnreqUserFor("imani-networks"), "cr_imani_networks");
  assert.notEqual(acsUsernameFor("alpha"), acsUsernameFor("beta"));
  assert.equal(buildAcsUrl("203.0.113.10", 7551), "http://203.0.113.10:7551/");
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
    assert.equal(first.username, "tenant_fibre_ke");
    assert.equal(first.connreq_user, "cr_fibre_ke");
    assert.notEqual(first.connreq_user, first.username);
    assert.equal(first.cwmp_url, "http://203.0.113.10:7551/");
    assert.equal(first.cwmp_port, 7551);
    assert.equal(first.password.length, 32);
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
    const revealed = await revealAcsSecrets(sql, "ten_acs2", "usr_1");
    const snip = oltSnippets(revealed);
    assert.match(snip.huawei, /203\.0\.113\.10:7551/);
    assert.match(snip.zte, /tenant_fibre_ke/);
    assert.match(snip.fiberhome, /inform-interval 600/);
    assert.match(snip.params, /ConnectionRequestUsername=cr_fibre_ke/);
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
    assert.equal(a.username, "tenant_alpha");
    assert.equal(b.username, "tenant_beta");
    assert.notEqual(a.password, b.password);
    assert.notEqual(a.cwmp_port, b.cwmp_port);
    await asRole("ten_a");
    const peek = await loadAcsCredentials(sql, "ten_b");
    assert.equal(peek, null);
  } finally {
    await close();
  }
});
