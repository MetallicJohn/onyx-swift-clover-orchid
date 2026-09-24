# Standalone WireGuard hub (upgraded)

Hub-and-spoke VPN for a VPS that is **not** already running ISP Solutions.
The application overlay stays `10.200.0.0/24` on `wg-ispsolutions`. These
scripts use a different network on purpose so they cannot be pasted onto that
host by mistake.

- Tunnel: `10.10.0.0/24`
- Hub: `10.10.0.1` on `wg0`, UDP `51820`
- Spokes: lowest free address from `.2` to `.254` (holes are reused)
- Each spoke gets its own pre-shared key
- Spokes can reach each other's tunnel addresses through the hub

## What changed from the first draft

- Peer names are restricted, so a name cannot break the config or the registry.
- Registry updates no longer use `sed` with `/`. WireGuard keys contain `/` and `+`, which split that command.
- The next address is the lowest free host, not "highest + 1", and it stops at `.254`.
- Adding a peer rolls the registry back if `wg syncconf` fails.
- Re-importing the RouterOS script removes the previous `wg-vps` interface first, so a second import does not stack duplicate interfaces, addresses, and firewall rules.
- The script is RouterOS v7 import-safe: no `:local`, no line continuations.
- The spoke does not pin `listen-port=13231`, so it will not collide with another service.
- `vps-setup.sh` allows forwarded traffic on `wg0` when ufw is installed. Without that, ufw's default FORWARD policy drops spoke-to-spoke packets.
- Re-running setup hot-reloads. It does not restart the interface when `wg0` is already up.
- Key rotation still replaces the hub peer immediately. Import the new script on that MikroTik before you depend on the tunnel. There is no second key on the hub, because WireGuard will not route one `/32` to two peers at once.

## Bootstrap

```bash
chmod +x vps-setup.sh wg-manager.sh
sudo ./vps-setup.sh
```

Then set the endpoint (public IP or DNS that resolves straight to this VPS, not through an HTTP proxy):

```bash
sudo VPS_ENDPOINT=203.0.113.10 ./wg-manager.sh add branch1
```

Import `/etc/wireguard/peers/branch1/mikrotik-branch1.rsc` on the router:

```
/import file-name=mikrotik-branch1.rsc
```

`/interface wireguard peers print` should show a recent handshake.

## Rotate and remove

```bash
sudo VPS_ENDPOINT=203.0.113.10 ./wg-manager.sh edit branch1 --regen-keys
sudo ./wg-manager.sh remove branch1
sudo ./wg-manager.sh list
sudo ./wg-manager.sh show branch1
```

`show` prints the private key and the pre-shared key. Treat that output as secret.
Removed peers are moved to `peers/<name>.removed.<timestamp>/`, mode `700`.
