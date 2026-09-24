import { diffieHellman, generateKeyPairSync, type KeyObject } from "node:crypto";
import { APP_NAME, ROS_WG_INTERFACE, ROS_WG_INTERFACE_LEGACY } from "../brand.ts";
import { nid } from "../utils.ts";
import { open, seal } from "./secrets.ts";
import { enrollEndpointHost, publicWgHost, publicWgHubAddress, publicWgPort, WG_DEFAULT_HUB_ADDRESS, WG_DEFAULT_NETWORK, WG_DEFAULT_PUBLIC_PORT } from "./wg-endpoint.ts";
import { applyHostPeer, persistWantedHubPeersFromSql } from "./wg-host.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function rawFromDer(der: Buffer, size = 32) {
  return der.subarray(der.length - size).toString("base64");
}

export function generateWireGuardKeypair() {
  const pair = generateKeyPairSync("x25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const publicKey = rawFromDer(pair.publicKey);
  const privateKey = rawFromDer(pair.privateKey);
  if (publicKey.length < 40 || privateKey.length < 40) {
    throw new Error("WireGuard key generation failed");
  }
  return {
    publicKey,
    privateKey,
    privateKeySealed: seal(privateKey),
  };
}

export function generateX25519Pair() {
  return generateKeyPairSync("x25519");
}

export function x25519Agree(privateKey: KeyObject, publicKey: KeyObject) {
  const secret = diffieHellman({ privateKey, publicKey });
  if (secret.length !== 32) throw new Error("X25519 agreement did not produce 32 bytes");
  return secret;
}

export function isWireGuardPublicKey(value: string) {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length === 32;
  } catch {
    return false;
  }
}

export type WgHubConfig = {
  publicKey: string;
  privateKey: string;
  address: string;
  network: string;
  listenPort: number;
  endpointHost: string;
};

export type WgPeerConfig = {
  name: string;
  publicKey: string;
  address: string;
};

export type WgHubPublic = {
  publicKey: string;
  address: string;
  network: string;
  listenPort: number;
  endpointHost: string;
  ready: boolean;
};

const DEFAULT_HUB_ADDRESS = `${WG_DEFAULT_HUB_ADDRESS}/24`;
const DEFAULT_HUB_NETWORK = WG_DEFAULT_NETWORK;
const DEFAULT_LISTEN_PORT = WG_DEFAULT_PUBLIC_PORT;

export function normalizeWgEndpoint(host: string, port?: number) {
  let raw = (host || "").trim();
  let listen = port && port > 0 ? port : DEFAULT_LISTEN_PORT;
  if (!raw) return { host: "", port: listen };
  try {
    if (raw.includes("://")) {
      const url = new URL(raw);
      raw = url.hostname;
      if (!port && url.port) listen = Number(url.port) || listen;
    }
  } catch {
    /* keep raw */
  }
  raw = raw.replace(/\/.*$/, "").replace(/^\[|\]$/g, "");
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4.test(raw) && raw.includes(":")) {
    const [h, p] = raw.split(":");
    raw = h || "";
    if (!port && p) listen = Number(p) || listen;
  }
  if (listen < 1 || listen > 65535) listen = DEFAULT_LISTEN_PORT;
  return { host: raw, port: listen };
}

function overlayIp(address: string) {
  return address.replace(/\/\d+$/, "");
}

function safeOverlayNetwork(network: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(network) ? network : DEFAULT_HUB_NETWORK;
}

/** App containers are not on the hub address. The router accepts TCP 8728 only from 10.200.0.1. */
export function hubNatCommands(iface: string, network: string) {
  const net = safeOverlayNetwork(network);
  return `if command -v iptables >/dev/null 2>&1; then
  iptables -t nat -C POSTROUTING -o ${iface} -d ${net} -j MASQUERADE 2>/dev/null \\
    || iptables -t nat -A POSTROUTING -o ${iface} -d ${net} -j MASQUERADE || true
  iptables -C DOCKER-USER -o ${iface} -j ACCEPT 2>/dev/null \\
    || iptables -I DOCKER-USER 1 -o ${iface} -j ACCEPT 2>/dev/null || true
  iptables -C DOCKER-USER -i ${iface} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \\
    || iptables -I DOCKER-USER 1 -i ${iface} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
fi
if command -v ufw >/dev/null 2>&1; then
  ufw route allow out on ${iface} to ${net} >/dev/null 2>&1 || true
fi`;
}

