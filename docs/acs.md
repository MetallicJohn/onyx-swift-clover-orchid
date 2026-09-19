# ACS / GenieACS

GenieACS is a **separate process** (CWMP :7547, NBI :7557, FS :7567, UI on `acs.<domain>`). ISP Solutions does not speak TR-069 itself.

## What is real

- Docker Compose starts MongoDB 7 + `drumsergio/genieacs:1.2.16.0` beside the web app
- Per-ISP ACS URL, username, password, and connection-request login (sealed). Unique public CWMP port via cwmp-edge
- CPE → ACS HTTP digest auth: GenieACS `cwmp.auth` = `AUTH(USERNAME, EXT("ispsolutions", "passwordFor", USERNAME))`. The extension looks up the sealed secret on the private `/api/internal/acs-auth` endpoint. Unknown or disabled ISPs are rejected. Informs are not audited
- ACS → CPE connection-request auth uses the device's stored connection-request username and password. Basic auth is allowed (`cwmp.connectionRequestAllowBasicAuth`) because many ONUs do not speak digest on connection request
- Optional HTTPS ACS URLs (`acs_tls`). Default HTTP so existing OLT profiles keep working. Optional TLS on cwmp-edge
- URL lock preset: on inform, rewrite `ManagementServer.URL` (TR-098 and TR-181) and connection-request credentials for this ISP
- Service provision preset: on inform, write this assigned service's PPPoE WAN username/password and Wi-Fi SSID/password (both TR-098 and TR-181). Unassigned devices and empty fields are skipped. Default on (`acs_provision_service`)
- ISP Solutions NBI adapter: list devices, post `reboot` / `setParameterValues` (SSID) / `refreshObject` with `connection_request`
- Inventory sync from `GET /devices/` (filtered by this ISP's ACS username)
- Tasks stay `queued` until NBI is configured, then `sent` or `error`
- NBI, Mongo, and `/api/internal/acs-auth` are not published on the host

## CWMP settings (GenieACS)

These are written on first boot (`genieacs-init` into Mongo) and can be re-applied from **System settings → Apply CWMP settings** or **Devices → NBI**:

| Key | Value |
| --- | --- |
| `cwmp.auth` | `AUTH(USERNAME, EXT("ispsolutions", "passwordFor", USERNAME))` |
| `cwmp.connectionRequestAuth` | `AUTH(username, password)` |
| `cwmp.connectionRequestAllowBasicAuth` | `true` |
| `cwmp.debug` | `false` |
| Preset `ispsolutions-lock-url` | Rewrite ACS URL + connection-request login on inform |
| Preset `ispsolutions-service` | Write assigned WAN/SSID/Wi-Fi on inform |

GenieACS 1.2 **NBI has no PUT /config**. Digest login is not written through port 7557. Apply CWMP:

1. PUTs provisions and presets on NBI (that API exists)
2. PUTs `cwmp.*` on the GenieACS UI (`/api/config/:id` with `{ "value": "…" }` and a local-admin JWT) when `GENIEACS_UI_JWT_SECRET` is set
3. GETs `/config/` and treats matching sidecar values as already applied

If UI write is unavailable, digest from `genieacs-init` stays in effect. That is expected on a single VPS after `update.sh`.

GenieACS CWMP/NBI/FS/UI each run **one worker**. The image default (`0` = one process per CPU) SIGABRTs a pile of child processes on typical VPS sizes, and NBI never binds 7557. After recreate, `http://genieacs:7557` is the private NBI URL the console should save.

Set the ACS public host (VPS IP or hostname) in System settings, or `ACS_PUBLIC_HOST` in `ispsolutions.env`. Each ISP then gets `http://<host>:<port>/`.

## What is not proven here

- A live TR-069 session from a physical ONT (needs the daemon on a VPS and a CPE)
- Firmware file server workflows
- STUN / XMPP connection request for CGNAT

Set NBI URL in **GenieACS** (default `http://genieacs:7557` on the VPS compose network, or `GENIEACS_NBI_URL` on a remote NBI). Then **Sync from ACS**. Moving GenieACS+Mongo later is an env change: [distributed.md](distributed.md).

## Device management

The **Devices** page (`/app/acs`) lists CPE/ONU inventory from `cpe_devices` (synced from NBI when configured). Staff can add a device from GenieACS, enter one manually as unconfirmed, or wait for the next Inform. Assignment is one device to one billed service. After assign, WAN PPPoE (PPPoE services) plus SSID and Wi-Fi password from that service are written on Inform. Writes go through `acs_tasks` and are not marked successful until the device reports the change. Optical values come from the vendor parameter profile; missing paths are shown as not exposed. Firmware upgrade is not offered until a file server is configured.
