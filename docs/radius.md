# RADIUS

This SaaS is **not** a RADIUS server.

```
SaaS radius_accounts (desired state)
  → FreeRADIUS (future adapter / SQL or REST)
    → MikroTik NAS
      → subscriber
```

`radius_accounts` holds username, password, framed IP, group, enabled. Session rows are accounting snapshots. CoA/disconnect will call FreeRADIUS; until that adapter ships, disconnect is a MikroTik agent command (`pppoe.disable` kicks `/ppp active`).

**Status:** desired-state store **implemented**; FreeRADIUS process integration **architecture only**.
