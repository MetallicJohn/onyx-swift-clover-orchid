import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSentence, encodeSentence, encodeWord, parseReplies } from "./routeros-api.ts";

test("RouterOS API sentences round-trip", () => {
  const sent = encodeSentence(["/login", "=name=ispsolutions-agent", "=password=secret"]);
  const decoded = decodeSentence(sent);
  assert.deepEqual(decoded.words, ["/login", "=name=ispsolutions-agent", "=password=secret"]);
  assert.equal(decoded.rest.length, 0);
  assert.ok(encodeWord("x").length >= 2);
});

test("trap replies are parsed without leaking extra fields", () => {
  const reply = parseReplies([["!trap", "=message=invalid user name or password"], ["!done"]]);
  assert.equal(reply.type, "trap");
  assert.equal(reply.attrs.message, "invalid user name or password");
});
