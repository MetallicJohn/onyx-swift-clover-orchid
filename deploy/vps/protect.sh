#!/bin/bash
# Shared production-data guards for backup / update / restore.
# Never run `docker compose down -v` from these helpers.

SNAPSHOT_TABLES=(
  tenants '"user"' customers services packages invoices payments incoming_payments
  customer_ledger routers ip_pools ip_addresses tickets audit_logs radius_accounts
  wireguard_peers
)

protect_compose() {
  docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" "$@"
}

protect_psql() {
  protect_compose exec -T postgres \
    psql -U "${POSTGRES_USER:-ispsolutions}" -d "${POSTGRES_DB:-ispsolutions}" -v ON_ERROR_STOP=1 "$@"
}

refuse_volume_destroy() {
  for arg in "$@"; do
    case "$arg" in
      -v|--volumes)
        echo "[ispsolutions] refused: destroying Docker volumes would wipe production data" >&2
        return 1
        ;;
    esac
  done
  return 0
}

pgdata_volume() {
  if docker volume inspect "${PROJECT}_pgdata" >/dev/null 2>&1; then
    echo "${PROJECT}_pgdata"
    return 0
  fi
  if docker volume inspect gridline_pgdata >/dev/null 2>&1; then
    echo "gridline_pgdata"
    return 0
  fi
  return 1
}

postgres_has_data() {
  local n
  n="$(protect_psql -tAc "select count(*) from tenants" 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "${n:-0}" =~ ^[0-9]+$ ]] && (( n > 0 ))
}

snapshot_counts() {
  local out="${1:?snapshot json path}"
  local json="{"
  local first=1
  local table n
  mkdir -p "$(dirname "$out")"
  for table in "${SNAPSHOT_TABLES[@]}"; do
    n="$(protect_psql -tAc "select count(*)::int from ${table}" 2>/dev/null | tr -d '[:space:]' || true)"
    [[ "$n" =~ ^[0-9]+$ ]] || n=0
    if [[ "$first" -eq 1 ]]; then first=0; else json+=","; fi
    json+="\"${table//\"/}\":$n"
  done
  json+="}"
  printf '%s\n' "$json" >"$out"
  echo "$json"
}

compare_count_files() {
  local before="${1:?}"
  local after="${2:?}"
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[ispsolutions] python3 required to compare data snapshots" >&2
    return 1
  fi
  python3 - "$before" "$after" <<'PY'
import json, sys
before = json.load(open(sys.argv[1], encoding="utf-8"))
after = json.load(open(sys.argv[2], encoding="utf-8"))
drops = []
for key, prev in before.items():
    nxt = after.get(key, prev)
    if isinstance(prev, (int, float)) and isinstance(nxt, (int, float)) and nxt < prev:
        drops.append(f"{key}: {int(prev)} → {int(nxt)}")
if drops:
    print("Data integrity: FAILED")
    print("\n".join(drops))
    sys.exit(1)
print("Data integrity: PASSED")
PY
}

verify_dump_file() {
  local file="${1:?}"
  if [[ ! -f "$file" ]]; then
    echo "[ispsolutions] backup missing: $file" >&2
    return 1
  fi
  local size
  size="$(wc -c <"$file" | tr -d ' ')"
  if [[ "${size:-0}" -lt 256 ]]; then
    echo "[ispsolutions] backup too small (${size} bytes): $file" >&2
    return 1
  fi
  case "$file" in
    *.dump)
      local mag
      mag="$(dd if="$file" bs=5 count=1 2>/dev/null || true)"
      if [[ "$mag" != "PGDMP" ]]; then
        echo "[ispsolutions] backup is not a PostgreSQL custom dump: $file" >&2
        return 1
      fi
      if ! protect_compose exec -T postgres pg_restore --list <"$file" >/dev/null; then
        echo "[ispsolutions] pg_restore --list failed: $file" >&2
        return 1
      fi
      ;;
    *.sql.gz)
      gzip -t "$file" || { echo "[ispsolutions] gzip test failed: $file" >&2; return 1; }
      ;;
    *)
      echo "[ispsolutions] unknown backup type: $file" >&2
      return 1
      ;;
  esac
  echo "[ispsolutions] backup verified ($size bytes) $file"
}

scan_sql_text() {
  local name="${1:?}"
  local text="${2:?}"
  case "$name" in
    0023_empty_tenants_created_today.sql) return 0 ;;
  esac
  local stripped
  stripped="$(printf '%s\n' "$text" | sed -e 's/--.*$//' )"
  local hit=""
  echo "$stripped" | grep -Eiq 'drop[[:space:]]+database\b' && hit="DROP DATABASE"
  echo "$stripped" | grep -Eiq 'drop[[:space:]]+schema\b' && hit="${hit:+$hit, }DROP SCHEMA"
  echo "$stripped" | grep -Eiq 'drop[[:space:]]+table\b' && hit="${hit:+$hit, }DROP TABLE"
  echo "$stripped" | grep -Eiq 'truncate[[:space:]]+' && hit="${hit:+$hit, }TRUNCATE"
  echo "$stripped" | grep -Eiq 'drop[[:space:]]+column\b' && hit="${hit:+$hit, }DROP COLUMN"
  echo "$stripped" | grep -Eiq 'delete[[:space:]]+from\b' && hit="${hit:+$hit, }DELETE FROM"
  if [[ -n "$hit" ]]; then
    echo "[ispsolutions] BLOCKED $name: $hit" >&2
    echo "Required approval: ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS=1 after verified backup" >&2
    return 1
  fi
  return 0
}

scan_pending_migrations() {
  local dir="${INSTALL_DIR}/migrations"
  [[ -d "$dir" ]] || return 0
  local applied=""
  applied="$(protect_psql -tAc 'select name from _migrations' 2>/dev/null || true)"
  local f base failed=0
  for f in "$dir"/*.sql; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    if printf '%s\n' "$applied" | grep -qx "$base"; then
      continue
    fi
    if ! scan_sql_text "$base" "$(cat "$f")"; then
      failed=1
    fi
  done
  if [[ "$failed" -eq 1 ]]; then
    if [[ "${ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS:-}" == "1" ]]; then
      echo "[ispsolutions] destructive SQL allowed by ISPSOLUTIONS_ALLOW_DESTRUCTIVE_MIGRATIONS=1" >&2
      return 0
    fi
    return 1
  fi
  echo "[ispsolutions] pending migrations: no destructive SQL"
}

write_deploy_meta() {
  local file="${1:?}"
  {
    echo "ISP SOLUTIONS PRODUCTION UPDATE"
    echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "install: $INSTALL_DIR"
    echo "database: ${POSTGRES_DB:-ispsolutions}"
    shift
    printf '%s\n' "$@"
  } >"$file"
}

prune_old_backups() {
  local dir="${1:?}"
  local keep="${2:-14}"
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || keep=14
  if (( keep > 365 )); then keep=365; fi
  [[ -d "$dir" ]] || return 0
  local i=0
  local f
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    i=$((i + 1))
    if (( i > keep )); then
      rm -f "$f" "${f}.meta" "${f}.counts.json"
      echo "[ispsolutions] pruned old backup $(basename "$f")" >&2
    fi
  done < <(find "$dir" -maxdepth 1 -type f \( -name 'ispsolutions-*.dump' -o -name 'ispsolutions-*.sql.gz' \) -printf '%T@\t%p\n' 2>/dev/null | sort -nr | cut -f2-)
}
