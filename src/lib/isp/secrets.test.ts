import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

test("source does not contain the old published development secret", () => {
  const src = readFileSync(new URL("./secrets.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /gridline-dev-secret-change-me/);
  assert.match(src, /APP_SECRET or BETTER_AUTH_SECRET is required/);
});

test("production DATABASE_URL without APP_SECRET fails closed", () => {
  const moduleUrl = new URL("./secrets.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const { seal } = await import(${JSON.stringify(moduleUrl)});
       try { seal("x"); process.exit(2); }
       catch (e) { process.exit(/APP_SECRET/.test(String(e)) ? 0 : 3); }`,
    ],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgres://ci",
        APP_SECRET: "",
        BETTER_AUTH_SECRET: "",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
