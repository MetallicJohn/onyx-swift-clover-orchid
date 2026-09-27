import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  deliverSms,
  getMessagingSettings,
  probeSmsGateway,
  saveMessagingSettings,
  saveSmsGatewaySettings,
  toPublic,
} from "./messaging.ts";
import {
  buildSmsProbe,
  buildSmsRequest,
  emptyGateway,
  gatewayConfigured,
  mergeGatewayConfig,
  mergeGatewayStore,
  NEW_SMS_GATEWAYS,
  parseGatewayStore,
  smsGatewayFields,
  SMS_GATEWAY_SAVE_OK,
  SMS_SEND_OK,
  validateGateway,
  type SmsGatewayConfig,
  type SmsGatewayId,
} from "./sms-gateways.ts";
import { openTestDb } from "./test-db.ts";

function cfg(partial: Partial<SmsGatewayConfig>): SmsGatewayConfig {
  return { ...emptyGateway("texin"), ...partial };
}

function keys(body: Record<string, string> | undefined) {
  return Object.keys(body || {}).sort();
}

test("SMS gateway requests send only that provider's fields", () => {
  const hostKey = cfg({ apiKey: "hp-key", senderId: "IMANI", messageType: "text" });
  const hostKeyReq = buildSmsRequest("hostpinnacle", hostKey, { mobile: "254712345678", to: "+254712345678", message: "Pay" });
  assert.equal(hostKeyReq.url, "https://smsportal.hostpinnacle.co.ke/SMSApi/send");
  assert.equal(hostKeyReq.form, true);
  assert.equal(hostKeyReq.body?.apikey, "hp-key");
  assert.equal(hostKeyReq.body?.senderid, "IMANI");
  assert.equal(hostKeyReq.body?.msgType, "text");
  assert.equal(hostKeyReq.body?.userid, undefined);
  assert.equal(hostKeyReq.body?.password, undefined);

  const hostPw = cfg({ auth: "password", userId: "hp-user", password: "hp-pass", senderId: "IMANI", messageType: "unicode" });
  const hostPwReq = buildSmsRequest("hostpinnacle", hostPw, { mobile: "254712345678", to: "+254712345678", message: "Pay" });
  assert.equal(hostPwReq.body?.userid, "hp-user");
  assert.equal(hostPwReq.body?.password, "hp-pass");
  assert.equal(hostPwReq.body?.apikey, undefined);
  assert.equal(smsGatewayFields("hostpinnacle", hostPw).some((field) => field.key === "apiKey"), false);
  assert.equal(smsGatewayFields("hostpinnacle", hostKey).some((field) => field.key === "password"), false);

  const texin = buildSmsRequest("texin", cfg({ apiKey: "texin-key", senderId: "TEX" }), { mobile: "254712345678", to: "+254712345678", message: "Pay" });
  assert.equal(texin.url, "https://sms.texin.co.ke/api/send_sms");
  assert.deepEqual(keys(texin.body), ["api_key", "message", "recipient", "sender_id"]);
  assert.equal(texin.body?.partnerID, undefined);
  assert.equal(texin.headers.Authorization, undefined);

  const sasa = buildSmsRequest("mobilesasa", cfg({ token: "sasa-token", senderId: "IMANI" }), { mobile: "254712345678", to: "+254712345678", message: "Pay" });
  assert.equal(sasa.url, "https://api.mobilesasa.com/v1/send/message");
  assert.equal(sasa.headers.Authorization, "Bearer sasa-token");
  assert.deepEqual(keys(sasa.body), ["message", "phone", "senderID"]);
  assert.equal(smsGatewayFields("mobilesasa", cfg({})).some((field) => /webhook/i.test(field.label)), false);

  const celcom = buildSmsRequest("celcomafrica", cfg({ apiKey: "cel-key", partnerId: "partner", senderId: "IMANI" }), { mobile: "254700000000", to: "+254700000000", message: "Pay" });
  assert.equal(celcom.url, "https://isms.celcomafrica.com/api/services/sendsms/");
  assert.deepEqual(keys(celcom.body), ["apikey", "message", "mobile", "partnerID", "shortcode"]);
  assert.equal(celcom.body?.username, undefined);

  const afro = buildSmsRequest("afrokatt", cfg({ token: "afro-token", senderId: "IMANI", messageType: "unicode" }), { mobile: "254700000000", to: "+254700000000", message: "Pay" });
  assert.equal(afro.url, "https://portal.afrokatt.com/api/http/sms/send");
  assert.deepEqual(keys(afro.body), ["api_token", "message", "recipient", "sender_id", "type"]);
  assert.equal(afro.body?.type, "unicode");
  assert.equal(afro.body?.apikey, undefined);

  const textsms = buildSmsRequest("textsms", cfg({ apiKey: "text-key", partnerId: "p1", senderId: "SHORT" }), { mobile: "254700000000", to: "+254700000000", message: "Pay" });
  assert.equal(textsms.url, "https://sms.textsms.co.ke/api/services/sendsms/");
  assert.equal(textsms.body?.apikey, "text-key");
  assert.equal(textsms.body?.partnerID, "p1");
  assert.equal(textsms.body?.shortcode, "SHORT");

  const advanta = buildSmsRequest("advanta", cfg({ apiKey: "adv-key", partnerId: "adv-partner", senderId: "ADV" }), { mobile: "254700000000", to: "+254700000000", message: "Pay" });
  assert.equal(advanta.url, "https://api.advantasms.com/v1/send");
  assert.equal(advanta.headers["X-Api-Key"], "adv-key");
  assert.deepEqual(keys(advanta.body), ["message", "mobile", "partnerID", "shortcode"]);
  assert.equal(advanta.body?.apikey, undefined);
});

