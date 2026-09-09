# Network architecture

```
SaaS (TanStack)
  → Operator VPS WireGuard hub (10.200.0.1/24, UDP 51820)
    → Overlay 10.200.0.0/24
      → Network agent (RouterOS scheduler + /api/agent/*)
        → MikroTik RouterOS v7 REST / script
```

The hub conf is generated in Settings → Network (`wg-gridline.conf`). Routers initiate with persistent keepalive so they work behind NAT. Do not expose Winbox/API on WAN.

Future vendors implement `RouterProvider` (MikroTik is first). FreeRADIUS and GenieACS are **separate processes**, not in the web container.

IPAM: `ip_pools` today; allocation states (AVAILABLE/RESERVED/ASSIGNED/…) land in a later IPAM milestone. Design `ip_addresses` for IPv6 when implemented.

