#!/bin/bash
# Append missing keys to gridline.env. Never overwrites existing secrets.
set -euo pipefail
ENV_FILE="${1:?gridline.env path required}"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE" || true

append() {
  local key="$1"
  local val="$2"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

rand() { openssl rand -hex "${1:-24}"; }

append REDIS_PASSWORD "$(rand 24)"
append INTERNAL_SERVICE_TOKEN "$(rand 32)"
append DATABASE_SSL_MODE "disable"
append DATABASE_POOL_MAX "10"
append DATABASE_CONNECT_TIMEOUT_MS "8000"
append LOG_LEVEL "info"
append WORKER_CONCURRENCY "2"
append TRAFFIC_COLLECTION_INTERVAL "30"
append COLLECTOR_ID "default"
append RADIUS_HOST "freeradius"
append RADIUS_AUTH_PORT "1812"
append RADIUS_ACCOUNTING_PORT "1813"
append GENIEACS_CWMP_URL "http://genieacs:7547"
append MONGODB_URL "mongodb://mongo:27017/genieacs"

if ! grep -q '^REDIS_URL=' "$ENV_FILE"; then
  pass="$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
  echo "REDIS_URL=redis://:${pass}@redis:6379/0" >>"$ENV_FILE"
fi

if grep -q '^ACS_EDGE_TOKEN=' "$ENV_FILE" && grep -q '^INTERNAL_SERVICE_TOKEN=$' "$ENV_FILE"; then
  true
fi
