import assert from "node:assert/strict";
import { test } from "node:test";
import { enrollFields } from "./agent.ts";
import {
  HOTSPOT_HTML_FILES,
  isHotspotHtmlFile,
} from "./hotspot-dashboard-format.ts";
import {
  confirmHotspotDeploy,
  generateHotspotFiles,
  getHotspotHtmlFile,
  interpretHotspotDeploy,
  normalizePortalSettings,
  recordHotspotDeployment,
  requiredHotspotFilesPresent,
  saveHotspotPortalSettings,
  sanitizePortalCss,
  serveHotspotHtmlFile,
} from "./hotspot-portal.ts";
import { compileMikrotik } from "./mikrotik.ts";
import { commandRosScript } from "./routeros.ts";
import { validateRosScript } from "./mikrotik-ops.ts";
import { openTestDb } from "./test-db.ts";

test("portal generator emits every required RouterOS file", () => {
  const files = generateHotspotFiles(
    normalizePortalSettings({
      title: "Imani Wi-Fi",
      welcome: "Connect",
      show_voucher: true,
      show_customer: true,
      terms: "No abuse.",
      support_phone: "0700000000",
    }),
    [{ id: "p1", name: "Day pass", price_kes: 100, validity_hours: 24, download_mbps: 10, upload_mbps: 10, bundle_mb: 0, description: "", duration_value: 1, duration_unit: "days", duration_label: "1 Day" }],
  );
  assert.equal(requiredHotspotFilesPresent(files), true);
  for (const name of HOTSPOT_HTML_FILES) assert.ok(files[name].length > 20);
  assert.match(files["login.html"], /\$\(link-login-only\)/);
  assert.match(files["login.html"], /\$\(chap-id\)/);
  assert.match(files["login.html"], /md5\.js/);
  assert.match(files["login.html"], /hexMD5/);
  assert.match(files["login.html"], /Day pass/);
  assert.match(files["login.html"], /BUY/);
  assert.match(files["status.html"], /\$\(link-logout\)/);
  assert.match(files["logout.html"], /\$\(link-login\)/);
  assert.match(files["error.html"], /\$\(error\)/);
  assert.match(files["alogin.html"], /\$\(link-redirect\)/);
  assert.match(files["login.html"], /name="login"/);
  const customerOnly = generateHotspotFiles(normalizePortalSettings({ show_voucher: false, show_customer: true }));
  assert.match(customerOnly["login.html"], /name="login"/);
  assert.match(customerOnly["login.html"], /Username/);
  assert.equal(isHotspotHtmlFile("login.html"), true);
  assert.equal(isHotspotHtmlFile("evil.html"), false);
});

test("custom CSS cannot inject script", () => {
  const css = sanitizePortalCss("body{color:red} </style><script>alert(1)</script> @import url(x)");
  assert.doesNotMatch(css, /<script/i);
  assert.doesNotMatch(css, /@import/);
});

test("queued or simulated deploys are never verified", () => {
  assert.equal(interpretHotspotDeploy({ commandStatus: "queued" }).verified, false);
  assert.equal(interpretHotspotDeploy({ commandStatus: "queued" }).status, "queued");
  assert.equal(interpretHotspotDeploy({ commandStatus: "acked", commandResult: "simulated REST (no api_host)" }).verified, false);
  assert.equal(interpretHotspotDeploy({ commandStatus: "acked", commandResult: "simulated REST (no api_host)" }).status, "waiting_for_router");
  assert.equal(interpretHotspotDeploy({ commandStatus: "acked", commandResult: "ok" }).verified, false);
  assert.equal(interpretHotspotDeploy({ commandStatus: "acked", commandResult: "portal ok" }).verified, true);
  assert.equal(interpretHotspotDeploy({ commandStatus: "acked", verified: true }).verified, true);
  assert.equal(interpretHotspotDeploy({ commandStatus: "failed", commandResult: "missing" }).status, "failed");
});

test("hotspot.portal.deploy compiles before hotspot user upsert", () => {
  const compiled = compileMikrotik("hotspot.portal.deploy", {
    html_base: "https://isp.example/api/v1/hotspot/html",
    token: "agt_testtoken",
    files: [...HOTSPOT_HTML_FILES],
    dst_dir: "hotspot",
    verify_ok: "https://isp.example/api/v1/hotspot/deploy-verify?token=agt_testtoken&id=hdep_1&ok=1",
    verify_fail: "https://isp.example/api/v1/hotspot/deploy-verify?token=agt_testtoken&id=hdep_1&ok=0",
  });
  assert.deepEqual(validateRosScript(compiled.script), []);
  assert.match(compiled.script, /\/tool fetch url=\$url dst-path=\$path/);
  assert.match(compiled.script, /portal ok/);
  assert.doesNotMatch(compiled.script, /check-certificate\s*=\s*no/i);
  assert.doesNotMatch(compiled.script, /\/ip hotspot user add/);
  assert.ok(compiled.rest.some((op) => op.path === "/rest/tool/fetch" && op.body?.url?.includes("login.html")));
  const user = compileMikrotik("hotspot.upsert", { username: "HS-ABC", password: "x" });
  assert.match(user.script, /\/ip hotspot user add/);
  const missing = commandRosScript("hotspot.portal.deploy", {});
  assert.match(missing, /missing hotspot portal url/);
});

test("portal settings, html serve, and deploy verify are tenant isolated", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_pa', 'A', 'hs-a'), ('ten_pb', 'B', 'hs-b')`;
    const a = enrollFields("hs-a");
    const b = enrollFields("hs-b");
    await sql`insert into routers (id, tenant_id, name, identity, role, enroll_token, wg_status)
      values ('rtr_pa', 'ten_pa', 'A-HS', 'a-hs', 'hotspot', ${a.token}, 'connected'),
             ('rtr_pb', 'ten_pb', 'B-HS', 'b-hs', 'hotspot', ${b.token}, 'connected')`;
    await asRole("ten_pa");
    const saved = await saveHotspotPortalSettings(sql, "ten_pa", { title: "Alpha Wi-Fi", welcome: "Hello A" });
    assert.equal(saved.title, "Alpha Wi-Fi");
    const file = await getHotspotHtmlFile(sql, "ten_pa", "login.html");
    assert.ok(file?.body.includes("Alpha Wi-Fi"));
    const served = await serveHotspotHtmlFile(sql, a.token, "login.html");
    assert.equal(served.status, 200);
    assert.match(served.body, /Alpha Wi-Fi/);
    const other = await serveHotspotHtmlFile(sql, b.token, "login.html");
    assert.equal(other.status, 200);
    assert.doesNotMatch(other.body, /Alpha Wi-Fi/);
    await asRole("ten_pa");
    const dep = await recordHotspotDeployment(sql, {
      tenantId: "ten_pa",
      routerId: "rtr_pa",
      commandId: null,
      status: "queued",
    });
    const ok = await confirmHotspotDeploy(sql, a.token, dep, true);
    assert.equal(ok.ok, true);
    assert.equal(ok.verified, true);
    const stolen = await confirmHotspotDeploy(sql, b.token, dep, true);
    assert.equal(stolen.ok, false);
    const unknownFile = await serveHotspotHtmlFile(sql, a.token, "passwd");
    assert.equal(unknownFile.status, 404);
  } finally {
    await close();
  }
});
