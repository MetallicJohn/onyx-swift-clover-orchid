# WireGuard

Hub-and-spoke overlay `10.200.0.0/24`. The ISP VPS is `10.200.0.1`; each router is `10.200.0.N/32`. Winbox, API, and www-ssl on the router accept only that overlay.

## Hub (server)

Settings → Network:

- One X25519 keypair per ISP (`tenants.wg_public` / sealed `wg_private_ref`)
- Public endpoint hostname **`wg.ispsolutions.co.ke`** (never the HTTPS apex `ispsolutions.co.ke`) + UDP 51820
- Download `wg-ispsolutions.conf` (`wg-quick`) and a root install script for the VPS. A previous overlay name on the host is brought down and replaced.

`[Peer]` stanzas are built from live routers. Client private keys are not written into the server file. Rotate hub keys only if the VPS key leaked — then reinstall the server conf and re-copy every enroll script.

The MikroTik peer uses `allowed-address=10.200.0.1/32` (hub only) and `endpoint-address=wg.ispsolutions.co.ke`. Cloudflare stays DNS-only. Do not orange-cloud the WireGuard hostname.

## Client (MikroTik)

Routers → Copy script emits RouterOS v7 that:

- Sets `wg-ispsolutions` **private-key** (router keypair; public half stored on `routers.wg_public`). Re-paste on older boxes also renames a previous overlay.
- Adds a peer with the **hub public key**, `endpoint-address` / `endpoint-port`, allowed-address `10.200.0.0/24`, keepalive 25s
- Assigns the overlay address and locks API/Winbox to `10.200.0.0/24`

Without an endpoint the script still applies, but the handshake cannot start (NAT). Re-copy after saving the hub.

## Keys

`crypto.generateKeyPairSync('x25519')`. Public key is 32 raw bytes, standard base64. Private keys are sealed (`enc:v1:`) in `routers.wg_private_ref` / `wireguard_peers.private_key_sealed` / `tenants.wg_private_ref`. They appear only in the enroll script and the downloaded hub conf — never in list APIs.

`wg_status` starts `pending`. `connected` is set after agent heartbeat/pull.

A live kernel handshake on a NIC is not run in CI.

Do not treat `Buffer.from(name+token)` as a key — that path was removed.
