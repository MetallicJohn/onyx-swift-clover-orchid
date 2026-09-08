import assert from "node:assert/strict";
import { test } from "node:test";
import { initialCommandStatus, isDestructiveKind } from "./command-policy.ts";
import { nextIpv4 } from "./ipam.ts";

test("service commands auto-queue; raw scripts require approval", () => {
  assert.equal(initialCommandStatus("pppoe.upsert"), "queued");
  assert.equal(initialCommandStatus("pppoe.disconnect"), "queued");
  assert.equal(initialCommandStatus("raw.script"), "proposed");
  assert.equal(isDestructiveKind("reboot"), true);
});

test("IPAM walks a /24 without using .0", () => {
  const a = nextIpv4("102.68.10.0/24", 20);
  assert.equal(a.address, "102.68.10.20");
  assert.equal(a.nextHost, 21);
});
