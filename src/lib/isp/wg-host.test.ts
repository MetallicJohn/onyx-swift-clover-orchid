import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateWireGuardKeypair } from "./wireguard.ts";
import { applyHostPeer, handshakeLive, parseWgDump, writeWantedHubPeers } from "./wg-host.ts";

test("applyHostPeer rejects a non-key and does not throw when wg is missing", async () => {
  assert.deepEqual(await applyHostPeer({ publicKey: "nope", address: "10.200.0.2/32" }), { ok: false, reason: "invalid" });
  const keys = generateWireGuardKeypair();
  const out = await applyHostPeer({ publicKey: keys.publicKey, address: "10.200.0.2/32" });
  assert.equal(out.ok === true || out.reason === "host", true);
});

test("wanted hub peers file contains public keys only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isp-wg-"));
  process.env.ISPSOLUTIONS_WG_DIR = dir;
  const a = generateWireGuardKeypair();
  const b = generateWireGuardKeypair();
  const dest = await writeWantedHubPeers([
    { publicKey: a.publicKey, allowedIps: "10.200.0.2", name: "nice4" },
    { publicKey: "bad", allowedIps: "10.200.0.3/32", name: "skip" },
    { publicKey: b.publicKey, allowedIps: "10.200.0.4/32" },
  ]);
  assert.ok(dest.endsWith("wanted.json"));
  const body = await readFile(dest, "utf8");
  assert.match(body, /wg-ispsolutions/);
  assert.match(body, /10\.200\.0\.2\/32/);
  assert.doesNotMatch(body, new RegExp(a.privateKey.replace(/[+/=]/g, "\\$&")));
  const parsed = JSON.parse(body) as { peers: { publicKey: string }[] };
  assert.equal(parsed.peers.length, 2);
});

test("wg dump parser skips the interface line", () => {
  const keys = generateWireGuardKeypair();
  const dump = [
    "priv\tpub\t51820\toff",
    `${keys.publicKey}\t(none)\t10.0.0.1:1234\t10.200.0.2/32\t1700000000\t100\t20\t25`,
  ].join("\n");
  const peers = parseWgDump(dump);
  assert.equal(peers.length, 1);
  assert.equal(peers[0]?.publicKey, keys.publicKey);
  assert.equal(peers[0]?.rxBytes, 100);
  assert.equal(handshakeLive(peers[0], 1_700_000_000_000), true);
  assert.equal(handshakeLive({ ...peers[0]!, rxBytes: 0 }, 1_700_000_000_000), false);
});
