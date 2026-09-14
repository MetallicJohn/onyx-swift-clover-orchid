#!/bin/bash
# Restore a gzip SQL dump. Stops web/workers first so they do not write during restore.
# Usage: sudo bash deploy/vps/restore.sh /opt/ispsolutions/backups/ispsolutions-YYYYMMDD.sql.gz
set -euo pipefail
DUMP="${1:?path to .sql.gz required}"
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
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" stop web worker collector || true
gzip -dc "$DUMP" | docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-ispsolutions}" -d "${POSTGRES_DB:-ispsolutions}"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" start web worker collector || \
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d web
echo "restored $DUMP"
