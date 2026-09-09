# RADIUS

This SaaS is **not** a RADIUS server. FreeRADIUS stays a separate process. Gridline is the source of truth.

```
MikroTik NAS  --UDP 1812/1813-->  FreeRADIUS (operator host)
                                      |
                                      | HTTPS rlm_rest
                                      v
                                  Gridline
                     authorize / authenticate / accounting
                     radius_accounts + services + packages
```

## Live path (recommended)

FreeRADIUS `rlm_rest` calls:

- `POST /api/v1/radius/authorize/{slug}`
- `POST /api/v1/radius/authenticate/{slug}` (optional; PAP/CHAP can use the cleartext from authorize)
- `POST /api/v1/radius/accounting/{slug}`

Auth: HTTP Basic (`username=gridline`, password = tenant RADIUS API key), `Authorization: Bearer <key>`, or `X-Radius-Key`.

Authorize returns rlm_rest JSON:

- Accept: `control:Cleartext-Password`, `Mikrotik-Rate-Limit`, `Framed-IP-Address`, `Session-Timeout`, `Acct-Interim-Interval`
- Reject (HTTP 200): `control:Auth-Type = Reject` for unknown, suspended, expired, or bundle-exhausted users

Copy the REST module, site, and `clients.conf` from **RADIUS** in the console. Rotate the key there; it is sealed at rest.

## Users file (offline)

`Copy users file` still exports `raddb/users`. Suspended users are `Auth-Type := Reject`. This does **not** pick up a suspend until you re-export.

## Accounting

rlm_rest JSON (nested `{ value: [...] }`) and the simple `{ username, bytes_in, bytes_out, session_id }` body are both accepted. `Acct-Status-Type = Stop` closes the session. Octets + gigawords update `bundle_used_mb`; hitting the package cap suspends immediately.

Lookup is `radius_accounts.username` first, then `services.username`.

## Disconnect

Disconnect still queues `pppoe.disable` / `hotspot.disable` on the MikroTik agent (kick + disable secret). That is CoA-equivalent on RouterOS. A `radclient` CoA adapter is not shipped.

## Not in this product

- FreeRADIUS daemon in the web container
- UDP 1812/1813 on Gridline
- Shared SQL views across tenants (would leak). Per-ISP FreeRADIUS + REST is the multi-tenant path.

**Status:** REST adapter + users export + disconnect **implemented and tested**. FreeRADIUS **daemon** remains operator-run.