test("Bytewave has no invented fields and cannot be saved or probed as send", () => {
  assert.deepEqual(smsGatewayFields("bytewave", emptyGateway("bytewave")), []);
  assert.equal(gatewayConfigured("bytewave", cfg({ apiKey: "guess", token: "guess", userId: "guess" })), false);
  assert.throws(() => validateGateway("bytewave", emptyGateway("bytewave")), /API contract/);
  assert.equal(buildSmsProbe("texin", cfg({ apiKey: "texin-key" }))?.url, "https://sms.texin.co.ke/api/get_balance");
  for (const id of ["africastalking", "talksasa", "blessedtexts", "advanta", "twilio"] as const) {
    const config = cfg({ apiKey: "k", token: "t", userId: "u", partnerId: "p", senderId: "S", password: "pw" });
    assert.equal(buildSmsProbe(id, config), null);
  }
});

test("gateway saves keep sibling secrets, mask public views, and allow one configured default", () => {
  const texin = cfg({ apiKey: "texin-secret-value", senderId: "TEX" });
  const celcom = cfg({ apiKey: "celcom-secret-value", partnerId: "99", senderId: "CEL" });
  const store = mergeGatewayStore({ texin }, "celcomafrica", celcom);
  assert.equal(store.texin?.apiKey, "texin-secret-value");
  assert.equal(store.celcomafrica?.apiKey, "celcom-secret-value");
  const kept = mergeGatewayConfig(texin, cfg({ apiKey: "", senderId: "NEXT" }), "texin");
  assert.equal(kept.apiKey, "texin-secret-value");
  assert.equal(kept.senderId, "NEXT");
  const masked = mergeGatewayConfig(texin, cfg({ apiKey: "••••alue", senderId: "TEX" }), "texin");
  assert.equal(masked.apiKey, "texin-secret-value");
  assert.equal(gatewayConfigured("texin", cfg({ apiKey: "", senderId: "TEX" })), false);
  assert.throws(() => validateGateway("texin", emptyGateway("texin")), /required fields/);
  assert.throws(() => validateGateway("talksasa", cfg({ token: "talk-token", senderId: "TOO-LONG-IDX" })), /11/);
});

