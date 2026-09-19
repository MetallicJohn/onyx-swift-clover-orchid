import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ACS_FACTORY_RESET_PHRASE,
  acsSearchReady,
  canSubmitAcsAssignment,
  canSubmitManualDevice,
  deviceIdentity,
  factoryResetReady,
  inferDeviceType,
  maskSecret,
  onlineLabel,
  opticalMissingMessage,
  taskPhaseLabel,
  unsupportedActionMessage,
  wifiPasswordValid,
  wifiReviewRows,
} from "./acs-device-format.ts";
import { profileSupports, resolveAcsProfile } from "./acs-device-profiles.ts";

test("reassign-style search and assignment confirmation", () => {
  assert.equal(acsSearchReady(""), false);
  assert.equal(acsSearchReady("J"), false);
  assert.equal(acsSearchReady("Jo"), true);
  assert.equal(canSubmitManualDevice({ serial: "" }), false);
  assert.equal(canSubmitManualDevice({ serial: "SN1" }), true);
  assert.equal(
    canSubmitAcsAssignment({ deviceId: "d1", serviceId: "s1", customerId: "c1", confirmed: false }),
    false,
  );
  assert.equal(
    canSubmitAcsAssignment({ deviceId: "d1", serviceId: "s1", customerId: "c1", confirmed: true }),
    true,
  );
  assert.equal(
    canSubmitAcsAssignment({
      deviceId: "d1",
      serviceId: "s1",
      customerId: "c1",
      confirmed: true,
      needsMoveConfirm: true,
      moveConfirmed: false,
    }),
    false,
  );
});

test("device type, online label, and factory reset phrase", () => {
  assert.equal(inferDeviceType("F670L", "ZTE"), "router");
  assert.equal(inferDeviceType("ONU-1", "Huawei"), "onu");
  assert.equal(onlineLabel("unknown", null), "Not confirmed");
  assert.equal(onlineLabel("online", "2026-09-17"), "Online");
  assert.equal(factoryResetReady("reset", true), true);
  assert.equal(factoryResetReady("wipe", true), false);
  assert.equal(ACS_FACTORY_RESET_PHRASE, "RESET");
  assert.equal(deviceIdentity({ manufacturer: "ZTE", model: "F670L", serial: "SN1" }), "ZTE F670L · SN1");
});

test("wifi passwords are masked and validated; secrets stay out of review", () => {
  assert.equal(wifiPasswordValid("short", "wpa2"), false);
  assert.equal(wifiPasswordValid("longpass1", "wpa2"), true);
  assert.equal(wifiPasswordValid("", "none"), true);
  const review = wifiReviewRows({ ssid: "Home", password: "supersecret", security: "WPA2" });
  assert.equal(review.find((r) => r.label === "Password")?.value, "••••••••");
  assert.equal(JSON.stringify(review).includes("supersecret"), false);
  assert.equal(maskSecret("hiddenpass").includes("h"), false);
});

test("vendor profiles do not claim firmware or optical when the tree has no paths", () => {
  const zte = resolveAcsProfile("ZTE", "F670L");
  assert.equal(zte.tree, "InternetGatewayDevice");
  assert.equal(profileSupports(zte, "wifi"), true);
  assert.equal(profileSupports(zte, "optical"), true);
  assert.equal(profileSupports(zte, "firmware_upgrade"), false);
  const tr181 = resolveAcsProfile("", "Device");
  assert.equal(tr181.id === "tr181" || tr181.tree === "Device" || tr181.id === "igd-generic", true);
  assert.equal(taskPhaseLabel("waiting_for_inform"), "Waiting for Inform");
  assert.match(unsupportedActionMessage(), /not supported/i);
  assert.match(opticalMissingMessage(), /not exposed/i);
});

test("GenieACS page loads with Add Device and a searchable desk", () => {
  const page = readFileSync(new URL("../../routes/app/acs.tsx", import.meta.url), "utf8");
  const desk = readFileSync(new URL("../../components/isp/acs-device-desk.tsx", import.meta.url), "utf8");
  const add = readFileSync(new URL("../../components/isp/acs-add-device-dialog.tsx", import.meta.url), "utf8");
  const assign = readFileSync(new URL("../../components/isp/acs-assign-dialog.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../../components/app-shell.tsx", import.meta.url), "utf8");
  assert.match(page, /AcsDeviceDesk/);
  assert.match(page, /"NBI" : "Devices"/);
  assert.doesNotMatch(page, /GenieACS Devices/);
  assert.match(shell, /to: "\/app\/acs", label: "Devices"/);
  assert.doesNotMatch(shell, /to: "\/app\/acs", label: "GenieACS"/);
  assert.doesNotMatch(shell, /"\/app\/acs": "genieacs"/);
  assert.match(desk, /Add Device/);
  assert.match(desk, /Search devices/);
  assert.match(desk, /w-full sm:w-auto|flex-col/);
  assert.match(add, /From GenieACS/);
  assert.match(add, /Enter manually/);
  assert.match(add, /Wait for Inform/);
  assert.match(add, /not marked online|not confirmed/i);
  assert.match(assign, /Search customer or service/);
  assert.match(assign, /Confirm assignment/);
  assert.match(assign, /type="radio"/);
  assert.match(assign, /\bBack\b/);
  assert.match(desk, /Customer/);
  assert.match(desk, /Router or location/);
  assert.doesNotMatch(desk, /Register CPE/);
});
