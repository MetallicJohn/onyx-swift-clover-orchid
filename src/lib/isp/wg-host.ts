/** Parse `wg show <iface> dump` from the VPS host kernel. The web container may not have this. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROS_WG_INTERFACE } from "../brand.ts";

const execFileAsync = promisify(execFile);
export type WgDumpPeer = {
  publicKey: string;
  endpoint: string;
  allowedIps: string;
  lastHandshakeAt: string | null;
  lastHandshakeUnix: number;
  rxBytes: number;
  txBytes: number;
};

export function parseWgDump(text: string): WgDumpPeer[] {
  const peers: WgDumpPeer[] = [];
  for (const line of (text || "").split(/\n+/)) {
    const cols = line.trim().split(/\t/);
    if (cols.length < 8) continue;
    if (cols[2] === "(none)" || cols[0].length < 40) {
      /* interface line: private, public, listen, fwmark */
      continue;
    }
    const handshakeUnix = Number(cols[4] || 0);
    peers.push({
      publicKey: cols[0],
      endpoint: cols[2] === "(none)" ? "" : cols[2],
      allowedIps: cols[3] || "",
      lastHandshakeUnix: handshakeUnix,
      lastHandshakeAt: handshakeUnix > 0 ? new Date(handshakeUnix * 1000).toISOString() : null,
      rxBytes: Number(cols[5] || 0),
      txBytes: Number(cols[6] || 0),
    });
  }
  return peers;
}

export function handshakeFresh(unix: number, now = Date.now(), maxAgeMs = 180_000) {
  if (!unix) return false;
  return now - unix * 1000 <= maxAgeMs && unix * 1000 <= now + 5_000;
}

export function findDumpPeer(peers: WgDumpPeer[], publicKey: string) {
  return peers.find((p) => p.publicKey === publicKey) || null;
}

export async function readHostWgDump(iface = ROS_WG_INTERFACE) {
  try {
    const { stdout } = await execFileAsync("wg", ["show", iface, "dump"], { timeout: 4000 });
    return parseWgDump(stdout);
  } catch {
    return [] as WgDumpPeer[];
  }
}
