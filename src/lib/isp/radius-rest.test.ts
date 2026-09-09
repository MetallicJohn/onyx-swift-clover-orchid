import assert from "node:assert/strict";
import { test } from "node:test";
import { attrValue, octetsFromAvps, parseAcctStatus, radiusUsername, renderFreeRadiusRestMod } from "./radius-format.ts";
import {
  authenticateRadius,
  authorizeRadius,
  handleRadiusHttp,
  newRadiusApiKey,
  presentedRadiusKey,
} from "./radius-rest.ts";
import { seal } from "./secrets.ts";
import { openTestDb } from "./test-db.ts";

test("username strips realm and rest config points at tenant slug", () => {
  assert.equal(radiusUsername("amina@imani"), "amina");
  assert.equal(radiusUsername("IMANI\\brian"), "brian");
  const conf = renderFreeRadiusRestMod({ baseUrl: "https://ops.example", slug: "imani", apiKey: "frk_test" });
  assert.match(conf, /\/api\/v1\/radius\/authorize\/imani/);
  assert.match(conf, /password = "frk_test"/);
});

test("rlm_rest AVP parser reads nested value arrays and gigawords", () => {
  const body = {
    "User-Name": { type: "string", value: ["faith"] },
    "Acct-Input-Octets": { value: [100] },
    "Acct-Input-Gigawords": { value: [1] },
    "Acct-Status-Type": { value: ["Stop"] },
  };
  assert.equal(attrValue(body, "User-Name"), "faith");
  assert.equal(octetsFromAvps(body, "Input"), 100 + 4294967296);
  assert.equal(parseAcctStatus(attrValue(body, "Acct-Status-Type")), "stop");
});

async function seedRadius(sql: Awaited<ReturnType<typeof openTestDb>>["sql"], opts?: { status?: string; enabled?: boolean; bundle?: number; used?: number }) {
  await sql`insert into tenants (id, name, slug, radius_api_key) values ('ten_fr', 'Fibre', 'fibre', ${seal("frk_live_secret")})`;
  await sql`insert into customers (id, tenant_id, name, phone) values ('cus_fr', 'ten_fr', 'Faith', '0700000001')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, grace_days, bundle_mb)
    values ('pkg_fr', 'ten_fr', 'Home 10', 'pppoe', 20, 10, 2500, 2, ${opts?.bundle ?? 0})`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end, bundle_used_mb)
    values ('svc_fr', 'ten_fr', 'cus_fr', 'pkg_fr', 'pppoe', 'faith', ${opts?.status ?? "active"}, ${new Date(Date.now() + 86400_000).toISOString()}, ${opts?.used ?? 0})`;
  await sql`insert into radius_accounts (id, tenant_id, service_id, username, password, framed_ip, group_name, enabled, rate_limit)
    values ('rad_fr', 'ten_fr', 'svc_fr', 'faith', 's3cret', '10.1.1.8', 'pppoe', ${opts?.enabled ?? true}, '10M/20M')`;
}

test("authorize accepts active users and rejects suspended or unknown", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedRadius(sql);
    await asRole("ten_fr");
    const ok = await authorizeRadius(sql, "ten_fr", { username: "faith@isp", nasIp: "10.200.0.2" });
    assert.equal(ok.result, "accept");
    const pw = ok.body["control:Cleartext-Password"] as { value: string[] };
    assert.equal(pw.value[0], "s3cret");
    const rate = ok.body["Mikrotik-Rate-Limit"] as { value: string[] };
    assert.equal(rate.value[0], "10M/20M");

    await bypass();
    await sql`update services set status = 'suspended' where id = 'svc_fr'`;
    await sql`update radius_accounts set enabled = false where id = 'rad_fr'`;
    await asRole("ten_fr");
    const no = await authorizeRadius(sql, "ten_fr", { username: "faith" });
    assert.equal(no.result, "reject");
    assert.equal(no.reason, "suspended");

    const missing = await authorizeRadius(sql, "ten_fr", { username: "ghost" });
    assert.equal(missing.reason, "unknown");
  } finally {
    await close();
  }
});

test("authenticate checks the PAP password; accounting stop records the session", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedRadius(sql);
    await asRole("ten_fr");
    const bad = await authenticateRadius(sql, "ten_fr", { username: "faith", password: "nope" });
    assert.equal(bad.reason, "bad-password");
    const good = await authenticateRadius(sql, "ten_fr", { username: "faith", password: "s3cret" });
    assert.equal(good.result, "accept");

    const http = await handleRadiusHttp(
      sql,
      "fibre",
      "accounting",
      "frk_live_secret",
      {
        "User-Name": { value: ["faith"] },
        "Acct-Status-Type": { value: ["Stop"] },
        "Acct-Session-Id": { value: ["ses-1"] },
        "Acct-Input-Octets": { value: [2048 * 1024] },
        "NAS-IP-Address": { value: ["10.200.0.2"] },
        "Framed-IP-Address": { value: ["10.1.1.8"] },
      },
    );
    assert.equal(http.status, 200);
    const [ses] = await sql<{ stopped_at: string | null; framed_ip: string }>`
      select stopped_at::text as stopped_at, framed_ip from radius_sessions where id = 'ses-1'`;
    assert.ok(ses?.stopped_at);
    assert.equal(ses?.framed_ip, "10.1.1.8");
  } finally {
    await close();
  }
});

test("REST key is required and tenant B cannot authorize tenant A", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seedRadius(sql);
    await sql`insert into tenants (id, name, slug, radius_api_key) values ('ten_x', 'Other', 'other', ${seal("frk_other")})`;
    const denied = await handleRadiusHttp(sql, "fibre", "authorize", "wrong", { "User-Name": "faith" });
    assert.equal(denied.status, 401);
    const cross = await handleRadiusHttp(sql, "other", "authorize", "frk_other", { "User-Name": "faith" });
    assert.equal(cross.status, 200);
    const body = cross.json as { "Reply-Message"?: { value: string[] } };
    assert.equal(body["Reply-Message"]?.value[0], "unknown user");
    await asRole("ten_fr");
    const ok = await handleRadiusHttp(sql, "fibre", "authorize", "frk_live_secret", { "User-Name": "faith" });
    assert.ok("control:Cleartext-Password" in ok.json);
  } finally {
    await close();
  }
});

test("bootstrap returns rest site and CIDR NAS clients", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await seedRadius(sql);
    const http = await handleRadiusHttp(sql, "fibre", "bootstrap", "frk_live_secret", {});
    assert.equal(http.status, 200);
    const pack = http.json as { rest: string; site: string; clients: string; nas_secret: string; slug: string };
    assert.equal(pack.slug, "fibre");
    assert.match(pack.rest, /\/api\/v1\/radius\/authorize\/fibre/);
    assert.match(pack.site, /port = 1812/);
    assert.match(pack.clients, /10\.200\.0\.0\/16/);
    assert.ok(pack.nas_secret.length >= 16);
  } finally {
    await close();
  }
});

test("API keys are unique enough for issuance", () => {
  assert.notEqual(newRadiusApiKey(), newRadiusApiKey());
  assert.match(newRadiusApiKey(), /^frk_/);
  const basic = presentedRadiusKey(new Request("http://x", { headers: { authorization: `Basic ${Buffer.from("gridline:frk_abc").toString("base64")}` } }));
  assert.equal(basic, "frk_abc");
  const bearer = presentedRadiusKey(new Request("http://x", { headers: { authorization: "Bearer frk_xyz" } }));
  assert.equal(bearer, "frk_xyz");
});
