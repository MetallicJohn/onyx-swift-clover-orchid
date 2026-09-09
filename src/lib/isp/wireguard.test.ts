import assert from "node:assert/strict";
import { test } from "node:test";
import { enrollRosScript } from "./routeros.ts";
import { openTestDb } from "./test-db.ts";
import {
  buildServerConf,
  buildServerInstallScript,
  ensureTenantHub,
  generateWireGuardKeypair,
  generateX25519Pair,
  isWireGuardPublicKey,
  normalizeWgEndpoint,
  renderServerConfig,
  saveTenantHub,
  syncRouterWgPeer,
  x25519Agree,
} from "./wireguard.ts";

test("X25519 public keys are 32 raw bytes (WireGuard format)", () => {
  const keys = generateWireGuardKeypair();
  assert.equal(isWireGuardPublicKey(keys.publicKey), true);
  assert.equal(isWireGuardPublicKey(keys.privateKey), true);
  assert.match(keys.privateKeySealed, /^enc:v1:/);
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

test("normalizes pasted VPN URLs into host and port", () => {
  assert.deepEqual(normalizeWgEndpoint("https://vpn.imani.ke:51821/wg"), {
    host: "vpn.imani.ke",
    port: 51821,
  });
  assert.deepEqual(normalizeWgEndpoint("102.68.10.2", 51820), {
    host: "102.68.10.2",
    port: 51820,
  });
});

test("server wg-quick config is a hub with one peer per router", () => {
  const hubKeys = generateWireGuardKeypair();
  const client = generateWireGuardKeypair();
  const conf = buildServerConf(
    {
      publicKey: hubKeys.publicKey,
      privateKey: hubKeys.privateKey,
      address: "10.200.0.1/24",
      network: "10.200.0.0/24",
      listenPort: 51820,
      endpointHost: "vpn.imani.ke",
    },
    [{ name: "edge-01", publicKey: client.publicKey, address: "10.200.0.2/32" }],
  );
  assert.match(conf, /^\[Interface\]/m);
  assert.match(conf, /Address = 10\.200\.0\.1\/24/);
  assert.match(conf, /ListenPort = 51820/);
  assert.equal(conf.includes(`PrivateKey = ${hubKeys.privateKey}`), true);
  assert.match(conf, /\[Peer\]/);
  assert.equal(conf.includes(`PublicKey = ${client.publicKey}`), true);
  assert.match(conf, /AllowedIPs = 10\.200\.0\.2\/32/);
  assert.equal(conf.includes(`PrivateKey = ${client.privateKey}`), false);
  const install = buildServerInstallScript(
    {
      publicKey: hubKeys.publicKey,
      privateKey: hubKeys.privateKey,
      address: "10.200.0.1/24",
      network: "10.200.0.0/24",
      listenPort: 51820,
      endpointHost: "vpn.imani.ke",
    },
    [{ name: "edge-01", publicKey: client.publicKey, address: "10.200.0.2/32" }],
  );
  assert.match(install, /wg-quick up wg-gridline/);
  assert.match(install, /\/etc\/wireguard\/wg-gridline.conf/);
});

test("client enroll script sets the router private key and hub endpoint", () => {
  const hub = generateWireGuardKeypair();
  const client = generateWireGuardKeypair();
  const script = enrollRosScript({
    name: "edge-01",
    identity: "edge-01",
    token: "agt_test",
    wgPublic: client.publicKey,
    wgPrivate: client.privateKey,
    wgAddress: "10.200.0.2/32",
    serverPublic: hub.publicKey,
    endpointHost: "vpn.imani.ke",
    endpointPort: 51820,
    serverAddress: "10.200.0.1",
  });
  assert.match(script, /interface wireguard add name=wg-gridline/);
  assert.match(script, /private-key=\$wgPriv/);
  assert.equal(script.includes(`:local wgPriv "${client.privateKey}"`), true);
  assert.equal(script.includes(`:local srvKey "${hub.publicKey}"`), true);
  assert.match(script, /endpoint-address="vpn.imani.ke" endpoint-port=51820/);
  assert.match(script, /allowed-address=\$allowed/);
  assert.doesNotMatch(script, /cannot start the handshake/);
});

test("tenant hub config is persisted and server conf lists router peers", async () => {
  const { sql, close } = await openTestDb();
  try {
    await sql`insert into tenants (id, name, slug) values ('ten_wg', 'Imani', 'imani')`;
    const hub = await saveTenantHub(sql, "ten_wg", {
      endpointHost: "https://vpn.imani.ke:51820",
    });
    assert.equal(hub.endpointHost, "vpn.imani.ke");
    assert.equal(hub.listenPort, 51820);
    assert.equal(isWireGuardPublicKey(hub.publicKey), true);
    assert.equal("privateKey" in hub, false);

    const client = generateWireGuardKeypair();
    await sql`insert into routers (id, tenant_id, name, identity, enroll_token, wg_public, wg_private_ref, wg_address, wg_status)
      values ('rtr_wg', 'ten_wg', 'edge-01', 'edge-01', 'agt_wg', ${client.publicKey}, ${client.privateKeySealed}, '10.200.0.2/32', 'pending')`;
    await syncRouterWgPeer(sql, "ten_wg", {
      id: "rtr_wg",
      wg_public: client.publicKey,
      wg_private_ref: client.privateKeySealed,
      wg_address: "10.200.0.2/32",
    });
    const peers = await sql<{ public_key: string; address: string }>`
      select public_key, address from wireguard_peers where tenant_id = ${"ten_wg"}`;
    assert.equal(peers[0]?.public_key, client.publicKey);
    assert.equal(peers[0]?.address, "10.200.0.2/32");

    const rendered = await renderServerConfig(sql, "ten_wg");
    assert.match(rendered.conf, /ListenPort = 51820/);
    assert.equal(rendered.conf.includes(`PublicKey = ${client.publicKey}`), true);
    assert.match(rendered.conf, /PrivateKey = /);
    assert.equal(rendered.hub.publicKey, hub.publicKey);
    assert.ok(!("privateKey" in rendered.hub));
    const again = await ensureTenantHub(sql, "ten_wg");
    assert.equal(again.publicKey, hub.publicKey);
  } finally {
    await close();
  }
});
