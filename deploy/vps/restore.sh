#!/bin/bash
# Restore a gzip SQL dump. Stops web/workers first so they do not write during restore.
# Usage: sudo bash deploy/vps/restore.sh /opt/gridline/backups/gridline-YYYYMMDD.sql.gz
set -euo pipefail
DUMP="${1:?path to .sql.gz required}"
INSTALL_DIR="${INSTALL_DIR:-/opt/gridline}"
COMPOSE="${COMPOSE:-$INSTALL_DIR/deploy/vps/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/gridline.env}"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" stop web worker collector || true
gzip -dc "$DUMP" | docker compose -f "$COMPOSE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-gridline}" -d "${POSTGRES_DB:-gridline}"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" start web worker collector || \
  docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d web
echo "restored $DUMP"
