# MikroTik agent

Protocol (token = enroll_token):

- `GET /api/agent/pull?token=` JSON commands (REST + RouterOS script)
- `GET /api/agent/script?token=` `.rsc` for `/import`
- `POST /api/agent/ack`
- `GET|POST /api/agent/heartbeat`

Command statuses: `proposed → queued → sent → acked|failed`. Service upserts auto-queue. `raw.script` and reboot start as **proposed** and need Approve before the agent can pull them.

Agent scripts are RouterOS v7 (`:local`, `:if`, `find where`).