export function buildServerConf(hub: WgHubConfig, peers: WgPeerConfig[]) {
  const lines = [
    `# ${APP_NAME} hub — /etc/wireguard/${ROS_WG_INTERFACE}.conf`,
    "# Overlay " + hub.network + " · this host " + hub.address,
    "# Clients initiate with persistent keepalive. Do not NAT customer LAN through this interface.",
    "",
    "[Interface]",
    `Address = ${hub.address}`,
    `ListenPort = ${hub.listenPort}`,
    `PrivateKey = ${hub.privateKey}`,
    "SaveConfig = false",
    "# Docker API checks must leave as this host, or the router drops TCP 8728.",
    `PostUp = iptables -t nat -C POSTROUTING -o %i -d ${safeOverlayNetwork(hub.network)} -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -o %i -d ${safeOverlayNetwork(hub.network)} -j MASQUERADE`,
    "PostUp = iptables -C DOCKER-USER -o %i -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 1 -o %i -j ACCEPT 2>/dev/null || true",
    "PostUp = iptables -C DOCKER-USER -i %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 1 -i %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true",
  ];
  for (const peer of peers) {
    if (!peer.publicKey) continue;
    lines.push(
      "",
      `[Peer]`,
      `# ${peer.name}`,
      `PublicKey = ${peer.publicKey}`,
      `AllowedIPs = ${peer.address.includes("/") ? peer.address : `${peer.address}/32`}`,
    );
  }
  return lines.join("\n") + "\n";
}

export { hubPeerShell } from "./wg-peer-shell.ts";

export function buildServerInstallScript(hub: WgHubConfig, peers: WgPeerConfig[]) {
  const conf = buildServerConf(hub, peers);
  const iface = ROS_WG_INTERFACE;
  const legacy = ROS_WG_INTERFACE_LEGACY;
  return `#!/bin/bash
# ${APP_NAME} WireGuard hub. Run as root on the VPS that routers dial.
# Endpoint routers use: ${hub.endpointHost || "<public-ip>"}:${hub.listenPort}
# Migrates ${legacy} → ${iface} if an older hub is still up.
set -euo pipefail
if ! command -v wg >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y wireguard
  else
    echo "Install wireguard-tools, then re-run." >&2
    exit 1
  fi
fi
install -d -m 0700 /etc/wireguard
cat >/etc/wireguard/${iface}.conf <<'ISPSOLUTIONS_WG'
${conf}ISPSOLUTIONS_WG
chmod 600 /etc/wireguard/${iface}.conf
install -d -m 0755 /etc/sysctl.d
printf '%s\n' 'net.ipv4.ip_forward=1' >/etc/sysctl.d/99-ispsolutions-wireguard.conf
sysctl -w net.ipv4.ip_forward=1 >/dev/null
if command -v ufw >/dev/null 2>&1; then
  ufw allow ${hub.listenPort}/udp || true
fi
# Rename a live ${legacy} netdev. wg-quick down would drop every handshake.
if ip link show ${legacy} >/dev/null 2>&1 && ! ip link show ${iface} >/dev/null 2>&1; then
  ip link set dev ${legacy} name ${iface}
fi
systemctl disable "wg-quick@${legacy}" >/dev/null 2>&1 || true
rm -f /etc/wireguard/${legacy}.conf
systemctl enable "wg-quick@${iface}" >/dev/null 2>&1 || true
if ip link show ${iface} >/dev/null 2>&1; then
  # Reconcile peers without tearing the interface down. Unchanged MikroTiks keep their handshake.
  wg syncconf ${iface} <(wg-quick strip /etc/wireguard/${iface}.conf)
else
  wg-quick up ${iface}
fi
wg show ${iface}
${hubNatCommands(iface, hub.network)}
echo "UDP ${hub.listenPort} must be open on the VPS firewall. Re-running this script does not drop live peers."
`;
}

