#!/bin/bash
# Pull origin/main into /opt/gridline and rebuild. Keeps gridline.env and volumes.
#   sudo bash /opt/gridline/deploy/vps/update.sh
#   sudo bash /opt/gridline/deploy/vps/update.sh --force
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/gridline}"
GIT_URL="${GRIDLINE_GIT_URL:-https://github.com/MetallicJohn/onyx-swift-clover-orchid.git}"
BRANCH="${GRIDLINE_BRANCH:-main}"
FORCE=0
for arg in "$@"; do
  if [[ "$arg" == "--force" || "$arg" == "-f" ]]; then FORCE=1; fi
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

mkdir -p /var/lock
exec 9>/var/lock/gridline-update.lock
if ! flock -n 9; then
  echo "[gridline] update already running"
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "[gridline] Docker is not installed. Run deploy/vps/install.sh first." >&2
  exit 1
fi

git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
mkdir -p "$INSTALL_DIR"

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  echo "[gridline] attaching $GIT_URL to $INSTALL_DIR"
  if [[ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
    git clone --branch "$BRANCH" "$GIT_URL" "$INSTALL_DIR"
  else
    git -C "$INSTALL_DIR" init
    git -C "$INSTALL_DIR" remote remove origin 2>/dev/null || true
    git -C "$INSTALL_DIR" remote add origin "$GIT_URL"
    git -C "$INSTALL_DIR" fetch origin "+${BRANCH}:refs/remotes/origin/${BRANCH}"
    git -C "$INSTALL_DIR" checkout -f -B "$BRANCH" "origin/$BRANCH"
    FORCE=1
  fi
else
  git -C "$INSTALL_DIR" remote set-url origin "$GIT_URL"
  git -C "$INSTALL_DIR" fetch origin "+${BRANCH}:refs/remotes/origin/${BRANCH}"
fi

cd "$INSTALL_DIR"
BEFORE="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [[ "$BEFORE" != "$REMOTE" ]]; then
  echo "[gridline] $BEFORE -> $REMOTE"
  git reset --hard "origin/$BRANCH"
  FORCE=1
fi

ENV_FILE="$INSTALL_DIR/gridline.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[gridline] missing $ENV_FILE — run install.sh once to create secrets." >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1 && [[ -f "$INSTALL_DIR/deploy/vps/systemd/gridline-update.service" ]]; then
  sed "s|/opt/gridline|$INSTALL_DIR|g" "$INSTALL_DIR/deploy/vps/systemd/gridline-update.service" >/etc/systemd/system/gridline-update.service
  sed "s|/opt/gridline|$INSTALL_DIR|g" "$INSTALL_DIR/deploy/vps/systemd/gridline-update.timer" >/etc/systemd/system/gridline-update.timer
  systemctl daemon-reload
  systemctl enable --now gridline-update.timer >/dev/null
fi

if [[ "$FORCE" -ne 1 ]]; then
  echo "[gridline] already at $BEFORE"
  exit 0
fi

SHORT="$(git rev-parse --short HEAD)"
export GRIDLINE_GIT_SHA="$SHORT"
echo "[gridline] building $SHORT"
docker compose -f "$INSTALL_DIR/deploy/vps/docker-compose.yml" --env-file "$ENV_FILE" up -d --build
echo "[gridline] published $SHORT"
