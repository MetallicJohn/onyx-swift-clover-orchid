import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DATE_FORMAT,
  dateFormatExample,
  formatDate,
  formatDateTime,
  formatShortDateTime,
  formatSmsDate,
  normalizeDateFormat,
  setActiveDateFormat,
} from "./display.ts";

test("default date format is dd/mm/yy", () => {
  assert.equal(DEFAULT_DATE_FORMAT, "dd/mm/yy");
  assert.equal(normalizeDateFormat(""), "dd/mm/yy");
  assert.equal(normalizeDateFormat("nope"), "dd/mm/yy");
  assert.equal(normalizeDateFormat("dd/mm/yyyy"), "dd/mm/yyyy");
  assert.equal(dateFormatExample("dd/mm/yy"), "16/09/26");
  assert.equal(dateFormatExample("dd/mm/yyyy"), "16/09/2026");
  assert.equal(dateFormatExample("dd-mm-yyyy"), "16-09-2026");
  assert.equal(dateFormatExample("yyyy-mm-dd"), "2026-09-16");
  assert.equal(dateFormatExample("d MMM yyyy"), "16 Sep 2026");
});

test("calendar dates and Nairobi timestamps share one day", () => {
  setActiveDateFormat("dd/mm/yy");
  try {
    assert.equal(formatDate("2026-09-16"), "16/09/26");
    assert.equal(formatSmsDate("2026-09-16"), "16/09/26");
    assert.equal(formatDate("2026-09-16T21:30:00+03:00"), "16/09/26");
    // 21:30 UTC is already 17 Sep in Nairobi — SMS must match the console.
    assert.equal(formatDate("2026-09-16T21:30:00Z"), "17/09/26");
    assert.equal(formatSmsDate("2026-09-16T21:30:00Z"), "17/09/26");
    assert.equal(formatDate("2026-09-16T20:59:59Z"), "16/09/26");
    assert.equal(formatDate(null), "—");
    assert.equal(formatSmsDate(null), "");
  } finally {
    setActiveDateFormat(DEFAULT_DATE_FORMAT);
  }
});

test("date-time uses the same date format", () => {
  setActiveDateFormat("dd/mm/yy");
  try {
    assert.equal(formatDateTime("2026-09-16T14:32:05+03:00"), "16/09/26 14:32:05");
    assert.equal(formatShortDateTime("2026-09-16T14:32:05+03:00"), "16/09/26 14:32");
    assert.equal(formatDate("2026-09-16", "d MMM yyyy"), "16 Sep 2026");
    assert.equal(formatSmsDate("2026-09-16T21:30:00Z", "dd/mm/yyyy"), "17/09/2026");
  } finally {
    setActiveDateFormat(DEFAULT_DATE_FORMAT);
  }
});
