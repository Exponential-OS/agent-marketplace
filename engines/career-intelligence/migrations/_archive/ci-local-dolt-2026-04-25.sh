#!/usr/bin/env bash
# product-vs-solution: example — archived dev script.
# ci-local.sh — Local CI runner for the Career OS plugin.
#
# Smokes the full Dolt + migrate + pytest loop in one command so v0.22.0+
# iteration is tight. Complements the existing dev/ci/ skill (which is a
# multi-skill chain); this is the single-command dev loop.
#
# Usage (from plugin repo root):
#   bash dev/ci-local.sh                  # ensure Dolt up → migrate → pytest
#   bash dev/ci-local.sh --skip-migrate   # tests only, against current DB state
#   bash dev/ci-local.sh --fresh          # stop + remove Dolt, re-create, re-migrate
#   bash dev/ci-local.sh --teardown       # run then stop the container at end
#   bash dev/ci-local.sh --help
#
# Env (with sensible defaults):
#   CYBORG_DB_HOST=127.0.0.1  CYBORG_DB_PORT=3306  CYBORG_DB_NAME=cyborg_brain
#   DOLT_CONTAINER=cyborg-brain-db
#   DOLT_IMAGE=dolthub/dolt-sql-server:latest
#   DOLT_VOLUME=$HOME/cyborg/brain-db
#   PYTHON=$HOME/cyborg/brain-db/.venv/bin/python
#   MIGRATE_SCRIPT=$HOME/cyborg/brain-db/migrate_career_os.py
#
# Exit codes:
#   0 all green · 1 step failure (with printed step) · 2 bad flags

set -uo pipefail

# ── CLI ──────────────────────────────────────────────────────────────
SKIP_MIGRATE=0
FRESH=0
TEARDOWN=0
VERBOSE=0

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --fresh)        FRESH=1 ;;
    --teardown)     TEARDOWN=1 ;;
    -v|--verbose)   VERBOSE=1 ;;
    -h|--help)      usage 0 ;;
    *)              echo "unknown arg: $1"; usage 2 ;;
  esac
  shift
done

# ── config ───────────────────────────────────────────────────────────
CYBORG_DB_HOST="${CYBORG_DB_HOST:-127.0.0.1}"
CYBORG_DB_PORT="${CYBORG_DB_PORT:-3306}"
CYBORG_DB_NAME="${CYBORG_DB_NAME:-cyborg_brain}"
DOLT_CONTAINER="${DOLT_CONTAINER:-cyborg-brain-db}"
DOLT_IMAGE="${DOLT_IMAGE:-dolthub/dolt-sql-server:latest}"
DOLT_VOLUME="${DOLT_VOLUME:-$HOME/cyborg/brain-db}"
PYTHON="${PYTHON:-$HOME/cyborg/brain-db/.venv/bin/python}"
MIGRATE_SCRIPT="${MIGRATE_SCRIPT:-$HOME/cyborg/brain-db/migrate_career_os.py}"

# ── logging ──────────────────────────────────────────────────────────
GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'

step()  { echo "${BLUE}▶${NC} $*"; }
ok()    { echo "${GREEN}✓${NC} $*"; }
warn()  { echo "${YELLOW}⚠${NC} $*"; }
fail()  { echo "${RED}✗${NC} $*" >&2; }
time_s(){ date +%s; }

fail_and_exit() {
  fail "STEP FAILED: $1"
  [ -n "${2:-}" ] && echo "  detail: $2" >&2
  exit 1
}

# ── preflight ────────────────────────────────────────────────────────
step "preflight"

# Must be in plugin repo (reuse guard.sh's detection logic inline)
if ! [ -f "hooks/hooks.json" ] && ! [ -f ".claude-plugin/plugin.json" ]; then
  fail_and_exit "wrong directory" "run from plugin repo root (\$CAREER_OS_PLUGIN)"
fi

command -v docker >/dev/null 2>&1 || fail_and_exit "docker not found" "install Docker Desktop"
[ -x "$PYTHON" ] || fail_and_exit "python not found" "expected at $PYTHON"

