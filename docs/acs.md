# ACS / GenieACS

GenieACS is a **separate process** (CWMP :7547, NBI :7557, FS :7567, UI on `acs.<domain>`). Gridline does not speak TR-069 itself.

## What is real

- Docker Compose starts MongoDB 7 + `drumsergio/genieacs:1.2.16.0` beside the web app
- Gridline NBI adapter: list devices, post `reboot` / `setParameterValues` (SSID) / `refreshObject` with `connection_request`
- Inventory sync from `GET /devices/`
- Tasks stay `queued` until NBI is configured, then `sent` or `error`
- CPE ACS URL on the VPS: `http://<host>:7547/`

## What is not proven here

- A live TR-069 session from a physical ONT (needs the daemon on a VPS and a CPE)
- Firmware file server workflows

Set NBI URL in **GenieACS** (default `http://genieacs:7557` on the VPS compose network). Then **Sync from ACS**.
