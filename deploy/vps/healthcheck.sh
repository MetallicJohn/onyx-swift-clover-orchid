#!/bin/bash
# Wait until the web container answers /api/v1/health with ok:true.
# Usage: sudo bash deploy/vps/healthcheck.sh [timeout_seconds]
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-}"
if [[ -z "$INSTALL_DIR" ]]; then
  if [[ -d /opt/ispsolutions ]]; then INSTALL_DIR=/opt/ispsolutions
  elif [[ -d /opt/gridline ]]; then INSTALL_DIR=/opt/gridline
  else INSTALL_DIR=/opt/ispsolutions
  fi
fi
COMPOSE="${COMPOSE:-$INSTALL_DIR/deploy/vps/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/ispsolutions.env}"
if [[ ! -f "$ENV_FILE" && -f "$INSTALL_DIR/gridline.env" ]]; then
  ENV_FILE="$INSTALL_DIR/gridline.env"
fi
TIMEOUT="${1:-180}"
PROJECT=ispsolutions
if docker volume inspect gridline_pgdata >/dev/null 2>&1; then
  PROJECT=gridline
fi

deadline=$((SECONDS + TIMEOUT))
while (( SECONDS < deadline )); do
  cid="$(docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" ps -q web 2>/dev/null || true)"
  if [[ -n "$cid" ]]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
    body="$(docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" exec -T web \
      node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(async r=>{const t=await r.text(); if(!r.ok) process.exit(1); if(!t.includes('\"ok\":true')) process.exit(2); process.stdout.write(t);}).catch(()=>process.exit(1))" \
      2>/dev/null || true)"
    if [[ -n "$body" && "$body" == *'"ok":true'* ]]; then
      echo "$body"
      exit 0
    fi
    echo "[ispsolutions] waiting for health (container=${health:-unknown})"
  else
    echo "[ispsolutions] waiting for web container"
  fi
  sleep 5
done

echo "[ispsolutions] health check timed out after ${TIMEOUT}s" >&2
exit 1
