import assert from "node:assert/strict";
import { test } from "node:test";
import { hint, open, redactRecord, seal } from "./secrets.ts";

test("seal/open roundtrip", () => {
  const sealed = seal("WFK-super-secret");
  assert.match(sealed, /^enc:v1:/);
  assert.equal(open(sealed), "WFK-super-secret");
});

test("hint never returns plaintext", () => {
  const sealed = seal("passkey-123456");
  const h = hint(sealed);
  assert.equal(h.includes("passkey"), false);
  assert.match(h, /••••/);
});

test("redactRecord strips secret keys", () => {
  const out = redactRecord({ client_secret: "abc12345", till_number: "174379" });
  assert.equal(out.till_number, "174379");
  assert.notEqual(out.client_secret, "abc12345");
});

test("API response must not include plaintext secrets", () => {
  const payload = redactRecord({
    api_password: "router-pass",
    wa_access_token: "EAAB",
    name: "Edge-01",
  });
  assert.equal(payload.name, "Edge-01");
  assert.equal(String(payload.api_password).includes("router-pass"), false);
});
