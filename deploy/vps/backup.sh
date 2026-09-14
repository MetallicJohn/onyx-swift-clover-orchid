#!/bin/bash
# PostgreSQL backup. Run on the VPS that hosts Postgres (single-VPS or database role).
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/gridline}"
COMPOSE="${COMPOSE:-$INSTALL_DIR/deploy/vps/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/gridline.env}"
OUT_DIR="${OUT_DIR:-$INSTALL_DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/gridline-$STAMP.sql.gz"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-gridline}" -d "${POSTGRES_DB:-gridline}" --no-owner --no-acl \
  | gzip -c >"$FILE"
echo "$FILE"
