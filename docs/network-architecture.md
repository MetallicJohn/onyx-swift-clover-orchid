# Network architecture

```
SaaS (TanStack)
  → WireGuard overlay (10.200.0.0/24)
    → Network agent (RouterOS scheduler + /api/agent/*)
      → MikroTik RouterOS v7 REST / script
```

Do not expose Winbox/API on WAN.

Future vendors implement `RouterProvider` (MikroTik is first). FreeRADIUS and GenieACS are **separate processes**, not in the web container.

IPAM: `ip_pools` today; allocation states (AVAILABLE/RESERVED/ASSIGNED/…) land in a later IPAM milestone. Design `ip_addresses` for IPv6 when implemented.
