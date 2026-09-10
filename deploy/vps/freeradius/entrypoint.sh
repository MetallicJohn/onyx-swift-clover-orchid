#!/bin/sh
set -eu
BASE="${GRIDLINE_URL:-http://web:3000}"
SLUG="${GRIDLINE_SLUG:-}"
KEY="${RADIUS_API_KEY:-}"
RADDB="${RADDB:-/etc/raddb}"

echo "[gridline-radius] waiting for ISP Solutions at $BASE"
i=0
while [ "$i" -lt 40 ]; do
  if curl -fsS --max-time 3 "$BASE/api/v1/health" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 3
done

if [ -z "$SLUG" ] || [ -z "$KEY" ]; then
  echo "[gridline-radius] GRIDLINE_SLUG and RADIUS_API_KEY are required."
  echo "[gridline-radius] Copy them from ISP Solutions → RADIUS → Copy VPS env, then restart this container."
  sleep 15
  exit 1
fi

echo "[gridline-radius] pulling bootstrap for $SLUG"
BOOT="$(curl -fsS --max-time 15 -u "gridline:${KEY}" "${BASE}/api/v1/radius/bootstrap/${SLUG}")"
printf '%s' "$BOOT" | jq -r .rest >"$RADDB/mods-available/rest"
printf '%s' "$BOOT" | jq -r .site >"$RADDB/sites-available/gridline"
printf '%s' "$BOOT" | jq -r .clients >"$RADDB/clients.conf"
ln -sfn ../mods-available/rest "$RADDB/mods-enabled/rest"
ln -sfn ../sites-available/gridline "$RADDB/sites-enabled/gridline"
rm -f "$RADDB/sites-enabled/default" "$RADDB/sites-enabled/inner-tunnel"
echo "[gridline-radius] starting radiusd on UDP 1812/1813"
exec radiusd -f -l stdout