ok "preflight"

# ── Dolt container ───────────────────────────────────────────────────
step "Dolt container ($DOLT_CONTAINER)"

if [ "$FRESH" = "1" ]; then
  warn "--fresh: stopping + removing container"
  docker rm -f "$DOLT_CONTAINER" >/dev/null 2>&1 || true
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${DOLT_CONTAINER}$"; then
  # Exists but stopped?
  if docker ps -a --format '{{.Names}}' | grep -q "^${DOLT_CONTAINER}$"; then
    step "starting stopped container"
    docker start "$DOLT_CONTAINER" >/dev/null || fail_and_exit "docker start" "check docker logs $DOLT_CONTAINER"
  else
    step "creating container (first run or --fresh)"
    mkdir -p "$DOLT_VOLUME"
    docker run -d \
      --name "$DOLT_CONTAINER" \
      -p "${CYBORG_DB_PORT}:3306" \
      -v "${DOLT_VOLUME}:/var/lib/dolt" \
      "$DOLT_IMAGE" >/dev/null \
      || fail_and_exit "docker run" "pull $DOLT_IMAGE and retry"
  fi
fi

# Wait for TCP readiness
step "waiting for :${CYBORG_DB_PORT}"
for i in $(seq 1 30); do
  if nc -z "$CYBORG_DB_HOST" "$CYBORG_DB_PORT" 2>/dev/null; then
    ok "Dolt reachable (attempt $i)"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    fail_and_exit "Dolt never came up" "docker logs $DOLT_CONTAINER"
  fi
done

# Confirm DB exists (schema readiness)
if ! docker exec "$DOLT_CONTAINER" dolt sql -q "SHOW DATABASES;" 2>/dev/null | grep -q "$CYBORG_DB_NAME"; then
  fail_and_exit "database $CYBORG_DB_NAME missing" "run one-time: docker exec $DOLT_CONTAINER dolt sql -q \"CREATE DATABASE $CYBORG_DB_NAME;\" and re-apply schema"
fi

ok "Dolt + $CYBORG_DB_NAME ready"

# ── migrate ──────────────────────────────────────────────────────────
if [ "$SKIP_MIGRATE" = "1" ]; then
  warn "--skip-migrate: not re-ingesting source .md files"
else
  step "migrate (~/cyborg/brain-db/migrate_career_os.py --all)"
  [ -f "$MIGRATE_SCRIPT" ] || fail_and_exit "migrate script not found" "expected at $MIGRATE_SCRIPT"
  ts0=$(time_s)
  if [ "$VERBOSE" = "1" ]; then
    "$PYTHON" "$MIGRATE_SCRIPT" --all || fail_and_exit "migration" "see stderr above"
  else
    "$PYTHON" "$MIGRATE_SCRIPT" --all 2>&1 | tail -15 || fail_and_exit "migration" "re-run with --verbose"
  fi
  ok "migrate ($(($(time_s) - ts0))s)"
fi

# ── pytest ───────────────────────────────────────────────────────────
step "pytest"
ts0=$(time_s)
CYBORG_DB_HOST="$CYBORG_DB_HOST" CYBORG_DB_PORT="$CYBORG_DB_PORT" CYBORG_DB_NAME="$CYBORG_DB_NAME" \
  "$PYTHON" -m pytest tests/ ${VERBOSE:+-v} --tb=short 2>&1 | tail -20
test_status=${PIPESTATUS[0]}
if [ "$test_status" != "0" ]; then
  fail_and_exit "pytest" "fix failing cases or run with --verbose"
fi
ok "pytest ($(($(time_s) - ts0))s)"

# ── optional teardown ────────────────────────────────────────────────
if [ "$TEARDOWN" = "1" ]; then
  step "teardown"
  docker stop "$DOLT_CONTAINER" >/dev/null && ok "$DOLT_CONTAINER stopped (data preserved in $DOLT_VOLUME)"
fi

echo ""
ok "ALL GREEN · Dolt ready · migrate OK · pytest OK"
