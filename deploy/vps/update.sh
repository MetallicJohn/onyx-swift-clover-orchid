#!/bin/bash
# Pull origin/main into /opt/ispsolutions and rebuild with backup + health + rollback.
#   sudo bash /opt/ispsolutions/deploy/vps/update.sh            # fetch; deploy only if AUTO_DEPLOY=1
#   sudo bash /opt/ispsolutions/deploy/vps/update.sh --apply    # backup, pull, rebuild, health, rollback
#   sudo bash /opt/ispsolutions/deploy/vps/update.sh --from-ci  # same as --apply (GitHub Actions)
#   sudo bash /opt/ispsolutions/deploy/vps/update.sh --force    # rebuild even if SHA is unchanged
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-}"
if [[ -z "$INSTALL_DIR" ]]; then
  if [[ -d /opt/ispsolutions ]]; then INSTALL_DIR=/opt/ispsolutions
  elif [[ -d /opt/gridline ]]; then INSTALL_DIR=/opt/gridline
  else INSTALL_DIR=/opt/ispsolutions
  fi
fi
GIT_URL="${ISPSOLUTIONS_GIT_URL:-${GRIDLINE_GIT_URL:-https://github.com/MetallicJohn/onyx-swift-clover-orchid.git}}"
BRANCH="${ISPSOLUTIONS_BRANCH:-${GRIDLINE_BRANCH:-main}}"
FORCE=0
APPLY=0
FROM_CI=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1; APPLY=1 ;;
    --apply) APPLY=1 ;;
    --from-ci) FROM_CI=1; APPLY=1 ;;
  esac
done
if [[ "${ISPSOLUTIONS_FROM_CI:-}" == "1" ]]; then
  FROM_CI=1
  APPLY=1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

mkdir -p /var/lock
exec 9>/var/lock/ispsolutions-update.lock
if ! flock -n 9; then
  echo "[ispsolutions] update already running"
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "[ispsolutions] Docker is not installed. Run deploy/vps/install.sh first." >&2
  exit 1
fi

git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
mkdir -p "$INSTALL_DIR"

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  echo "[ispsolutions] attaching $GIT_URL to $INSTALL_DIR"
  if [[ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
    git clone --branch "$BRANCH" "$GIT_URL" "$INSTALL_DIR"
  else
    git -C "$INSTALL_DIR" init
    git -C "$INSTALL_DIR" remote remove origin 2>/dev/null || true
    git -C "$INSTALL_DIR" remote add origin "$GIT_URL"
    git -C "$INSTALL_DIR" fetch origin "+${BRANCH}:refs/remotes/origin/${BRANCH}"
    git -C "$INSTALL_DIR" checkout -f -B "$BRANCH" "origin/$BRANCH"
    FORCE=1
    APPLY=1
  fi
else
  git -C "$INSTALL_DIR" remote set-url origin "$GIT_URL"
  git -C "$INSTALL_DIR" fetch origin "+${BRANCH}:refs/remotes/origin/${BRANCH}"
fi

cd "$INSTALL_DIR"
BEFORE="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

ENV_FILE="$INSTALL_DIR/ispsolutions.env"
if [[ ! -f "$ENV_FILE" && -f "$INSTALL_DIR/gridline.env" ]]; then
  mv "$INSTALL_DIR/gridline.env" "$ENV_FILE"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ispsolutions] missing $ENV_FILE — run install.sh once to create secrets." >&2
  exit 1
fi
bash "$INSTALL_DIR/deploy/vps/ensure-env.sh" "$ENV_FILE"

auto_deploy="$(grep '^ISPSOLUTIONS_AUTO_DEPLOY=' "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
if [[ "$auto_deploy" == "1" || "$auto_deploy" == "true" ]]; then
  APPLY=1
fi

if command -v systemctl >/dev/null 2>&1 && [[ -f "$INSTALL_DIR/deploy/vps/systemd/ispsolutions-update.service" ]]; then
  sed "s|/opt/ispsolutions|$INSTALL_DIR|g" "$INSTALL_DIR/deploy/vps/systemd/ispsolutions-update.service" >/etc/systemd/system/ispsolutions-update.service
  sed "s|/opt/ispsolutions|$INSTALL_DIR|g" "$INSTALL_DIR/deploy/vps/systemd/ispsolutions-update.timer" >/etc/systemd/system/ispsolutions-update.timer
  systemctl disable --now gridline-update.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/gridline-update.service /etc/systemd/system/gridline-update.timer
  systemctl daemon-reload
  systemctl enable --now ispsolutions-update.timer >/dev/null
fi

if [[ "$APPLY" -ne 1 ]]; then
  if [[ "$BEFORE" != "$REMOTE" ]]; then
    echo "[ispsolutions] origin/$BRANCH is $REMOTE (local $BEFORE)."
    echo "[ispsolutions] Auto-deploy is off. Wait for green CI on $BRANCH, then:"
    echo "  sudo bash $INSTALL_DIR/deploy/vps/update.sh --apply"
  else
    echo "[ispsolutions] already at $BEFORE (auto-deploy off)"
  fi
  exit 0
fi

if [[ "$BEFORE" == "$REMOTE" && "$FORCE" -ne 1 ]]; then
  echo "[ispsolutions] already at $BEFORE"
  exit 0
fi

PROJECT=ispsolutions
if docker volume inspect gridline_pgdata >/dev/null 2>&1; then
  PROJECT=gridline
fi
COMPOSE="$INSTALL_DIR/deploy/vps/docker-compose.yml"
BACKUP=""
postgres_up="$(docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" ps -q postgres 2>/dev/null || true)"
if [[ -n "$postgres_up" ]]; then
  echo "[ispsolutions] backing up database before deploy"
  BACKUP="$(INSTALL_DIR="$INSTALL_DIR" bash "$INSTALL_DIR/deploy/vps/backup.sh")"
  echo "[ispsolutions] backup $BACKUP"
  find "$INSTALL_DIR/backups" -name 'ispsolutions-*.sql.gz' -mtime +14 -delete 2>/dev/null || true
