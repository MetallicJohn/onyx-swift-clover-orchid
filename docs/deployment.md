# Deployment

## Grok / Vercel (platform)

The App Builder publishes this TanStack app to Vercel. `npm run build` uses the Nitro `vercel` preset and applies `migrations/` to `DATABASE_URL`. That preview is **not** the production ISP VPS.

## Production VPS (Ubuntu 24.04)

**Do not update production from Grok or from an untested branch.**

```
GitHub push
  → CI (typecheck, lint, tests, migrations)
  → backup Postgres
  → VPS pull of that commit
  → rebuild + migrate
  → health check
  → rollback to previous SHA if health fails
```

Secrets in `/opt/ispsolutions/ispsolutions.env` are never overwritten.

### First time

```bash
git clone https://github.com/MetallicJohn/onyx-swift-clover-orchid.git /opt/ispsolutions
sudo bash /opt/ispsolutions/deploy/vps/install.sh --domain ops.yourisp.co.ke --email you@yourisp.co.ke
```

That install:

- Docker Compose: `web`, `postgres:16`, `caddy:2`, `mongo:7`, `genieacs` (CWMP 7547, FS 7567; NBI internal), `freeradius` (UDP 1812/1813)
- Writes `/opt/ispsolutions/ispsolutions.env` (secrets, never commit this file)
- Opens 80/tcp, 443/tcp, 51820/udp, 7547/tcp, 7567/tcp, 1812/udp, 1813/udp
- Installs WireGuard tools on the **host** (kernel module — not inside the web container)
- Enables a systemd timer that **fetches** GitHub every few minutes. It does **not** rebuild unless `ISPSOLUTIONS_AUTO_DEPLOY=1`.

### Deploy a verified commit

1. Push to GitHub and wait until **CI on `main` is green**.
2. On the VPS:

```bash
sudo bash /opt/ispsolutions/deploy/vps/backup.sh
sudo bash /opt/ispsolutions/deploy/vps/update.sh --apply
```

`--apply` backs up again, pulls `origin/main`, rebuilds, waits for `/api/v1/health`, and rolls the code back to the previous SHA if health fails. Database dumps are kept under `/opt/ispsolutions/backups/` (14 days). Restore only if you need to: `sudo bash deploy/vps/restore.sh <dump.sql.gz>`.

`--force` rebuilds the same SHA (for example after editing `ispsolutions.env`).

Health: `GET /api/v1/health` (includes `sha` when the image was built from git). Readiness: `GET /api/v1/ready`.

### GitHub Actions SSH (optional)

The `publish-vps` job runs **only** after `checks` pass on `main` (never on pull requests). It SSHs and runs `update.sh --from-ci` on the VPS.

| Secret | Required | Purpose |
|---|---|---|
| `VPS_HOST` | yes for SSH | VPS address |
| `VPS_SSH_KEY` | yes for SSH | Deploy key (private) |
| `VPS_USER` | no | SSH user, default `root` |
| `VPS_PATH` | no | Install dir, default `/opt/ispsolutions` |
| `VPS_HEALTH_URL` | no | Public `https://<domain>/api/v1/health` |

If `VPS_HOST` or `VPS_SSH_KEY` is missing, CI still tests the commit and prints the manual `--apply` command. It does not skip tests.

Repo: Settings → Secrets and variables → Actions.

### After DNS points at the VPS

1. Sign in at `https://<domain>/login`
2. Settings → Public URL = `https://<domain>`
3. Settings → Network: hub endpoint = VPS public IP or hostname, download `wg-ispsolutions.conf` or run the install script (`wg-quick up wg-ispsolutions`).
4. Routers → Add router → paste the **bootstrap** script on the MikroTik (internet check, then HTTPS fetch of `bootstrap.rsc` with `check-certificate=no`). Generate bootstrap again if the token expired. Copy enroll remains for factory-reset boxes that already have a peer.

The fetch URL is HTTPS. MikroTik CA verification is off because many boards ship without a certificate store.

Do not put MikroTik or FreeRADIUS inside the web container. GenieACS runs **beside** it (own container + Mongo). Redis, workers, and the traffic collector run beside web on the same compose file; they can move later. See [distributed.md](distributed.md).

VPS needs about 4 GB RAM once GenieACS is included.
