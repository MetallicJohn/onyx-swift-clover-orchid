import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMPANY_INFO_TABS,
  COMPANY_SAVE_FAIL,
  COMPANY_SAVE_OK,
  basicInfoComplete,
  companyBrandDirty,
  companyProfileDirty,
  companySaveError,
  companyTabDirty,
  mergeKeptEdits,
  type CompanyBrandFields,
  type CompanyProfileFields,
} from "./company-info-tabs.ts";

const profile: CompanyProfileFields = {
  name: "Nice Apt",
  supportEmail: "ops@example.com",
  supportPhone: "0700000000",
  dateFormat: "dd/mm/yy",
};

const brand: CompanyBrandFields = {
  address: "Nairobi",
  website: "https://example.com",
  tax_pin: "P000",
  invoice_footer: "Thanks",
  invoice_notes: "Pay by due date",
  brand_color: "#4aa8a0",
  bank_name: "KCB",
  bank_account: "123",
  bank_branch: "Westlands",
};

test("company info tabs use the setup order", () => {
  assert.deepEqual(
    COMPANY_INFO_TABS.map((tab) => tab.label),
    ["Basic information", "Contact information", "Branding", "Business / legal", "eTIMS", "Additional information"],
  );
  assert.equal(COMPANY_SAVE_OK, "Company information saved successfully.");
});

test("only a saved ISP name counts as complete", () => {
  assert.equal(basicInfoComplete("  Nice Apt  "), true);
  assert.equal(basicInfoComplete("   "), false);
});

test("tab dirty state follows the fields on that tab", () => {
  assert.equal(companyTabDirty("basic", profile, profile, brand, brand, false), false);
  assert.equal(companyTabDirty("basic", { ...profile, name: "Other" }, profile, brand, brand, false), true);
  assert.equal(companyTabDirty("contact", { ...profile, supportEmail: "a@b.c" }, profile, brand, brand, false), true);
  assert.equal(companyTabDirty("contact", profile, profile, { ...brand, website: "https://x.test" }, brand, false), true);
  assert.equal(companyTabDirty("contact", { ...profile, name: "Other" }, profile, brand, brand, false), false);
  assert.equal(companyTabDirty("legal", profile, profile, { ...brand, tax_pin: "P9" }, brand, false), true);
  assert.equal(companyTabDirty("legal", profile, profile, brand, brand, false), false);
  assert.equal(companyTabDirty("additional", { ...profile, dateFormat: "yyyy-mm-dd" }, profile, brand, brand, false), true);
  assert.equal(companyTabDirty("additional", profile, profile, brand, brand, true), true);
  assert.equal(companyTabDirty("branding", { ...profile, name: "Other" }, profile, { ...brand, tax_pin: "P9" }, brand, true), false);
  assert.equal(companyTabDirty("etims", profile, profile, brand, brand, false), false);
});

test("unsaved profile and brand are detectable without wiping siblings", () => {
  assert.equal(companyProfileDirty(profile, profile), false);
  assert.equal(companyProfileDirty({ ...profile, supportPhone: "0711" }, profile), true);
  assert.equal(companyBrandDirty(brand, brand), false);
  assert.equal(companyBrandDirty({ ...brand, bank_branch: "Kilimani" }, brand), true);
});

test("save errors prefer the API message", () => {
  assert.equal(companySaveError(new Error("Name is required")), "Name is required");
  assert.equal(companySaveError(new Error("   ")), COMPANY_SAVE_FAIL);
  assert.equal(companySaveError("nope"), COMPANY_SAVE_FAIL);
  assert.equal(COMPANY_SAVE_FAIL, "Unable to save company information. Please try again.");
});

test("edits typed during a save are kept", () => {
  const submitted = profile;
  const current = { ...profile, supportEmail: "newer@example.com" };
  const server = { ...profile, name: "Nice Apt Ltd" };
  const merged = mergeKeptEdits(current, submitted, server);
  assert.equal(merged.name, "Nice Apt Ltd");
  assert.equal(merged.supportEmail, "newer@example.com");
  assert.equal(merged.supportPhone, profile.supportPhone);
});

test("company info UI keeps fields, save feedback, and unsaved edits", () => {
  const ui = readFileSync(new URL("../../components/isp/company-info-settings.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../../routes/app/settings.tsx", import.meta.url), "utf8");
  for (const label of [
    "ISP name",
    "Support email",
    "Support phone",
    "Date format",
    "Address",
    "Website",
    "Tax / PIN",
    "Bank name",
    "Account number",
    "Bank branch",
    "Invoice notes",
    "Footer",
    "Your password",
    "Basic information",
    "Contact information",
    "Branding",
    "Business / legal",
    "Additional information",
  ]) {
    assert.match(ui, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(ui, /Saving…/);
  assert.match(ui, /disabled=\{busy\}/);
  assert.match(ui, /aria-busy=\{busy\}/);
  assert.match(ui, /profileLock\.current/);
  assert.match(ui, /brandLock\.current/);
  assert.match(ui, /pwLock\.current/);
  assert.match(ui, /Unsaved changes/);
  assert.match(ui, /overflow-x-auto/);
  assert.match(ui, /scrollIntoView/);
  assert.match(ui, /COMPANY_SAVE_OK/);
  assert.match(ui, /AppearanceSettings/);
  assert.match(ui, /renameTenant\(\{ data: submitted/);
  assert.match(ui, /saveDocumentBranding\(\{ data: submitted/);
  assert.doesNotMatch(ui, /setProfileNote\(\{ ok: true/);
  assert.match(settings, /CompanyInfoSettings/);
  assert.match(settings, /companyProfileDirty/);
  assert.match(settings, /mergeKeptEdits/);
  assert.doesNotMatch(settings, /Save company/);
  assert.doesNotMatch(settings, /Invoice branding saved/);
});
