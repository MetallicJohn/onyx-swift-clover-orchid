import assert from "node:assert/strict";
import { test } from "node:test";
import { compileMikrotik } from "./mikrotik.ts";
import { mikrotikProfileName, pcqFromPayload, pcqTypes } from "./pcq.ts";
import { commandRosScript } from "./routeros.ts";

test("package names map to isp- profile and PCQ type names", () => {
  assert.equal(mikrotikProfileName("Home 10"), "isp-home-10");
  assert.equal(mikrotikProfileName("Home 10 Mbps"), "isp-home-10-mbps");
  const t = pcqTypes(5, 10);
  assert.equal(t.upType, "isp-pcq-up-5M");
  assert.equal(t.downType, "isp-pcq-down-10M");
  const p = pcqFromPayload({ package: "Home 10", upload_mbps: 5, download_mbps: 10 });
  assert.equal(p.profile, "isp-home-10");
  assert.equal(p.list, "isp-home-10");
});

test("PPPoE upsert creates PCQ types and a package profile, not a simple queue", () => {
  const { rest, script } = compileMikrotik("pppoe.upsert", {
    username: "amina",
    password: "secret",
    package: "Home 10",
    upload_mbps: 5,
    download_mbps: 10,
  });
  assert.match(script, /kind=pcq/);
  assert.match(script, /pcq-classifier=src-address/);
  assert.match(script, /pcq-classifier=dst-address/);
  assert.match(script, /\/ppp profile/);
  assert.match(script, /profile=\$profile/);
  assert.doesNotMatch(script, /\/queue simple add/);
  assert.ok(rest.some((op) => op.path === "/rest/queue/type"));
  assert.ok(rest.some((op) => op.path === "/rest/ppp/secret" && op.body?.profile === "isp-home-10"));
});

test("static upsert uses address-list + queue tree and removes leftover simple queues", () => {
  const script = commandRosScript("static.upsert", {
    username: "brian",
    static_ip: "10.10.10.20",
    package: "Home 10",
    upload_mbps: 5,
    download_mbps: 10,
  });
  assert.match(script, /\/queue tree add/);
  assert.match(script, /src-address-list/);
  assert.match(script, /dst-address-list/);
  assert.match(script, /\/queue simple remove/);
  assert.doesNotMatch(script, /\/queue simple add/);
  const compiled = compileMikrotik("static.upsert", {
    username: "brian",
    static_ip: "10.10.10.20",
    package: "Home 10",
    upload_mbps: 5,
    download_mbps: 10,
  });
  assert.equal(compiled.rest.some((op) => op.path === "/rest/queue/simple"), false);
});

test("package.sync is only PCQ types, profiles, mangle and queue trees", () => {
  const { rest, script } = compileMikrotik("package.sync", {
    package: "Corp 20",
    upload_mbps: 10,
    download_mbps: 20,
  });
  assert.match(script, /isp-pcq-up-10M/);
  assert.match(script, /isp-pcq-down-20M/);
  assert.match(script, /isp-corp-20/);
  assert.doesNotMatch(script, /\/ppp secret/);
  assert.ok(rest.some((op) => op.path === "/rest/queue/tree"));
});
