# MikroTik agent

Protocol (token = enroll_token):

- `GET /api/agent/pull?token=` JSON commands (REST + RouterOS script)
- `GET /api/agent/script?token=` `.rsc` for `/import`
- `POST /api/agent/ack`
- `GET|POST /api/agent/heartbeat`

Command statuses: `queued → sent → acked|failed`. Service upserts auto-queue. Destructive/raw scripts should move through propose/approve later; columns `requested_by`, `approved_by`, `result` exist.

Agent scripts are RouterOS v7 (`:local`, `:if`, `find where`).
