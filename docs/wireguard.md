# WireGuard

Hub-and-spoke overlay `10.200.0.0/24`. The ISP VPS is `10.200.0.1`; each router is `10.200.0.N/32`. RouterOS API on TCP 8728 accepts only that overlay.

## Hub (server)

Settings → Network:

- One X25519 keypair per ISP (`tenants.wg_public` / sealed `wg_private_ref`). Public half is `WIREGUARD_SERVER_PUBLIC_KEY` when set.
- Public endpoint hostname **`wg.ispsolutions.co.ke`** (never the HTTPS apex `ispsolutions.co.ke`) + UDP 51820
- Download `wg-ispsolutions.conf` (`wg-quick`) and a root install script for the VPS. A host still named `wg-gridline` is renamed in place to `wg-ispsolutions` (the install script does not `wg-quick down` it). Re-running the install script hot-reloads with `wg syncconf` and does not drop MikroTiks that are already up. `SaveConfig = false` so a shutdown does not rewrite the managed file.

`[Peer]` stanzas are built from live routers, including a previous public key during rotation until the new handshake is verified. Client private keys are not written into the server file.

The MikroTik peer uses `allowed-address=10.200.0.1/32` (hub only) and `endpoint-address=wg.ispsolutions.co.ke`. Cloudflare stays DNS-only. Do not orange-cloud the WireGuard hostname.

## Client (MikroTik)

Routers generate named RouterOS v7 scripts from one engine:

- **Generate Enrollment Script** — new router
- **Repair Connection** — existing keys, idempotent reconcile
- **Rotate WireGuard** — new keypair; hub keeps the old peer until the new handshake is live
- **Rotate API Credentials** — new password; previous login stays valid until the new one succeeds
- **Regenerate Agent** — pull script + scheduler only

Paste in New Terminal or Download `.rsc`. Scripts use `check-certificate=no`. No MikroTik CA. Overlay API user is derived from the address (`10.200.0.4` → `10200004`).

Do not mark a router Online just because a script was generated. Ordinary edits do not rotate keys.

## Keys

`crypto.generateKeyPairSync('x25519')`. Public key is 32 raw bytes, standard base64. Private keys are sealed (`enc:v1:`) in `routers.wg_private_ref` / `wireguard_peers.private_key_sealed` / `tenants.wg_private_ref`. They appear only in the enroll script and the downloaded hub conf — never in list APIs.

`wg_status` starts `pending`. `connected` is set after handshake + API + agent evidence.

A live kernel handshake on a NIC is not run in CI.

Do not treat `Buffer.from(name+token)` as a key — that path was removed.
