import assert from "node:assert/strict";
import { test } from "node:test";
import { canTechnicianSet, slaHours } from "./ticket-workflow.ts";
import { normalizePhone } from "./phone.ts";

test("urgent tickets have a 4 hour SLA", () => {
  assert.equal(slaHours("urgent"), 4);
  assert.equal(canTechnicianSet("accepted", "travelling"), true);
  assert.equal(canTechnicianSet("new", "closed"), false);
});

test("Kenyan phones normalize to 254", () => {
  assert.equal(normalizePhone("0712345678"), "254712345678");
});
