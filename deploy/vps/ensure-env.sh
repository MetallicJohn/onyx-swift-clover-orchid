#!/bin/bash
# Append missing keys to ispsolutions.env. Never overwrites existing secrets.
set -euo pipefail
ENV_FILE="${1:?ispsolutions.env path required}"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE" || true

append() {
  local key="$1"
  local val="$2"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

copy_previous() {
  local new="$1"
  local old="$2"
  if grep -q "^${new}=" "$ENV_FILE"; then return 0; fi
  local val
  val="$(grep "^${old}=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  if [[ -n "$val" ]]; then echo "${new}=${val}" >>"$ENV_FILE"; fi
}

rand() { openssl rand -hex "${1:-24}"; }

copy_previous ISPSOLUTIONS_DOMAIN GRIDLINE_DOMAIN
copy_previous ISPSOLUTIONS_URL GRIDLINE_URL
copy_previous ISPSOLUTIONS_INTERNAL_URL GRIDLINE_INTERNAL_URL
copy_previous ISPSOLUTIONS_SLUG GRIDLINE_SLUG

append REDIS_PASSWORD "$(rand 24)"
append INTERNAL_SERVICE_TOKEN "$(rand 32)"
append DATABASE_SSL_MODE "disable"
append DATABASE_POOL_MAX "10"
append DATABASE_CONNECT_TIMEOUT_MS "8000"
append LOG_LEVEL "info"
append WORKER_CONCURRENCY "2"
append ISPSOLUTIONS_AUTO_DEPLOY "0"
append TRAFFIC_COLLECTION_INTERVAL "30"
append TRAFFIC_ROUTER_INTERVAL "60"
append COLLECTOR_ID "default"
append RADIUS_HOST "freeradius"
append RADIUS_AUTH_PORT "1812"
append RADIUS_ACCOUNTING_PORT "1813"
append GENIEACS_CWMP_URL "http://genieacs:7547"
append MONGODB_URL "mongodb://mongo:27017/genieacs"

if ! grep -q '^ACS_PUBLIC_HOST=' "$ENV_FILE"; then
  domain="$(grep '^ISPSOLUTIONS_DOMAIN=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
  if [[ -n "$domain" ]]; then
    echo "ACS_PUBLIC_HOST=$domain" >>"$ENV_FILE"
  fi
fi

if ! grep -q '^REDIS_URL=' "$ENV_FILE"; then
  pass="$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
  echo "REDIS_URL=redis://:${pass}@redis:6379/0" >>"$ENV_FILE"
fi
