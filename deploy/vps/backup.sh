#!/bin/bash
# PostgreSQL backup. Run on the VPS that hosts Postgres (single-VPS or database role).
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
OUT_DIR="${OUT_DIR:-$INSTALL_DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/ispsolutions-$STAMP.sql.gz"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-ispsolutions}" -d "${POSTGRES_DB:-ispsolutions}" --no-owner --no-acl \
  | gzip -c >"$FILE"
echo "$FILE"
