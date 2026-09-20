#!/bin/bash
# PostgreSQL backup (custom format). Run on the VPS that hosts Postgres.
# Prints the dump path on stdout. Verification logs go to stderr.
# The deploy must not continue if this script exits non-zero.
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
PROJECT="${PROJECT:-ispsolutions}"
if docker volume inspect gridline_pgdata >/dev/null 2>&1 && ! docker volume inspect ispsolutions_pgdata >/dev/null 2>&1; then
  PROJECT=gridline
fi
# shellcheck source=protect.sh
source "$INSTALL_DIR/deploy/vps/protect.sh"

OUT_DIR="${OUT_DIR:-$INSTALL_DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/ispsolutions-$STAMP.dump"
SHA="$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
PGVER="$(protect_psql -tAc 'show server_version' 2>/dev/null | tr -d '[:space:]' || echo unknown)"
MIGRATION="$(protect_psql -tAc "select coalesce(max(name),'none') from _migrations" 2>/dev/null | tr -d '[:space:]' || echo unknown)"

protect_compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-ispsolutions}" -d "${POSTGRES_DB:-ispsolutions}" \
  --format=custom --no-owner --no-acl \
  >"$FILE"

verify_dump_file "$FILE" >&2
COUNTS="$(snapshot_counts "$FILE.counts.json")"
cat >"$FILE.meta" <<EOF
database_version=$PGVER
application_git=$SHA
migration_version=$MIGRATION
backup_timestamp=$STAMP
backup_file=$FILE
counts=$COUNTS
EOF
KEEP="$(protect_psql -tAc "select coalesce((select value from platform_settings where key='backup_keep'), '14')" 2>/dev/null | tr -d '[:space:]' || true)"
prune_old_backups "$OUT_DIR" "${KEEP:-14}"
echo "$FILE"
