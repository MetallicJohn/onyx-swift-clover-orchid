# MikroTik agent

Protocol (token = enroll_token):

- `GET /api/agent/pull?token=` JSON commands (REST + RouterOS script)
- `GET /api/agent/script?token=` `.rsc` for `/import`
- `POST /api/agent/ack`
- `GET|POST /api/agent/heartbeat`

Command statuses: `proposed → queued → sent → acked|failed`. Service upserts auto-queue. `raw.script` and reboot start as **proposed** and need Approve before the agent can pull them.

Agent scripts are RouterOS v7 (`:local`, `:if`, `find where`). HTTPS fetches use `check-certificate=no` so boxes without a CA store can still pull. The trusted channel is WireGuard, not the MikroTik certificate store. RouterOS API is TCP 8728 on the overlay (`ispsolutions-agent`), never API-SSL, never WAN.

## Bootstrap provisioning

First install uses a **provisioning token** (`prv_…`), not the enroll token:

1. Admin adds the router (or clicks Generate bootstrap).
2. Paste the short script in New Terminal. It pings 1.1.1.1 / 8.8.8.8, then:
   `GET /api/vpn/routers/{token}/bootstrap.rsc`
3. The file is generated from templates (WireGuard overlay + API user `ispsolutions` + agent scheduler + assigned IP pools) and validated before release.
4. Tokens are SHA-256 hashed at rest, expire (default 72 hours), and can be revoked.

The enroll token remains the agent pull credential. `wg_status=connected` is set only after heartbeat or pull.

If the public CA is missing on RouterOS, install it — do not disable certificate checks.

Bandwidth is **PCQ per package**, not a simple queue per customer:

- `package.sync` (on package save) and each PPPoE/hotspot/static upsert create `isp-pcq-up-{n}M` / `isp-pcq-down-{n}M` queue types, a PPP + hotspot profile `isp-{package}`, mangle marks, and queue trees.
- RADIUS `Mikrotik-Group` is that profile name. No per-user `Mikrotik-Rate-Limit`.
- Static IPs join the package address-list. Leftover `static-*` simple queues are removed.
- Assigned IP pools are pushed with `pool.push`.
