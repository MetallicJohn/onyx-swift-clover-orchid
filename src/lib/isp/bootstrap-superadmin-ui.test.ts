import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("default Superadmin password is not in the frontend or login copy", () => {
  const login = readFileSync(new URL("../../routes/login.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../../components/platform/shell.tsx", import.meta.url), "utf8");
  const gate = readFileSync(new URL("../../routes/platform.tsx", import.meta.url), "utf8");
  const clientMap = readFileSync(new URL("./bootstrap-login.ts", import.meta.url), "utf8");
  assert.doesNotMatch(login, /SuperAdmin/);
  assert.doesNotMatch(shell, /SuperAdmin/);
  assert.doesNotMatch(gate, /SuperAdmin/);
  assert.doesNotMatch(clientMap, /SuperAdmin/);
  assert.match(shell, /You are using Default Password, Change Immediately/);
  assert.match(shell, /Change Password/);
  assert.match(login, /Email or username/);
  assert.match(clientMap, /superadmin@ispsolutions\.internal/);
});
