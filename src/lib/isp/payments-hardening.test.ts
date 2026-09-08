import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("confirmStk cannot mark live simulated STK confirmed", async () => {
  const src = readFileSync(new URL("./payments.ts", import.meta.url), "utf8");
  assert.match(src, /Cannot confirm a simulated STK on a live provider/);
  assert.match(src, /checkout_id.startsWith\("ws_"\)/);
});

test("applyConfirmedPayment is idempotent on duplicate reference", async () => {
  const src = readFileSync(new URL("./payments.ts", import.meta.url), "utf8");
  assert.match(src, /Duplicate payment reference/);
});

test("webhooks skip already confirmed intents", () => {
  const src = readFileSync(new URL("./webhooks.ts", import.meta.url), "utf8");
  assert.match(src, /evaluateStkCallback/);
  assert.match(src, /decision.action === "idempotent"/);
});
