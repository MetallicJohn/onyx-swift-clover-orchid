# Deployment

## Grok / Vercel (platform)

The App Builder publishes this TanStack app to Vercel. `npm run build` uses the Nitro `vercel` preset and applies `migrations/` to `DATABASE_URL`.

## Self-host VPS (Ubuntu 24.04)

This is the path for an ISP that wants Gridline on its own server next to the WireGuard hub.

Copy the project onto the VPS, then:

```bash
git clone https://github.com/MetallicJohn/onyx-swift-clover-orchid.git /opt/gridline
sudo bash /opt/gridline/deploy/vps/install.sh --domain ops.yourisp.co.ke --email you@yourisp.co.ke
```

That install:

- Docker Compose: `web`, `postgres:16`, `caddy:2`, `mongo:7`, `genieacs` (CWMP 7547, FS 7567; NBI internal), `freeradius` (UDP 1812/1813)
- Writes `/opt/gridline/gridline.env` (secrets, never commit this file)
- Opens 80/tcp, 443/tcp, 51820/udp, 7547/tcp, 7567/tcp, 1812/udp, 1813/udp
- Installs WireGuard tools on the **host** (kernel module — not inside the web container)

Health: `GET /api/v1/health`

After DNS points at the VPS:

1. Sign in at `https://<domain>/login`
2. Settings → Public URL = `https://<domain>`
3. Settings → Network: hub endpoint = VPS public IP or hostname, download `wg-gridline.conf`, `wg-quick up wg-gridline`
4. Routers → Copy script onto each MikroTik

Do not put MikroTik or FreeRADIUS inside the web container. GenieACS runs **beside** it (own container + Mongo).

VPS needs about 4 GB RAM once GenieACS is included.
