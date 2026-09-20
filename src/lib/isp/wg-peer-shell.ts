import { ROS_WG_INTERFACE } from "../brand.ts";

export function hubPeerShell(peer: { publicKey: string; address: string }) {
  const pub = peer.publicKey.trim();
  const addr = (peer.address || "").trim();
  const cidr = addr.includes("/") ? addr : addr ? `${addr}/32` : "";
  if (!pub || !cidr) return "";
  if (pub.length < 42 || pub.length > 48 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pub)) return "";
  return `wg set ${ROS_WG_INTERFACE} peer ${pub} allowed-ips ${cidr}\nwg-quick save ${ROS_WG_INTERFACE}`;
}
