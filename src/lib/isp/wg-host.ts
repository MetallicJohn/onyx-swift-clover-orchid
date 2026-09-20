/** Parse `wg show <iface> dump` from the VPS host kernel. The web container may not have this. */
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

function isPublicKey(value: string) {
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

export type WantedHubPeer = { publicKey: string; allowedIps: string; name?: string };

export function wgStateDir() {
  return (process.env.ISPSOLUTIONS_WG_DIR || "/var/lib/ispsolutions/wg").trim() || "/var/lib/ispsolutions/wg";
}

export function wgDumpPath() {
  return (process.env.ISPSOLUTIONS_WG_DUMP || "/run/ispsolutions/wg.dump").trim() || "/run/ispsolutions/wg.dump";
}

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
    try {
      const text = await readFile(wgDumpPath(), "utf8");
      return parseWgDump(text);
    } catch {
      return [] as WgDumpPeer[];
    }
  }
}

export async function applyHostPeer(peer: { publicKey: string; address: string }) {
  const pub = peer.publicKey.trim();
  const addr = (peer.address || "").trim();
  const cidr = addr.includes("/") ? addr : addr ? `${addr}/32` : "";
  if (!pub || !cidr || !isPublicKey(pub)) return { ok: false as const, reason: "invalid" };
  try {
    await execFileAsync("wg", ["set", ROS_WG_INTERFACE, "peer", pub, "allowed-ips", cidr], { timeout: 4000 });
    await execFileAsync("wg-quick", ["save", ROS_WG_INTERFACE], { timeout: 4000 }).catch(() => null);
    return { ok: true as const };
  } catch {
    return { ok: false as const, reason: "host" };
  }
}

export async function writeWantedHubPeers(peers: WantedHubPeer[]) {
  const dir = wgStateDir();
  const wanted = {
    interface: ROS_WG_INTERFACE,
    peers: peers
      .filter((p) => isPublicKey(p.publicKey) && p.allowedIps)
      .map((p) => ({
        publicKey: p.publicKey.trim(),
        allowedIps: p.allowedIps.includes("/") ? p.allowedIps : `${p.allowedIps}/32`,
        name: (p.name || "").slice(0, 80),
      })),
  };
  try {
    await mkdir(dir, { recursive: true });
    const dest = join(dir, "wanted.json");
    const tmp = join(dir, `.wanted.${process.pid}.json`);
    await writeFile(tmp, `${JSON.stringify(wanted, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, dest);
    return dest;
  } catch {
    return "";
  }
}

export async function persistWantedHubPeersFromSql(sql: {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
}) {
  const rows = await sql<{ name: string; public_key: string; wg_address: string }>`
    select r.name, r.wg_public as public_key, r.wg_address
    from routers r
    where coalesce(r.wg_public,'') <> '' and r.archived_at is null
      and coalesce(r.enroll_state,'') <> 'REVOKED'
    order by r.name`;
  const peers = rows.map((r) => ({
    name: r.name,
    publicKey: r.public_key,
    allowedIps: r.wg_address.includes("/") ? r.wg_address : `${r.wg_address}/32`,
  }));
  await writeWantedHubPeers(peers);
  return peers.length;
}