test("stored SMS gateways stay tenant scoped, sealed, and independent", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  const originalFetch = globalThis.fetch;
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_sms', 'Imani', 'imani'), ('ten_other', 'North', 'north')`;
    await asRole("ten_sms");
    const texin = await saveSmsGatewaySettings(sql, "ten_sms", {
      id: "texin",
      config: cfg({ apiKey: "texin-secret-value", senderId: "TEXIN" }),
      makeDefault: true,
      sms_sandbox: true,
      payment_sms: true,
      billing_sms: false,
    });
    assert.equal(texin.sms_provider, "texin");
    assert.equal(texin.sms_api_key, "texin-secret-value");
    assert.equal(texin.billing_sms, false);
    await saveSmsGatewaySettings(sql, "ten_sms", {
      id: "mobilesasa",
      config: cfg({ token: "sasa-secret-value", senderId: "IMANI" }),
      makeDefault: false,
    });
    const both = await getMessagingSettings(sql, "ten_sms");
    const store = parseGatewayStore(both.sms_gateways);
    assert.equal(both.sms_provider, "texin");
    assert.equal(store.texin?.apiKey, "texin-secret-value");
    assert.equal(store.mobilesasa?.token, "sasa-secret-value");
    assert.equal(both.sms_api_key, "texin-secret-value");

    await saveSmsGatewaySettings(sql, "ten_sms", {
      id: "texin",
      config: cfg({ apiKey: "", senderId: "NEWTEX" }),
      makeDefault: true,
    });
    const rotated = parseGatewayStore((await getMessagingSettings(sql, "ten_sms")).sms_gateways);
    assert.equal(rotated.texin?.apiKey, "texin-secret-value");
    assert.equal(rotated.texin?.senderId, "NEWTEX");
    assert.equal(rotated.mobilesasa?.token, "sasa-secret-value");

    const pub = toPublic(await getMessagingSettings(sql, "ten_sms"));
    assert.equal(pub.default_sms_gateway, "texin");
    assert.equal(JSON.stringify(pub).includes("texin-secret-value"), false);
    assert.equal(JSON.stringify(pub).includes("sasa-secret-value"), false);
    assert.equal(pub.sms_gateways.find((row) => row.id === "texin")?.configured, true);
    assert.equal(pub.sms_gateways.find((row) => row.id === "bytewave")?.configured, false);
    assert.equal(pub.sms_api_key_hint.includes("texin-secret-value"), false);

    const raw = await sql<{ sms_gateways: string; sms_api_key: string }>`select sms_gateways, sms_api_key from messaging_settings where tenant_id = 'ten_sms'`;
    assert.equal(raw[0]?.sms_gateways.includes("texin-secret-value"), false);
    assert.match(raw[0]?.sms_gateways || "", /^enc:v1:/);
    assert.equal(raw[0]?.sms_api_key.includes("texin-secret-value"), false);

    await saveMessagingSettings(sql, "ten_sms", { wa_phone_id: "phone-1", payment_whatsapp: false });
    const afterWa = await getMessagingSettings(sql, "ten_sms");
    assert.equal(afterWa.wa_phone_id, "phone-1");
    assert.equal(parseGatewayStore(afterWa.sms_gateways).texin?.apiKey, "texin-secret-value");
    assert.equal(afterWa.sms_provider, "texin");

    await assert.rejects(
      () => saveSmsGatewaySettings(sql, "ten_sms", { id: "bytewave", config: emptyGateway("bytewave"), makeDefault: true }),
      /API contract/,
    );
    await assert.rejects(
      () => saveSmsGatewaySettings(sql, "ten_sms", { id: "afrokatt", config: emptyGateway("afrokatt"), makeDefault: true }),
      /required fields|configured/,
    );

    let calls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ balance: 10 }), { status: 200 });
    }) as typeof fetch;
    const sandbox = await deliverSms(afterWa, "0712345678", "hello");
    assert.equal(sandbox.status, "sandbox");
    assert.notEqual(sandbox.status, "sent");
    assert.equal(calls.length, 0);

    const live = await saveSmsGatewaySettings(sql, "ten_sms", {
      id: "texin",
      config: cfg({ apiKey: "texin-secret-value", senderId: "NEWTEX" }),
      makeDefault: true,
      sms_sandbox: false,
    });
    calls = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      assert.equal(String(init?.body || "").includes("texin-secret-value"), true);
      return new Response(JSON.stringify({ message_id: "m-1" }), { status: 200 });
    }) as typeof fetch;
    const sent = await deliverSms(live, "0712345678", "Pay now");
    assert.equal(sent.status, "sent");
    assert.equal(calls[0], "https://sms.texin.co.ke/api/send_sms");
    assert.equal(sent.detail.includes("texin-secret-value"), false);
    assert.match(sent.detail, /m-1/);

    calls = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ balance: 4 }), { status: 200 });
    }) as typeof fetch;
    const probe = await probeSmsGateway(live, "texin");
    assert.equal(probe.ok, true);
    assert.equal(probe.detail.includes("texin-secret-value"), false);
    assert.equal(calls[0], "https://sms.texin.co.ke/api/get_balance");
    assert.equal(calls.some((url) => url.includes("send")), false);

    calls = [];
    const withAdvanta = await saveSmsGatewaySettings(sql, "ten_sms", {
      id: "advanta",
      config: cfg({ apiKey: "adv-secret-value", partnerId: "adv-partner", senderId: "ADV" }),
      makeDefault: false,
      sms_sandbox: false,
    });
    const noProbe = await probeSmsGateway(withAdvanta, "advanta");
    assert.equal(noProbe.ok, false);
    assert.match(noProbe.detail, /Send Test SMS/);
    assert.equal(calls.length, 0);
    assert.equal(withAdvanta.sms_provider, "texin");

    await asRole("ten_other");
    const other = await getMessagingSettings(sql, "ten_other");
    assert.equal(other.sms_api_key, "");
    assert.equal(parseGatewayStore(other.sms_gateways).texin, undefined);
    const leak = await sql<{ n: number }>`select count(*)::int as n from messaging_settings where sms_provider = 'texin'`;
    assert.equal(leak[0]?.n, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await close();
  }
});

