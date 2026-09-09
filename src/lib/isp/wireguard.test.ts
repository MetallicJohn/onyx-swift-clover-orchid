import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateWireGuardKeypair,
  generateX25519Pair,
  isWireGuardPublicKey,
  x25519Agree,
} from "./wireguard.ts";

test("X25519 public keys are 32 raw bytes (WireGuard format)", () => {
  const keys = generateWireGuardKeypair();
  assert.equal(isWireGuardPublicKey(keys.publicKey), true);
});

test("rejects fake encoded name+token keys", () => {
  const fake = Buffer.from("edge-01agt_abc").toString("base64").slice(0, 44);
  assert.equal(isWireGuardPublicKey(fake), false);
});

test("two peers compute the same 32-byte shared secret", () => {
  const a = generateX25519Pair();
  const b = generateX25519Pair();
  assert.deepEqual(x25519Agree(a.privateKey, b.publicKey), x25519Agree(b.privateKey, a.publicKey));
});
