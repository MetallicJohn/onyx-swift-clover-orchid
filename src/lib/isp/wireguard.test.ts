import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

function rawFromDer(der: Buffer, size = 32) {
  return der.subarray(der.length - size).toString("base64");
}

function isWireGuardPublicKey(value: string) {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

test("X25519 public keys are 32 raw bytes (WireGuard format)", () => {
  const pair = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const pub = rawFromDer(pair.publicKey);
  assert.equal(isWireGuardPublicKey(pub), true);
});

test("rejects fake encoded name+token keys", () => {
  const fake = Buffer.from("edge-01agt_abc").toString("base64").slice(0, 44);
  assert.equal(isWireGuardPublicKey(fake), false);
});
