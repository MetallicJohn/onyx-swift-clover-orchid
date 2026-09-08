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
