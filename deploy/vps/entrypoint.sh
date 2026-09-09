#!/bin/sh
set -eu
cd /app
echo "[gridline] applying migrations"
node scripts/migrate.mjs
echo "[gridline] starting web on ${HOST:-0.0.0.0}:${PORT:-3000}"
exec node .output/server/index.mjs