test("communications SMS screen lists the seven gateways without a shared credential form", () => {
  const ui = readFileSync(new URL("../../components/isp/communications-settings.tsx", import.meta.url), "utf8");
  assert.deepEqual(
    NEW_SMS_GATEWAYS.map((gateway) => gateway.label),
    ["HostPinnacle", "Texin", "Mobile Sasa", "Bytewave", "Celcom Africa", "Afrokatt", "TextSMS"],
  );
  assert.match(ui, /NEW_SMS_GATEWAYS\.map/);
  assert.match(ui, /EXISTING_SMS_GATEWAYS\.map/);
  assert.match(ui, /data-gateway=/);
  assert.match(ui, /lg:grid-cols-\[16rem_minmax\(0,1fr\)\]/);
  assert.match(ui, /Test connection/);
  assert.match(ui, /Send Test SMS/);
  assert.match(ui, /Unsaved changes/);
  assert.match(ui, /Discard/);
  assert.match(ui, /SecretInput/);
  assert.match(ui, /lock\.current/);
  assert.match(ui, /testLock\.current/);
  assert.match(ui, /SMS_GATEWAY_SAVE_OK/);
  assert.match(ui, /SMS_SEND_OK/);
  assert.equal(SMS_GATEWAY_SAVE_OK, "SMS gateway settings saved successfully.");
  assert.equal(SMS_SEND_OK, "Test SMS sent successfully.");
  assert.doesNotMatch(ui, /Test SMS sent successfully/);
  assert.match(ui, /r\.status === "sent"/);
  const fields = smsGatewayFields("bytewave", emptyGateway("bytewave"));
  assert.equal(fields.length, 0);
  assert.equal(NEW_SMS_GATEWAYS.map((gateway) => gateway.id).join(), "hostpinnacle,texin,mobilesasa,bytewave,celcomafrica,afrokatt,textsms");
  const sample: SmsGatewayId = "celcomafrica";
  assert.equal(smsGatewayFields(sample, emptyGateway(sample)).some((field) => field.key === "userId"), false);
});