type TenantHubRow = {
  wg_public: string;
  wg_private_ref: string;
  wg_endpoint_host: string;
  wg_listen_port: number;
  wg_network: string;
  wg_address: string;
};

async function readTenantHub(sql: Sql, tenantId: string): Promise<TenantHubRow | null> {
  const [row] = await sql<TenantHubRow>`
    select wg_public, wg_private_ref, wg_endpoint_host, wg_listen_port, wg_network, wg_address
    from tenants where id = ${tenantId}`;
  return row ?? null;
}

export function wireguardServerPublicKey(tenantPublic: string, env: NodeJS.ProcessEnv = process.env) {
  return (env.WIREGUARD_SERVER_PUBLIC_KEY || "").trim() || tenantPublic;
}

export async function ensureTenantHub(sql: Sql, tenantId: string): Promise<WgHubPublic> {
  let row = await readTenantHub(sql, tenantId);
  if (!row) throw new Error("ISP not found");
  if (!row.wg_public || !row.wg_private_ref) {
    const keys = generateWireGuardKeypair();
    const address = row.wg_address || DEFAULT_HUB_ADDRESS;
    const network = row.wg_network || DEFAULT_HUB_NETWORK;
    const port = row.wg_listen_port || DEFAULT_LISTEN_PORT;
    await sql`update tenants set
      wg_public = ${keys.publicKey},
      wg_private_ref = ${keys.privateKeySealed},
      wg_address = ${address},
      wg_network = ${network},
      wg_listen_port = ${port}
      where id = ${tenantId}`;
    row = await readTenantHub(sql, tenantId);
    if (!row) throw new Error("ISP not found");
  }
  return {
    publicKey: wireguardServerPublicKey(row.wg_public),
    address: row.wg_address || DEFAULT_HUB_ADDRESS,
    network: row.wg_network || DEFAULT_HUB_NETWORK,
    listenPort: Number(row.wg_listen_port) || publicWgPort(),
    endpointHost: enrollEndpointHost(row.wg_endpoint_host || publicWgHost()),
    ready: Boolean(row.wg_public && enrollEndpointHost(row.wg_endpoint_host || publicWgHost())),
  };
}

export async function saveTenantHub(
  sql: Sql,
  tenantId: string,
  input: { endpointHost: string; listenPort?: number },
) {
  await ensureTenantHub(sql, tenantId);
  const parsed = normalizeWgEndpoint(input.endpointHost, input.listenPort);
  const host = enrollEndpointHost(parsed.host);
  await sql`update tenants set
    wg_endpoint_host = ${host},
    wg_listen_port = ${parsed.port}
    where id = ${tenantId}`;
  return ensureTenantHub(sql, tenantId);
}

export async function rotateTenantHub(sql: Sql, tenantId: string) {
  const keys = generateWireGuardKeypair();
  const current = await ensureTenantHub(sql, tenantId);
  await sql`update tenants set
    wg_public = ${keys.publicKey},
    wg_private_ref = ${keys.privateKeySealed}
    where id = ${tenantId}`;
  return { ...current, publicKey: keys.publicKey, ready: Boolean(current.endpointHost) };
}

