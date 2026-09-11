# RADIUS

This SaaS is **not** a RADIUS server. FreeRADIUS is a **sidecar** on the VPS. ISP Solutions is the source of truth.

```
MikroTik NAS  --UDP 1812/1813-->  FreeRADIUS (compose)
                                      |
                                      | HTTP rlm_rest
                                      v
                               ISP Solutions
                     authorize / authenticate / accounting / bootstrap
                     radius_accounts + services + packages
```

## VPS (recommended)

`deploy/vps` starts `freeradius/freeradius-server:3.2.10`. The container waits for ISP Solutions, then:

`GET /api/v1/radius/bootstrap/{slug}` (HTTP Basic, password = tenant RADIUS API key)

That writes `mods-available/rest`, `sites-enabled/gridline`, and `clients.conf` (WireGuard overlay + RFC1918 + each router NAS).

1. Sign in → **RADIUS → Copy VPS env** into `/opt/gridline/gridline.env`
2. `docker compose -f deploy/vps/docker-compose.yml up -d freeradius`
3. Point MikroTik at the VPS **UDP 1812/1813** with the NAS secret (MikroTik snippet on the same page)

## REST (also used by an external FreeRADIUS)

- `POST /api/v1/radius/authorize/{slug}`
- `POST /api/v1/radius/authenticate/{slug}`
- `POST /api/v1/radius/accounting/{slug}`
- `GET  /api/v1/radius/bootstrap/{slug}`

Auth: HTTP Basic (`username=gridline`, password = API key), Bearer, or `X-Radius-Key`.

Authorize returns rlm_rest JSON (`control:Cleartext-Password`, `Mikrotik-Group` = PCQ package profile, framed IP, session timeout). It does **not** send `Mikrotik-Rate-Limit` (that would create a dynamic simple queue per session). Rejects unknown, suspended, expired, and bundle-exhausted users (HTTP 200 + Auth-Type Reject).

## Users file (offline)

`Copy users file` still exports `raddb/users`. It does **not** pick up a suspend until you re-export. Prefer REST.

## Disconnect

Queues `pppoe.disable` / `hotspot.disable` on the MikroTik agent. A `radclient` CoA packet is not shipped.

**Status:** REST adapter + bootstrap + compose daemon **implemented**. Live UDP handshake needs the VPS container + a NAS.
