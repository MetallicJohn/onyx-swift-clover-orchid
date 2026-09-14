#!/bin/sh
set -eu
cd /app
ROLE="${ROLE:-web}"
if [ "${SKIP_MIGRATE:-}" != "1" ] && [ "$ROLE" = "web" ]; then
  echo "[gridline] applying migrations"
  node scripts/migrate.mjs
fi
if [ "$ROLE" = "worker" ]; then
  echo "[gridline] starting worker"
  exec node /app/deploy/vps/worker.mjs
fi
if [ "$ROLE" = "collector" ]; then
  echo "[gridline] starting traffic collector"
  exec node /app/deploy/vps/collector.mjs
fi
echo "[gridline] starting web on ${HOST:-0.0.0.0}:${PORT:-3000}"
exec node .output/server/index.mjs
