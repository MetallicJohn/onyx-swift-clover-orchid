import { diffieHellman, generateKeyPairSync, type KeyObject } from "node:crypto";
import { seal } from "./secrets.ts";

function rawFromDer(der: Buffer, size = 32) {
  return der.subarray(der.length - size).toString("base64");
}

export function generateWireGuardKeypair() {
  const pair = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const publicKey = rawFromDer(pair.publicKey);
  const privateKey = rawFromDer(pair.privateKey);
  if (publicKey.length < 40 || privateKey.length < 40) {
    throw new Error("WireGuard key generation failed");
  }
  return {
    publicKey,
    privateKeySealed: seal(privateKey),
  };
}

export function generateX25519Pair() {
  return generateKeyPairSync("x25519");
}

export function x25519Agree(privateKey: KeyObject, publicKey: KeyObject) {
  const secret = diffieHellman({ privateKey, publicKey });
  if (secret.length !== 32) throw new Error("X25519 agreement did not produce 32 bytes");
  return secret;
}

export function isWireGuardPublicKey(value: string) {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length === 32;
  } catch {
    return false;
  }
}
