import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DATE_FORMAT,
  dateFormatExample,
  dateInputPlaceholder,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatShortDateTime,
  formatSmsDate,
  formatYmdInput,
  normalizeDateFormat,
  parseYmdInput,
  setActiveDateFormat,
  tryParseYmdInput,
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
  assert.equal(dateInputPlaceholder(), "dd/mm/yy");
  assert.equal(dateInputPlaceholder("dd/mm/yyyy"), "dd/mm/yyyy");
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

test("relative time uses seconds and minutes without inventing a clock", () => {
  const now = Date.parse("2026-09-17T12:00:00.000Z");
  assert.equal(formatRelativeTime("2026-09-17T11:59:45.000Z", now), "15 seconds ago");
  assert.equal(formatRelativeTime("2026-09-17T12:00:00.000Z", now), "just now");
  assert.equal(formatRelativeTime("2026-09-17T11:58:00.000Z", now), "2 minutes ago");
  assert.equal(formatRelativeTime(null, now), "");
  assert.equal(formatRelativeTime("not-a-date", now), "");
});

test("operators enter dd/mm/yy and the console stores YYYY-MM-DD", () => {
  setActiveDateFormat("dd/mm/yy");
  try {
    assert.equal(parseYmdInput("16/09/26"), "2026-09-16");
    assert.equal(parseYmdInput("16/09/2026"), "2026-09-16");
    assert.equal(parseYmdInput("16-09-2026"), "2026-09-16");
    assert.equal(parseYmdInput("16.09.26"), "2026-09-16");
    assert.equal(parseYmdInput("160926"), "2026-09-16");
    assert.equal(parseYmdInput("16092026"), "2026-09-16");
    assert.equal(parseYmdInput("16 Sep 2026"), "2026-09-16");
    assert.equal(parseYmdInput("2026-09-16"), "2026-09-16");
    assert.equal(parseYmdInput(""), "");
    assert.equal(formatYmdInput("2026-09-16"), "16/09/26");
    assert.equal(formatYmdInput(""), "");
    assert.equal(tryParseYmdInput("not-a-date"), null);
    assert.equal(tryParseYmdInput(""), "");
    assert.throws(() => parseYmdInput("32/13/26"));
    assert.throws(() => parseYmdInput("31/02/26"));
    assert.throws(() => parseYmdInput("2026-02-31"));
  } finally {
    setActiveDateFormat(DEFAULT_DATE_FORMAT);
  }
});

test("customer and service date fields use DateYmdInput, not native ISO pickers", () => {
  const wizard = readFileSync(new URL("../../components/isp/onboard-wizard.tsx", import.meta.url), "utf8");
  const expiry = readFileSync(new URL("../../components/isp/service-expiry-editor.tsx", import.meta.url), "utf8");
  const field = readFileSync(new URL("../../components/isp/date-ymd-input.tsx", import.meta.url), "utf8");
  assert.match(wizard, /DateYmdInput/);
  assert.match(wizard, /subscription_start_ymd/);
  assert.match(wizard, /expiry_ymd/);
  assert.doesNotMatch(wizard, /type=["']date["']/);
  assert.match(expiry, /DateYmdInput/);
  assert.doesNotMatch(expiry, /type=["']date["']/);
  assert.match(field, /type="text"/);
  assert.match(field, /dateInputPlaceholder/);
  assert.match(field, /placeholder=\{placeholder\}/);
  assert.match(field, /tryParseYmdInput/);
});

test("no page exposes a visible native ISO date picker", () => {
  const srcRoot = fileURLToPath(new URL("../..", import.meta.url));
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(tsx|ts|jsx|js)$/.test(name)) continue;
      const text = readFileSync(p, "utf8");
      if (/type=["']date["']/.test(text)) hits.push(p);
    }
  };
  walk(srcRoot);
  assert.equal(hits.length, 1, `native type=date left in ${hits.join(", ")}`);
  assert.match(hits[0] || "", /date-ymd-input\.tsx$/);
});
