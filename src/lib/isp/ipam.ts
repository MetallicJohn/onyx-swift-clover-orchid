export function parseV4Cidr(cidr: string) {
  const [ip, prefixRaw] = cidr.split("/");
  const parts = (ip || "").split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error("Invalid IPv4 CIDR");
  }
  const prefix = Number(prefixRaw ?? 24);
  if (prefix < 8 || prefix > 32) throw new Error("Unsupported prefix");
  return { parts, prefix };
}

export function parseIpv4(ip: string) {
  const parts = (ip || "").trim().split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error("Invalid IPv4 address");
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function formatIpv4(n: number) {
  const x = n >>> 0;
  return [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join(".");
}

export function cidrSpan(cidr: string) {
  const { parts, prefix } = parseV4Cidr(cidr);
  const base = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const mask = hostBits === 0 ? 0xffffffff : (0xffffffff << hostBits) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network + size - 1) >>> 0;
  const firstHost = size > 2 ? network + 1 : network;
  const lastHost = size > 2 ? broadcast - 1 : broadcast;
  return { network, broadcast, firstHost, lastHost, size, prefix };
}

export function ipv4InCidr(ip: string, cidr: string) {
  const n = parseIpv4(ip);
  const span = cidrSpan(cidr);
  return n >= span.network && n <= span.broadcast;
}

export function cidrOverlaps(a: string, b: string) {
  const left = cidrSpan(a);
  const right = cidrSpan(b);
  return left.network <= right.broadcast && right.network <= left.broadcast;
}

export function ipv4At(cidr: string, hostIndex: number) {
  const { parts } = parseV4Cidr(cidr);
  const last = Math.min(254, Math.max(1, hostIndex));
  return `${parts[0]}.${parts[1]}.${parts[2]}.${last}`;
}

export function nextIpv4(cidr: string, nextHost: number) {
  const address = ipv4At(cidr, nextHost);
  return { address, nextHost: nextHost + 1 };
}

export const IP_STATES = ["available", "reserved", "assigned", "quarantined", "decommissioned"] as const;
export type IpState = (typeof IP_STATES)[number];
