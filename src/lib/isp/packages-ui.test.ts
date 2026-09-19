import assert from "node:assert/strict";
import { test } from "node:test";
import type { PackageRow } from "./types.ts";
import {
  blankPackageForm,
  CREATE_PACKAGE_DEFAULTS,
  DEFAULT_DURATION_DAYS,
  DEFAULT_GRACE_DAYS,
  DEFAULT_VALIDITY_HOURS,
  durationLabel,
  filterPackages,
  formFromPackage,
  hoursFromInput,
  paginatePackages,
  persistableDuration,
  shownValidity,
  sortPackages,
  validatePackageForm,
  validityUnitOf,
} from "./packages-ui.ts";

function pkg(partial: Partial<PackageRow> & Pick<PackageRow, "id" | "name">): PackageRow {
  return {
    description: "",
    access_method: "pppoe",
    download_mbps: 10,
    upload_mbps: 5,
    price_kes: 2500,
    billing_interval: "monthly",
    grace_days: 5,
    bundle_mb: 0,
    validity_hours: 0,
    duration_value: 0,
    duration_unit: "hours",
    active: true,
    ...partial,
  };
}

test("create defaults are 30-day duration and 0-day grace", () => {
  assert.equal(DEFAULT_DURATION_DAYS, 30);
  assert.equal(DEFAULT_GRACE_DAYS, 0);
  assert.equal(DEFAULT_VALIDITY_HOURS, 720);
  assert.equal(CREATE_PACKAGE_DEFAULTS.validity_hours, 720);
  assert.equal(CREATE_PACKAGE_DEFAULTS.grace_days, 0);
  assert.equal(validityUnitOf(CREATE_PACKAGE_DEFAULTS.validity_hours), "days");
  assert.equal(shownValidity(CREATE_PACKAGE_DEFAULTS.validity_hours, "days"), 30);
  const form = blankPackageForm("hotspot");
  assert.equal(form.access_method, "hotspot");
  assert.equal(form.duration_value, 1);
  assert.equal(form.duration_unit, "hours");
  assert.equal(form.validity_hours, 1);
  assert.equal(form.grace_days, 0);
  assert.equal(form.tier, "residential");
  assert.equal(form.business_credit_enabled, false);
  assert.equal(hoursFromInput(30, "days"), 720);
});

test("editing copies saved duration and grace instead of create defaults", () => {
  const saved = pkg({ id: "pkg_1", name: "Home 10", grace_days: 5, validity_hours: 0, price_kes: 1800 });
  const form = formFromPackage(saved);
  assert.equal(form.grace_days, 5);
  assert.equal(form.validity_hours, 0);
  assert.equal(form.price_kes, 1800);
  assert.notEqual(form.grace_days, CREATE_PACKAGE_DEFAULTS.grace_days);
  assert.notEqual(form.validity_hours, CREATE_PACKAGE_DEFAULTS.validity_hours);
});

test("search, access, and status filters keep card and list views in sync", () => {
  const rows = [
    pkg({ id: "a", name: "Home 10", access_method: "pppoe", active: true, description: "fibre" }),
    pkg({ id: "b", name: "Cafe", access_method: "hotspot", active: false, description: "voucher" }),
    pkg({ id: "c", name: "Office", access_method: "static", active: true, description: "" }),
  ];
  assert.equal(filterPackages(rows, { q: "home", access: "all", status: "all" }).map((p) => p.id).join(), "a");
  assert.equal(filterPackages(rows, { q: "voucher", access: "all", status: "all" }).map((p) => p.id).join(), "b");
  assert.equal(filterPackages(rows, { q: "", access: "hotspot", status: "all" }).map((p) => p.id).join(), "b");
  assert.equal(filterPackages(rows, { q: "", access: "all", status: "inactive" }).map((p) => p.id).join(), "b");
  assert.equal(filterPackages(rows, { q: "office", access: "pppoe", status: "all" }).length, 0);
});

test("sort and pagination clamp to the filtered catalog", () => {
  const rows = [
    pkg({ id: "a", name: "Zulu", price_kes: 100, validity_hours: 24, download_mbps: 5 }),
    pkg({ id: "b", name: "Alpha", price_kes: 300, validity_hours: 720, download_mbps: 20 }),
    pkg({ id: "c", name: "Mike", price_kes: 200, validity_hours: 48, download_mbps: 10 }),
  ];
  assert.deepEqual(sortPackages(rows, "name").map((p) => p.id), ["b", "c", "a"]);
  assert.deepEqual(sortPackages(rows, "price").map((p) => p.id), ["a", "c", "b"]);
  assert.deepEqual(sortPackages(rows, "duration").map((p) => p.id), ["a", "c", "b"]);
  const page1 = paginatePackages(rows, 1, 2);
  assert.equal(page1.pages, 2);
  assert.equal(page1.from, 1);
  assert.equal(page1.to, 2);
  assert.equal(page1.rows.length, 2);
  const clamped = paginatePackages(rows, 99, 2);
  assert.equal(clamped.page, 2);
  const empty = paginatePackages([], 3, 25);
  assert.equal(empty.page, 1);
  assert.equal(empty.from, 0);
  assert.equal(durationLabel(720, "monthly"), "30 days");
  assert.equal(durationLabel(0, "monthly"), "Monthly");
});

test("inline validation matches existing required fields", () => {
  const errors = validatePackageForm({ ...CREATE_PACKAGE_DEFAULTS, name: "  ", download_mbps: 0, upload_mbps: 0, price_kes: -1, grace_days: -2 });
  assert.equal(errors.name, "Name is required");
  assert.ok(errors.download_mbps);
  assert.ok(errors.upload_mbps);
  assert.ok(errors.price_kes);
  assert.ok(errors.grace_days);
  assert.deepEqual(validatePackageForm({ ...CREATE_PACKAGE_DEFAULTS, name: "Home 10" }), {});
});

test("hotspot form rejects missing duration and keeps business credit off", () => {
  const form = blankPackageForm("hotspot");
  assert.deepEqual(validatePackageForm({ ...form, name: "Hour" }), {});
  assert.equal(validatePackageForm({ ...form, name: "Hour", duration_value: 0 }).duration_value, "Duration is required");
  assert.equal(form.tier, "residential");
  assert.equal(form.business_credit_enabled, false);
  assert.equal(
    durationLabel(1, "daily", { access_method: "hotspot", duration_value: 30, duration_unit: "minutes", validity_hours: 1 }),
    "30 Minutes",
  );
  const saved = persistableDuration({
    ...form,
    name: "Hour",
    duration_value: 30,
    duration_unit: "minutes",
    tier: "business",
    business_credit_enabled: true,
    max_credit_kes: 5000,
  });
  assert.equal(saved.duration_value, 30);
  assert.equal(saved.duration_unit, "minutes");
  assert.equal(saved.validity_hours, 1);
  assert.equal(saved.grace_days, 0);
  assert.equal(saved.tier, "residential");
  assert.equal(saved.business_credit_enabled, false);
});
