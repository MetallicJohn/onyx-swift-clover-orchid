import assert from "node:assert/strict";
import { test } from "node:test";
import { enrollRosScript } from "./routeros.ts";
import {
  canTransition,
  compositeEnrollState,
  healthLabel,
  parseEnrollState,
} from "./router-enroll-state.ts";
import { handshakeFresh, parseWgDump } from "./wg-host.ts";
import { generateWireGuardKeypair } from "./wireguard.ts";

test("enrollment state machine does not skip to ENROLLED", () => {
  assert.equal(parseEnrollState("bootstrapping"), "PENDING");
  assert.equal(canTransition("PENDING", "BOOTSTRAP_GENERATED"), true);
  assert.equal(canTransition("PENDING", "ENROLLED"), false);
  assert.equal(
    compositeEnrollState({ current: "BOOTSTRAP_GENERATED", handshake: false, api: false, agent: true }),
    "BOOTSTRAP_GENERATED",
  );
  assert.equal(
    compositeEnrollState({ current: "WIREGUARD_CONNECTED", handshake: true, api: true, agent: true }),
    "ENROLLED",
  );
  assert.equal(
    compositeEnrollState({ current: "ENROLLED", handshake: false, api: true, agent: true }),
    "DEGRADED",
  );
  assert.equal(healthLabel("ENROLLED"), "ONLINE");
  assert.equal(healthLabel("REVOKED"), "REVOKED");
});

test("wg dump handshake requires bytes and a fresh timestamp", () => {
  const now = 1_700_000_180;
  const dump = parseWgDump(
    `priv\tpub\t51820\toff\nPEERKEY12345678901234567890123456789012=\t(none)\t1.2.3.4:51820\t10.200.0.2/32\t${now}\t80\t40\t25\n`,
  );
  assert.equal(dump.length, 1);
  assert.equal(dump[0]?.rxBytes, 80);
  assert.equal(handshakeFresh(now, now * 1000 + 1000), true);
  assert.equal(handshakeFresh(0), false);
});

test("generated enroll script is certificate-free, overlay-API-only, and does not log tokens", () => {
  const hub = generateWireGuardKeypair();
  const client = generateWireGuardKeypair();
  const script = enrollRosScript({
    name: "nice3",
    identity: "nice3",
    token: "agt_secret_token",
    routerId: "rtr_nice3",
    wgPublic: client.publicKey,
    wgPrivate: client.privateKey,
    wgAddress: "10.200.0.4/32",
    serverPublic: hub.publicKey,
    endpointHost: "wg.ispsolutions.co.ke",
    endpointPort: 51820,
    serverAddress: "10.200.0.1",
    pullUrl: "https://ispsolutions.co.ke/api/agent/script?token=agt_secret_token",
    apiUser: "ispsolutions-agent",
    apiPassword: "generated-pass",
  });
  assert.match(script, /endpoint-address="wg\.ispsolutions\.co\.ke" endpoint-port=51820/);
  assert.match(script, /allowed-address="10\.200\.0\.1\/32"/);
  assert.match(script, /dst-port=8728 src-address=10\.200\.0\.1/);
  assert.match(script, /check-certificate=no/);
  assert.match(script, /\/user add name="ispsolutions-agent" password=/);
  assert.match(script, /policy=ftp,read,write,policy,test,password,sensitive/);
  assert.match(script, /enrollment bootstrap initialized for router/);
  assert.doesNotMatch(script, /check-certificate=yes/);
  assert.doesNotMatch(script, /enrolled token=/);
  assert.doesNotMatch(script, /185\.185\.126\.169/);
  assert.doesNotMatch(script, /endpoint-address="ispsolutions\.co\.ke"/);
  assert.doesNotMatch(script, /www-ssl/);
  assert.doesNotMatch(script, /group=full/);
  assert.doesNotMatch(script, /in-interface=wg-ispsolutions action=accept;/);
});