export async function syncRouterWgPeer(
  sql: Sql,
  tenantId: string,
  router: {
    id: string;
    wg_public: string;
    wg_private_ref?: string;
    wg_address: string;
    wg_public_previous?: string;
  },
) {
  if (!router.wg_public) return;
  const address = router.wg_address.includes("/") ? router.wg_address : `${router.wg_address}/32`;
  const existing = await sql<{ id: string }>`
    select id from wireguard_peers where tenant_id = ${tenantId} and router_id = ${router.id}`;
  if (existing[0]) {
    await sql`update wireguard_peers set
      public_key = ${router.wg_public},
      private_key_sealed = ${router.wg_private_ref || ""},
      allowed_ips = ${address},
      address = ${address},
      status = 'pending'
      where id = ${existing[0].id}`;
  } else {
    await sql`insert into wireguard_peers
      (id, tenant_id, router_id, public_key, private_key_sealed, allowed_ips, address, listen_port, persistent_keepalive, status)
      values (
        ${nid("wgp")}, ${tenantId}, ${router.id}, ${router.wg_public}, ${router.wg_private_ref || ""},
        ${address}, ${address}, 13231, 25, 'pending'
      )`;
  }
  await applyHostPeer({ publicKey: router.wg_public, address });
  if (router.wg_public_previous && router.wg_public_previous !== router.wg_public) {
    await applyHostPeer({ publicKey: router.wg_public_previous, address });
  }
  await persistWantedHubPeersFromSql(sql).catch(() => 0);
}

export async function loadHubPeers(sql: Sql, tenantId: string): Promise<WgPeerConfig[]> {
  const rows = await sql<{
    name: string;
    public_key: string;
    previous_key: string;
    wg_address: string;
  }>`
    select r.name, r.wg_public as public_key, coalesce(r.wg_public_previous,'') as previous_key, r.wg_address
    from routers r
    where r.tenant_id = ${tenantId} and r.wg_public <> ''
    order by r.name`;
  const peers: WgPeerConfig[] = [];
  for (const r of rows) {
    const address = r.wg_address.includes("/") ? r.wg_address : `${r.wg_address}/32`;
    peers.push({ name: r.name, publicKey: r.public_key, address });
    if (r.previous_key && r.previous_key !== r.public_key) {
      peers.push({ name: `${r.name} previous`, publicKey: r.previous_key, address });
    }
  }
  return peers;
}

export async function renderServerConfig(sql: Sql, tenantId: string) {
  const row = await readTenantHub(sql, tenantId);
  if (!row?.wg_private_ref) await ensureTenantHub(sql, tenantId);
  const hubRow = (await readTenantHub(sql, tenantId))!;
  const hub: WgHubConfig = {
    publicKey: hubRow.wg_public,
    privateKey: open(hubRow.wg_private_ref),
    address: hubRow.wg_address || DEFAULT_HUB_ADDRESS,
    network: hubRow.wg_network || DEFAULT_HUB_NETWORK,
    listenPort: Number(hubRow.wg_listen_port) || DEFAULT_LISTEN_PORT,
    endpointHost: hubRow.wg_endpoint_host || "",
  };
  const peers = await loadHubPeers(sql, tenantId);
  return {
    hub: {
      publicKey: hub.publicKey,
      address: hub.address,
      network: hub.network,
      listenPort: hub.listenPort,
      endpointHost: hub.endpointHost,
      ready: Boolean(hub.publicKey && hub.endpointHost),
    },
    peers: peers.map((p) => ({ name: p.name, publicKey: p.publicKey, address: p.address })),
    conf: buildServerConf(hub, peers),
    install: buildServerInstallScript(hub, peers),
  };
}

export async function wgEnrollContext(
  sql: Sql,
  tenantId: string,
  router: {
    name: string;
    identity: string;
    token: string;
    wg_public: string;
    wg_private_ref: string;
    wg_address: string;
    id?: string;
    pullUrl?: string;
    wg_public_previous?: string;
  },
) {
  const hub = await ensureTenantHub(sql, tenantId);
  if (router.id) {
    await syncRouterWgPeer(sql, tenantId, {
      id: router.id,
      wg_public: router.wg_public,
      wg_private_ref: router.wg_private_ref,
      wg_address: router.wg_address,
      wg_public_previous: router.wg_public_previous,
    });
  }
  return {
    name: router.name,
    identity: router.identity,
    token: router.token,
    wgPublic: router.wg_public,
    wgPrivate: open(router.wg_private_ref),
    wgAddress: router.wg_address,
    serverPublic: hub.publicKey,
    endpointHost: hub.endpointHost,
    endpointPort: hub.listenPort,
    pullUrl: router.pullUrl,
    serverAddress: overlayIp(hub.address) || publicWgHubAddress(),
    routerId: router.id,
  };
}
