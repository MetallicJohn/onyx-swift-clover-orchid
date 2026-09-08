# RADIUS

This SaaS is **not** a RADIUS server.

```
SaaS radius_accounts (desired state + Mikrotik-Rate-Limit)
  → FreeRADIUS (users file export or SQL view)
    → MikroTik NAS
      → subscriber
```

Disconnect queues `pppoe.disable` / `hotspot.disable` on the agent (kick active session). That is CoA-equivalent on RouterOS until a FreeRADIUS `radclient` adapter exists.

List APIs return password **hints** only. Full secrets appear only on FreeRADIUS export, which requires `radius.manage`.

**Status:** desired-state + export + disconnect **implemented and tested**. FreeRADIUS daemon **architecture only**.
