import { rosQuote } from "./routeros.ts";

export const ARP_MODES = ["normal", "reply_only"] as const;
export type ArpMode = (typeof ARP_MODES)[number];

export const OPTION43_FORMATS = ["hex", "ascii"] as const;
export type Option43Format = (typeof OPTION43_FORMATS)[number];

const MANAGED_PREFIX = "ISP Solutions | ";

export function isArpMode(value: string): value is ArpMode {
  return value === "normal" || value === "reply_only";
}

export function isOption43Format(value: string): value is Option43Format {
  return value === "hex" || value === "ascii";
}

/** Canonical display form. Storage stays 12 hex via sanitizeMac. */
export function canonicalMac(raw: string) {
  const hex = raw.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (hex.length !== 12) throw new Error("CPE MAC address must be 12 hex characters");
  if (hex === "000000000000") throw new Error("CPE MAC address cannot be all zeros");
  if (hex === "FFFFFFFFFFFF") throw new Error("CPE MAC address cannot be the broadcast address");
  const first = Number.parseInt(hex.slice(0, 2), 16);
  if (first & 1) throw new Error("CPE MAC address cannot be a multicast address");
  return hex.match(/.{2}/g)!.join(":");
}

export function option43Hex(format: string, value: string) {
  const fmt = String(format || "hex").toLowerCase();
  const original = String(value || "");
  const raw = original.trim();
  if (!isOption43Format(fmt)) throw new Error("Option 43 format must be hex or ascii");
  if (!raw) throw new Error("Option 43 value is required");
  let hex = "";
  if (fmt === "ascii") {
    if (raw.length > 255) throw new Error("Option 43 value is too long");
    if (/[^\x20-\x7e]/.test(original)) throw new Error("ASCII Option 43 must be printable characters");
    hex = Buffer.from(raw, "utf8").toString("hex");
  } else {
    const body = raw.replace(/^0x/i, "").replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]+$/.test(body) || body.length % 2 !== 0) {
      throw new Error("Hex Option 43 must be an even number of hex digits");
    }
    if (body.length / 2 > 255) throw new Error("Option 43 value is too long");
    hex = body.toLowerCase();
  }
  return `0x${hex}`;
}

export function arpComment(name: string, phone: string) {
  const who = String(name || "").replace(/[\r\n"]/g, " ").trim().slice(0, 80) || "Customer";
  const tel = String(phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  const label = tel ? `${who} / ${tel}` : who;
  return `${MANAGED_PREFIX}${label}`;
}

export function isManagedArpComment(comment: string) {
  return comment.startsWith(MANAGED_PREFIX);
}

export type ArpExisting = { address: string; mac: string; comment: string };

function sameMac(raw: string, expected: string) {
  try {
    return canonicalMac(raw) === expected;
  } catch {
    return false;
  }
}

export function planArpBinding(
  address: string,
  desired: { mac: string; comment: string } | null,
  existing: ArpExisting[],
) {
  const rows = existing.filter((row) => row.address === address);
  const managed = rows.filter((row) => isManagedArpComment(row.comment));
  const foreign = rows.filter((row) => !isManagedArpComment(row.comment));
  if (!desired) {
    return { action: managed.length ? ("remove" as const) : ("noop" as const), error: "" };
  }
  if (foreign.some((row) => !sameMac(row.mac, desired.mac))) {
    return {
      action: "conflict" as const,
      error: `ARP conflict: ${address} is already bound to another MAC address.`,
    };
  }
  const same = managed.find((row) => sameMac(row.mac, desired.mac) && row.comment === desired.comment);
  if (same) return { action: "noop" as const, error: "" };
  return { action: managed.length ? ("update" as const) : ("add" as const), error: "" };
}

export function arpUpsertScript(address: string, mac: string, comment: string) {
  const addr = rosQuote(address);
  const hw = rosQuote(mac);
  const cmt = rosQuote(comment);
  return `:local addr ${addr};
:local mac ${hw};
:local cmt ${cmt};
:local foreign [/ip arp find where address=$addr and comment!~"^ISP Solutions"];
:if ([:len $foreign] > 0) do={
  :local fmac [/ip arp get [:pick $foreign 0] mac-address];
  :if ($fmac != $mac) do={
    :error ("ARP conflict");
  }
} else={
  :local id [/ip arp find where address=$addr and comment~"^ISP Solutions"];
  :if ([:len $id] = 0) do={
    /ip arp add address=$addr mac-address=$mac comment=$cmt;
  } else={
    /ip arp set $id mac-address=$mac comment=$cmt;
  }
}`;
}

export function arpRemoveScript(address: string) {
  const addr = rosQuote(address);
  return `:local addr ${addr};
:do { /ip arp remove [find where address=$addr and comment~"^ISP Solutions"] } on-error={};`;
}

export function dhcpOption43Script(name: string, cidr: string, hexValue: string) {
  const opt = rosQuote(name.slice(0, 32));
  const net = rosQuote(cidr);
  const value = rosQuote(hexValue);
  return `:local opt ${opt};
:local net ${net};
:local val ${value};
:if ([:len [/ip dhcp-server option find where name=$opt]] = 0) do={
  /ip dhcp-server option add name=$opt code=43 value=$val;
} else={
  /ip dhcp-server option set [find where name=$opt] code=43 value=$val;
}
:if ([:len [/ip dhcp-server network find where address=$net]] > 0) do={
  /ip dhcp-server network set [find where address=$net] dhcp-option=$opt;
}`;
}

export function verifyArpSnapshot(
  rows: ArpExisting[],
  expected: { address: string; mac: string; comment: string },
) {
  const hit = rows.find(
    (row) =>
      row.address === expected.address &&
      canonicalMac(row.mac) === expected.mac &&
      row.comment === expected.comment,
  );
  return Boolean(hit);
}
