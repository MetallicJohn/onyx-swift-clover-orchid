# Gridline

ISP operations console (multi-tenant SaaS): customers, packages, billing, M-Pesa, RADIUS, MikroTik agent, WireGuard hub.

## Publish to a VPS (Ubuntu 24.04)

Point your domain A record at the server, then:

```bash
git clone https://github.com/MetallicJohn/onyx-swift-clover-orchid.git /opt/gridline
sudo bash /opt/gridline/deploy/vps/install.sh --domain ops.yourisp.co.ke --email you@yourisp.co.ke
```

That starts Caddy (HTTPS), Postgres, Gridline, MongoDB, and GenieACS. WireGuard stays on the host kernel (UDP 51820). Use a VPS with about 4 GB RAM.

After DNS and TLS:

1. Sign in at `https://<domain>/login`
2. Settings → Public URL
3. Settings → Network: hub endpoint, download `wg-gridline.conf`, `wg-quick up wg-gridline`
4. Routers → Copy script onto each MikroTik

Health: `https://<domain>/api/v1/health`

See [docs/deployment.md](docs/deployment.md).
