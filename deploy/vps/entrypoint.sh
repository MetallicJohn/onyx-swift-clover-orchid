#!/bin/sh
set -eu
cd /app
ROLE="${ROLE:-web}"
if [ "${SKIP_MIGRATE:-}" != "1" ] && [ "$ROLE" = "web" ]; then
  echo "[ispsolutions] applying migrations"
  node scripts/migrate.mjs
fi
if [ "$ROLE" = "worker" ]; then
  echo "[ispsolutions] starting worker"
  exec node /app/deploy/vps/worker.mjs
fi
if [ "$ROLE" = "collector" ]; then
  echo "[ispsolutions] starting traffic collector"
  exec node /app/deploy/vps/collector.mjs
fi
echo "[ispsolutions] starting web on ${HOST:-0.0.0.0}:${PORT:-3000}"
exec node .output/server/index.mjs
