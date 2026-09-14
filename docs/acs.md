# ACS / GenieACS

GenieACS is a **separate process** (CWMP :7547, NBI :7557, FS :7567, UI on `acs.<domain>`). ISP Solutions does not speak TR-069 itself.

## What is real

- Docker Compose starts MongoDB 7 + `drumsergio/genieacs:1.2.16.0` beside the web app
- Per-ISP ACS URL, username, password, and connection-request login (sealed). Unique public CWMP port via cwmp-edge
- CPE → ACS HTTP digest auth: GenieACS `cwmp.auth` = `AUTH(USERNAME, EXT("gridline", "passwordFor", USERNAME))`. The extension looks up the sealed secret on the private `/api/internal/acs-auth` endpoint. Unknown or disabled ISPs are rejected. Informs are not audited
- ACS → CPE connection-request auth uses the device's stored connection-request username and password
- Optional HTTPS ACS URLs (`acs_tls`). Default HTTP so existing OLT profiles keep working. Optional TLS on cwmp-edge
- URL lock preset: on inform, rewrite `ManagementServer.URL` (TR-098 and TR-181) and connection-request credentials for this ISP
- ISP Solutions NBI adapter: list devices, post `reboot` / `setParameterValues` (SSID) / `refreshObject` with `connection_request`
- Inventory sync from `GET /devices/` (filtered by this ISP's ACS username)
- Tasks stay `queued` until NBI is configured, then `sent` or `error`
- NBI, Mongo, and `/api/internal/acs-auth` are not published on the host

## What is not proven here

- A live TR-069 session from a physical ONT (needs the daemon on a VPS and a CPE)
- Firmware file server workflows
- STUN / XMPP connection request for CGNAT

Set NBI URL in **GenieACS** (default `http://genieacs:7557` on the VPS compose network). Then **Sync from ACS**.
