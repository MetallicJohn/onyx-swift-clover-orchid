import assert from "node:assert/strict";
import { test } from "node:test";
import { compileMikrotik } from "./mikrotik.ts";
import {
  arpComment,
  canonicalMac,
  dhcpOption43Script,
  option43Hex,
  planArpBinding,
  verifyArpSnapshot,
} from "./pool-network.ts";
import { validatePoolDraft } from "./router-desk-format.ts";

test("option 43 hex and ascii are validated", () => {
  assert.equal(option43Hex("hex", "0x0102"), "0x0102");
  assert.equal(option43Hex("ascii", "Hi"), "0x4869");
  assert.throws(() => option43Hex("hex", "abc"), /even number/);
  assert.throws(() => option43Hex("ascii", "bad\n"), /printable/);
  assert.throws(() => option43Hex("hex", "zz"), /even number/);
});

test("reply-only mac is normalized and unsafe macs are rejected", () => {
  assert.equal(canonicalMac("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF");
  assert.throws(() => canonicalMac(""), /12 hex/);
  assert.throws(() => canonicalMac("00:00:00:00:00:00"), /zeros/);
  assert.throws(() => canonicalMac("ff:ff:ff:ff:ff:ff"), /broadcast/);
  assert.throws(() => canonicalMac("01:00:00:00:00:00"), /multicast/);
});

test("arp plan updates a managed binding and refuses a foreign one", () => {
  const comment = arpComment("John Kamau", "0712345678");
  assert.match(comment, /John Kamau \/ 0712345678/);
  const address = "192.168.10.25";
  assert.equal(planArpBinding(address, { mac: "AA:BB:CC:DD:EE:FF", comment }, []).action, "add");
  assert.equal(
    planArpBinding(address, { mac: "11:22:33:44:55:66", comment }, [
      { address, mac: "AA:BB:CC:DD:EE:FF", comment },
    ]).action,
    "update",
  );
  const conflict = planArpBinding(address, { mac: "AA:BB:CC:DD:EE:FF", comment }, [
    { address, mac: "11:22:33:44:55:66", comment: "admin" },
  ]);
  assert.equal(conflict.action, "conflict");
  assert.equal(planArpBinding(address, null, [{ address, mac: "AA:BB:CC:DD:EE:FF", comment }]).action, "remove");
  assert.equal(
    verifyArpSnapshot([{ address, mac: "AA:BB:CC:DD:EE:FF", comment }], {
      address,
      mac: "AA:BB:CC:DD:EE:FF",
      comment,
    }),
    true,
  );
});

test("pool defaults stay normal and option 43 is router-script safe", () => {
  const draft = validatePoolDraft({ name: "Customers", cidr: "192.168.10.0/24", access_type: "static" });
  assert.equal(draft.static_arp_mode, "normal");
  assert.equal(draft.dhcp_option_43_enabled, false);
  const dhcp = validatePoolDraft({
    name: "DHCP",
    cidr: "10.20.0.0/24",
    access_type: "dhcp",
    dhcp_option_43_enabled: true,
    dhcp_option_43_format: "ascii",
    dhcp_option_43_value: "acme",
  });
  assert.equal(dhcp.dhcp_option_43_enabled, true);
  const compiled = compileMikrotik("dhcp.option43", {
    option_name: "isp43-pool",
    cidr: dhcp.cidr,
    value: "0x61636d65",
    enabled: true,
  });
  assert.match(compiled.script, /code=43/);
  assert.equal(compiled.script.includes("acme\n"), false);
  assert.match(dhcpOption43Script("isp43", "10.20.0.0/24", "0x01"), /dhcp-option/);
  const arp = compileMikrotik("arp.upsert", {
    address: "192.168.10.25",
    mac: "AA:BB:CC:DD:EE:FF",
    comment: arpComment("John Kamau", "0712345678"),
  });
  assert.match(arp.script, /AA:BB:CC:DD:EE:FF/);
  assert.match(arp.script, /John Kamau/);
  assert.match(arp.script, /ARP conflict/);
  assert.doesNotMatch(arp.script, /password/i);
});
