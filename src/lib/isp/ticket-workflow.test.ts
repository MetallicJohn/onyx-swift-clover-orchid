import assert from "node:assert/strict";
import { test } from "node:test";
import { canTechnicianSet, parseTechnicianCommand, slaHours, technicianMoves } from "./ticket-workflow.ts";
import { normalizePhone } from "./phone.ts";

test("urgent tickets have a 4 hour SLA", () => {
  assert.equal(slaHours("urgent"), 4);
  assert.equal(canTechnicianSet("accepted", "travelling"), true);
  assert.equal(canTechnicianSet("new", "closed"), false);
});

test("technician moves stay inside two steps", () => {
  assert.deepEqual(technicianMoves("assigned"), ["accepted", "travelling"]);
  assert.equal(technicianMoves("on_site").includes("resolved"), true);
  assert.equal(technicianMoves("accepted").includes("resolved"), false);
});

test("whatsapp field replies are exact phrases", () => {
  assert.equal(parseTechnicianCommand("on site"), "on_site");
  assert.equal(parseTechnicianCommand("Resolved"), "resolved");
  assert.equal(parseTechnicianCommand("I'm here"), "on_site");
  assert.equal(parseTechnicianCommand("the line is resolved now"), null);
});

test("Kenyan phones normalize to 254", () => {
  assert.equal(normalizePhone("0712345678"), "254712345678");
});
