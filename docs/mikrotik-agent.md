# MikroTik agent

Protocol (token = enroll_token):

- `GET /api/agent/pull?token=` JSON commands (REST + RouterOS script)
- `GET /api/agent/script?token=` `.rsc` for `/import`
- `POST /api/agent/ack`
- `GET|POST /api/agent/heartbeat`

Command statuses: `proposed → queued → sent → acked|failed`. Service upserts auto-queue. `raw.script` and reboot start as **proposed** and need Approve before the agent can pull them.

Agent scripts are RouterOS v7 (`:local`, `:if`, `find where`).

Bandwidth is **PCQ per package**, not a simple queue per customer:

- `package.sync` (on package save) and each PPPoE/hotspot/static upsert create `isp-pcq-up-{n}M` / `isp-pcq-down-{n}M` queue types, a PPP + hotspot profile `isp-{package}`, mangle marks, and queue trees.
- RADIUS `Mikrotik-Group` is that profile name. No per-user `Mikrotik-Rate-Limit`.
- Static IPs join the package address-list. Leftover `static-*` simple queues are removed.
