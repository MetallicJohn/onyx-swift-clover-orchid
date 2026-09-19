import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addHotspotDuration,
  durationFromValidityHours,
  formatHotspotDuration,
  hotspotDurationMs,
  hotspotPackageDuration,
  normalizeDuration,
  validityHoursFromDuration,
} from "./hotspot-duration.ts";

test("duration units preserve minutes through months", () => {
  assert.deepEqual(normalizeDuration(30, "minutes"), { value: 30, unit: "minutes" });
  assert.deepEqual(normalizeDuration(2, "hours"), { value: 2, unit: "hours" });
  assert.deepEqual(normalizeDuration(1, "days"), { value: 1, unit: "days" });
  assert.deepEqual(normalizeDuration(7, "weeks"), { value: 7, unit: "weeks" });
  assert.deepEqual(normalizeDuration(1, "months"), { value: 1, unit: "months" });
  assert.equal(formatHotspotDuration(30, "minutes"), "30 Minutes");
  assert.equal(formatHotspotDuration(1, "hours"), "1 Hour");
  assert.equal(formatHotspotDuration(1, "days"), "1 Day");
  assert.equal(formatHotspotDuration(1, "months"), "1 Month");
});

test("30 minutes expires 30 minutes after activation, not a rounded hour", () => {
  const start = new Date("2026-09-19T11:30:00.000Z");
  const end = addHotspotDuration(start, 30, "minutes");
  assert.equal(end.toISOString(), "2026-09-19T12:00:00.000Z");
  assert.equal(hotspotDurationMs(30, "minutes"), 30 * 60_000);
  assert.equal(validityHoursFromDuration(30, "minutes"), 1);
});

test("1 month uses calendar UTC with last-day clamp", () => {
  const jan31 = new Date("2026-01-31T11:30:00.000Z");
  const feb = addHotspotDuration(jan31, 1, "months");
  assert.equal(feb.toISOString(), "2026-02-28T11:30:00.000Z");
  const mar = addHotspotDuration(jan31, 2, "months");
  assert.equal(mar.toISOString(), "2026-03-31T11:30:00.000Z");
  const fromNow = addHotspotDuration(new Date("2026-09-19T11:30:00.000Z"), 1, "months");
  assert.equal(fromNow.toISOString(), "2026-10-19T11:30:00.000Z");
});

test("hours, days and weeks are exact wall offsets from activation", () => {
  const start = new Date("2026-09-19T11:30:00.000Z");
  assert.equal(addHotspotDuration(start, 2, "hours").toISOString(), "2026-09-19T13:30:00.000Z");
  assert.equal(addHotspotDuration(start, 1, "days").toISOString(), "2026-09-20T11:30:00.000Z");
  assert.equal(addHotspotDuration(start, 7, "days").toISOString(), "2026-09-26T11:30:00.000Z");
  assert.equal(addHotspotDuration(start, 2, "weeks").toISOString(), "2026-10-03T11:30:00.000Z");
});

test("legacy validity_hours maps to a display unit without becoming a billing month", () => {
  assert.deepEqual(durationFromValidityHours(24), { value: 1, unit: "days" });
  assert.deepEqual(durationFromValidityHours(1), { value: 1, unit: "hours" });
  assert.deepEqual(hotspotPackageDuration({ duration_value: 30, duration_unit: "minutes", validity_hours: 1 }), {
    value: 30,
    unit: "minutes",
  });
});
