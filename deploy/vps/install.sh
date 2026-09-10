#!/bin/bash
# ISP Solutions Ubuntu 24.04 publisher. Run from the repo (or copy this tree first):
#   sudo bash deploy/vps/install.sh --domain ops.yourisp.co.ke --email you@yourisp.co.ke
set -euo pipefail

DOMAIN=""
EMAIL=""
INSTALL_DIR="/opt/gridline"
GIT_URL="${GRIDLINE_GIT_URL:-https://github.com/MetallicJohn/onyx-swift-clover-orchid.git}"

usage() {
  echo "Usage: sudo bash deploy/vps/install.sh --domain ops.yourisp.co.ke --email you@yourisp.co.ke"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown flag $1"; usage ;;
  esac
done

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  usage
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi
if ! [[ "$DOMAIN" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
  echo "Domain looks invalid: $DOMAIN" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[gridline] installing Docker, git, and WireGuard"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ufw wireguard rsync
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

if [[ "$REPO_ROOT" != "$INSTALL_DIR" ]]; then
  echo "[gridline] publishing checkout to $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  if [[ ! -d "$INSTALL_DIR/.git" ]]; then
    if [[ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
      git clone "$GIT_URL" "$INSTALL_DIR"
    else
      rsync -a \
        --exclude node_modules \
        --exclude .output \
        --exclude .vercel \
        --exclude .git \
        --exclude gridline.env \
        "$REPO_ROOT/" "$INSTALL_DIR/"
    fi
  fi
fi
cd "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/deploy/vps/update.sh" "$INSTALL_DIR/deploy/vps/entrypoint.sh" 2>/dev/null || true

ENV_FILE="$INSTALL_DIR/gridline.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[gridline] writing $ENV_FILE"
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  APP_SECRET="$(openssl rand -hex 32)"
  cat >"$ENV_FILE" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
GRIDLINE_DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL
POSTGRES_USER=gridline
POSTGRES_DB=gridline
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgres://gridline:${POSTGRES_PASSWORD}@postgres:5432/gridline
APP_SECRET=$APP_SECRET
BETTER_AUTH_SECRET=$APP_SECRET
BETTER_AUTH_URL=https://$DOMAIN
BETTER_AUTH_TRUSTED_ORIGINS=https://$DOMAIN,https://www.$DOMAIN
GENIEACS_NBI_URL=http://genieacs:7557
GENIEACS_UI_JWT_SECRET=$(openssl rand -hex 32)
GRIDLINE_URL=http://web:3000
GRIDLINE_INTERNAL_URL=http://web:3000
GRIDLINE_SLUG=
RADIUS_API_KEY=
RADIUS_NAS_SECRET=$(openssl rand -hex 16)
EOF
  chmod 600 "$ENV_FILE"
else
  echo "[gridline] keeping existing $ENV_FILE"
  if ! grep -q '^GRIDLINE_DOMAIN=' "$ENV_FILE"; then
    echo "GRIDLINE_DOMAIN=$DOMAIN" >>"$ENV_FILE"
  fi
  if ! grep -q '^ACME_EMAIL=' "$ENV_FILE"; then
    echo "ACME_EMAIL=$EMAIL" >>"$ENV_FILE"
  fi
  if ! grep -q '^GENIEACS_NBI_URL=' "$ENV_FILE"; then
    echo "GENIEACS_NBI_URL=http://genieacs:7557" >>"$ENV_FILE"
  fi
  if ! grep -q '^GENIEACS_UI_JWT_SECRET=' "$ENV_FILE"; then
    echo "GENIEACS_UI_JWT_SECRET=$(openssl rand -hex 32)" >>"$ENV_FILE"
  fi
  if ! grep -q '^GRIDLINE_URL=' "$ENV_FILE"; then
    echo "GRIDLINE_URL=http://web:3000" >>"$ENV_FILE"
    echo "GRIDLINE_INTERNAL_URL=http://web:3000" >>"$ENV_FILE"
    echo "GRIDLINE_SLUG=" >>"$ENV_FILE"
    echo "RADIUS_API_KEY=" >>"$ENV_FILE"
    echo "RADIUS_NAS_SECRET=$(openssl rand -hex 16)" >>"$ENV_FILE"
  fi
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow 51820/udp || true
  ufw allow 7547/tcp || true
  ufw allow 7567/tcp || true
  ufw allow 1812/udp || true
  ufw allow 1813/udp || true
  ufw --force enable || true
fi

echo "[gridline] building and starting containers (first build takes several minutes)"
INSTALL_DIR="$INSTALL_DIR" bash "$INSTALL_DIR/deploy/vps/update.sh" --force

echo
echo "ISP Solutions is publishing at https://$DOMAIN"
echo "Point DNS A/AAAA for $DOMAIN at this VPS, then wait for TLS."
echo "After this, each GitHub push is pulled and rebuilt on the VPS within a few minutes."
echo
echo "Next:"
echo "  1. Sign in at https://$DOMAIN/login (signup creates the first ISP owner)."
echo "  2. Settings → Public URL = https://$DOMAIN"
echo "  3. Settings → Network: hub endpoint = this VPS public IP or $DOMAIN, then copy wg-gridline.conf to /etc/wireguard/ and wg-quick up wg-gridline"
echo "  4. Routers → Copy script onto each MikroTik"
echo "  5. Point acs.$DOMAIN at this VPS. CPE ACS URL = http://$DOMAIN:7547/"
echo "  6. ISP Solutions → GenieACS → Save NBI (http://genieacs:7557) → Sync from ACS"
echo "  7. RADIUS → Copy VPS env into gridline.env, then restart the freeradius container"
echo "  8. Publish now: sudo bash $INSTALL_DIR/deploy/vps/update.sh"
echo
echo "Health: curl -fsS https://$DOMAIN/api/v1/health"
echo "Logs:   docker compose -f $INSTALL_DIR/deploy/vps/docker-compose.yml logs -f web"
