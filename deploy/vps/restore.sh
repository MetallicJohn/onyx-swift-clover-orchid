#!/bin/bash
# Restore a verified dump over the live database. This overwrites production data.
# Never called from update.sh. Last-resort disaster recovery only.
#
# Usage:
#   sudo bash deploy/vps/restore.sh --i-understand-this-overwrites-live-data /opt/ispsolutions/backups/ispsolutions-YYYYMMDD.dump
set -euo pipefail
CONFIRM=0
DUMP=""
for arg in "$@"; do
  case "$arg" in
    --i-understand-this-overwrites-live-data) CONFIRM=1 ;;
    -*)
      echo "Unknown flag $arg" >&2
      exit 1
      ;;
    *) DUMP="$arg" ;;
  esac
done
if [[ "$CONFIRM" -ne 1 ]]; then
  echo "Restore refuses to run without --i-understand-this-overwrites-live-data" >&2
  echo "This replaces the live database. Prefer rolling the application SHA forward/back and keeping the current data." >&2
  exit 1
fi
DUMP="${DUMP:?path to .dump or .sql.gz required}"
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

verify_dump_file "$DUMP"

echo "[ispsolutions] stopping writers before restore"
protect_compose stop web worker collector || true

USER_NAME="${POSTGRES_USER:-ispsolutions}"
DB_NAME="${POSTGRES_DB:-ispsolutions}"
case "$DUMP" in
  *.dump)
    protect_compose exec -T postgres pg_restore \
      -U "$USER_NAME" -d "$DB_NAME" --no-owner --no-acl --clean --if-exists --exit-on-error \
      <"$DUMP"
    ;;
  *.sql.gz)
    gzip -dc "$DUMP" | protect_compose exec -T postgres \
      psql -U "$USER_NAME" -d "$DB_NAME" -v ON_ERROR_STOP=1
    ;;
  *)
    echo "Unsupported dump: $DUMP" >&2
    exit 1
    ;;
esac

protect_compose start web worker collector || protect_compose up -d web
echo "restored $DUMP"
echo "Do not run this again unless the restored dump is still the intended recovery point."