else
  echo "[ispsolutions] no running postgres yet — skip backup (first install)"
fi

if [[ "$BEFORE" != "$REMOTE" ]]; then
  echo "[ispsolutions] $BEFORE -> $REMOTE"
  git reset --hard "origin/$BRANCH"
fi

SHORT="$(git rev-parse --short HEAD)"
export ISPSOLUTIONS_GIT_SHA="$SHORT"
export GRIDLINE_GIT_SHA="$SHORT"
echo "[ispsolutions] building $SHORT"
if ! docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" up -d --build; then
  echo "[ispsolutions] compose up failed" >&2
  if [[ "$BEFORE" != "$(git rev-parse HEAD)" && "$BEFORE" != "$REMOTE" ]]; then
    echo "[ispsolutions] rolling back to $BEFORE"
    git reset --hard "$BEFORE"
    docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" up -d --build || true
  fi
  exit 1
fi

echo "[ispsolutions] applying GenieACS CWMP config"
docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" run --rm --no-deps genieacs-init \
  || echo "[ispsolutions] genieacs-init skipped (ACS config will apply from the app)"

HEALTH="$INSTALL_DIR/deploy/vps/healthcheck.sh"
if [[ -x "$HEALTH" ]] || [[ -f "$HEALTH" ]]; then
  chmod +x "$HEALTH" 2>/dev/null || true
  if ! INSTALL_DIR="$INSTALL_DIR" bash "$HEALTH" 180; then
    echo "[ispsolutions] health failed after $SHORT" >&2
    if [[ -n "$BEFORE" && "$BEFORE" != "$(git rev-parse HEAD)" ]]; then
      echo "[ispsolutions] rolling back code to $BEFORE"
      git reset --hard "$BEFORE"
      PREV_SHORT="$(git rev-parse --short HEAD)"
      export ISPSOLUTIONS_GIT_SHA="$PREV_SHORT"
      export GRIDLINE_GIT_SHA="$PREV_SHORT"
      docker compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV_FILE" up -d --build || true
      if INSTALL_DIR="$INSTALL_DIR" bash "$HEALTH" 180; then
        echo "[ispsolutions] rollback healthy at $PREV_SHORT"
        if [[ -n "$BACKUP" ]]; then
          echo "[ispsolutions] database backup kept at $BACKUP (not restored; schema is additive)"
        fi
        exit 1
      fi
      echo "[ispsolutions] rollback health still failing" >&2
    fi
    if [[ -n "$BACKUP" ]]; then
      echo "[ispsolutions] restore dump if needed: sudo bash $INSTALL_DIR/deploy/vps/restore.sh $BACKUP" >&2
    fi
    exit 1
  fi
fi

echo "[ispsolutions] published $SHORT"
if [[ "$FROM_CI" == "1" ]]; then
  echo "[ispsolutions] deployed from CI"
fi
