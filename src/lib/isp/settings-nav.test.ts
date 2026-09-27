import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  gatewayStatus,
  kopoConfigComplete,
  mpesaConfigComplete,
  PAYMENT_SAVE_FAIL,
  PAYMENT_SAVE_OK,
  PAYMENT_TEST_FAIL,
  PAYMENT_TEST_OK,
  safeSettingsError,
  SETTINGS_GATEWAYS,
} from "./settings-feedback.ts";
import { parseSettingsSearch, SETTINGS_PAGES } from "./settings-nav.ts";

const emptyMpesa = {
  clientId: "",
  clientSecret: "",
  till: "",
  passkey: "",
  secretStored: false,
  passkeyStored: false,
};

test("settings pages group existing areas and keep legacy links", () => {
  assert.deepEqual(
    SETTINGS_PAGES.map((page) => page.label),
    ["General", "Communications", "Notifications", "Payments", "Network", "Staff", "Customers", "Plan"],
  );
  assert.equal(parseSettingsSearch({}).tab, "general");
  assert.equal(parseSettingsSearch({ tab: "company" }).section, "company");
  assert.equal(parseSettingsSearch({ tab: "appearance" }).section, "appearance");
  assert.equal(parseSettingsSearch({ tab: "sms" }).tab, "communications");
  assert.equal(parseSettingsSearch({ tab: "payment" }).section, "gateways");
  assert.equal(parseSettingsSearch({ tab: "grace" }).section, "grace");
  assert.equal(parseSettingsSearch({ tab: "partial" }).section, "partial");
  assert.equal(parseSettingsSearch({ tab: "tags" }).section, "tags");
  assert.equal(parseSettingsSearch({ tab: "accounts" }).section, "ids");
  assert.equal(parseSettingsSearch({ tab: "payments", section: "partial" }).section, "partial");
  assert.equal(parseSettingsSearch({ tab: "nope" }).tab, "general");
  assert.equal(parseSettingsSearch({ tab: "notifications", section: "grace" }).section, undefined);
});

test("gateway status follows a real test, not saved credentials", () => {
  assert.equal(gatewayStatus({ tested: null, complete: false }).label, "Configuration incomplete");
  assert.equal(gatewayStatus({ tested: null, complete: true }).label, "Not tested");
  assert.equal(gatewayStatus({ tested: "ok", complete: true }).label, "Connected");
  assert.equal(gatewayStatus({ tested: "fail", complete: true }).label, "Connection failed");
  assert.equal(mpesaConfigComplete(emptyMpesa), false);
  assert.equal(
    mpesaConfigComplete({ ...emptyMpesa, clientId: "key", till: "123", secretStored: true, passkeyStored: true }),
    true,
  );
  assert.equal(kopoConfigComplete({ clientId: "id", clientSecret: "", till: "1", secretStored: false }), false);
  assert.deepEqual(
    SETTINGS_GATEWAYS.map((g) => g.label),
    ["M-Pesa", "Kopo Kopo", "Callbacks"],
  );
});

test("settings errors do not echo secrets", () => {
  assert.equal(safeSettingsError(new Error("Till is invalid"), PAYMENT_SAVE_FAIL), "Till is invalid");
  assert.equal(safeSettingsError(new Error("bad secret sk_live_12345"), PAYMENT_TEST_FAIL, ["sk_live_12345"]), PAYMENT_TEST_FAIL);
  assert.equal(safeSettingsError("nope", PAYMENT_SAVE_FAIL), PAYMENT_SAVE_FAIL);
  assert.equal(PAYMENT_SAVE_OK, "Payment settings saved successfully.");
  assert.equal(PAYMENT_TEST_OK, "Payment gateway connection successful.");
});

test("payment and settings screens keep labels, secrets, and save confirmation", () => {
  const payment = readFileSync(new URL("../../components/isp/payment-settings.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../../routes/app/settings.tsx", import.meta.url), "utf8");
  const comms = readFileSync(new URL("../../components/isp/communications-settings.tsx", import.meta.url), "utf8");
  for (const label of [
    "Available gateways",
    "M-Pesa",
    "Kopo Kopo",
    "Consumer key",
    "Consumer secret",
    "Business short code",
    "Lipa Na M-Pesa passkey",
    "Test connection",
    "Client ID",
    "Client secret",
    "Till number",
    "Public site URL",
  ]) {
    assert.match(payment, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(payment, /type=\{show \? "text" : "password"\}|SecretInput/);
  assert.match(payment, /PAYMENT_SAVE_OK/);
  assert.match(payment, /PAYMENT_TEST_OK/);
  assert.match(payment, /PAYMENT_TEST_BUSY/);
  assert.match(payment, /saveLock\.current/);
  assert.match(payment, /testLock\.current/);
  assert.match(payment, /aria-busy=\{testing\}/);
  assert.match(payment, /data-gateway=/);
  assert.doesNotMatch(payment, /Airtel Money|Stripe/);
  assert.match(settings, /SETTINGS_PAGES/);
  assert.match(settings, /Gateways/);
  assert.match(settings, /Grace period/);
  assert.match(settings, /Partial payments/);
  assert.match(settings, /ID Settings/);
  assert.match(settings, /CompanyInfoSettings/);
  assert.match(settings, /PaymentSettings/);
  assert.match(settings, /CommunicationsSettings/);
  assert.match(settings, /GRACE_SAVE_OK/);
  assert.match(settings, /PARTIAL_SAVE_OK/);
  assert.match(settings, /Staff maximum days/);
  assert.match(comms, /SMS settings saved successfully|SMS_SAVE_OK/);
  assert.match(comms, /SecretInput/);
  assert.match(comms, /mergeKeptEdits/);
  assert.match(comms, /lock\.current/);
});
