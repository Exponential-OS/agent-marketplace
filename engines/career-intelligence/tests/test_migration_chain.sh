#!/usr/bin/env bash
# test_migration_chain.sh — the upgrade path must actually be walkable.
#
# Reported symptom: every session start printed
#   ❌ Career OS: migration chain failed. Install aborted.
# Cause: two MISLABELLED scripts. `v0.73.4-to-v0.74.0.sh` and
# `v0.77.0-to-v0.79.0.sh` each gave their from-version a SECOND successor. The
# runner walks greedily, took the lower branch, and dead-ended — 0.78.0 had no
# outgoing script because its real one was misfiled as 0.77.0's. Every install
# between 0.73.5 and 0.78.0 was unupgradable, and because init-repo.sh aborts
# the whole hook on a failed chain, none of its other setup ran either.
#
# 1.0 retires the 0.x chain entirely: 59 scripts, nearly all of which only
# stamped a version, replaced by ONE baseline script. A single edge into 1.0.0
# cannot fork, so the bug class is gone by construction rather than by care.
#
# This tests the GRAPH, not the one path that was reported. Resolution only
# (MIGRATE_DRY_RUN=1) where possible — a migration that refuses to run until a
# human fixes a layout is correct behaviour, not a broken chain, and the two
# look identical if you only watch the exit code.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/migrations"
TARGET="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$ROOT/.claude-plugin/plugin.json" | head -1 | grep -o '[0-9][0-9.]*')"

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  ok   $1"; }
bad()  { fail=$((fail+1)); echo "  FAIL $1${2:+ — $2}"; }
check(){ if [ "$2" = "0" ]; then ok "$1"; else bad "$1" "${3:-}"; fi }

echo ""
echo "migration graph → target v${TARGET}"
echo ""

# ── 1. No forks. Two successors for one version makes the walk ambiguous. ─────
DUPES="$(ls "$MIGRATIONS"/v*-to-v*.sh 2>/dev/null | while read -r f; do
    b="$(basename "$f")"; b="${b#v}"; echo "${b%%-to-v*}"
done | sort -V | uniq -d)"
if [ -z "$DUPES" ]; then
  ok "every version has at most one successor"
else
  bad "ambiguous graph: $(echo "$DUPES" | tr '\n' ' ')"
fi

# ── 2. The 1.0 baseline exists and is the newest target. ─────────────────────
check "baseline script v0.0.0-to-v1.0.0.sh exists" \
      "$([ -f "$MIGRATIONS/v0.0.0-to-v1.0.0.sh" ] && echo 0 || echo 1)"

LATEST="$(ls "$MIGRATIONS"/v*-to-v*.sh 2>/dev/null | sed -E 's/.*-to-v([0-9.]+)\.sh$/\1/' | sort -V | tail -1)"
check "plugin version has a migration that targets it" \
      "$([ "$LATEST" = "$TARGET" ] && echo 0 || echo 1)" "latest target=$LATEST plugin=$TARGET"

# ── 3. Every pre-1.0 entry point resolves — including the reported one. ──────
# The 0.x scripts are gone, so these all route through the single baseline hop.
# 0.77.0 is the version that was actually stuck; the rest are the other former
# dead ends and forks, kept so a regression names itself.
BROKEN=""
for v in 0.3.0 0.29.0 0.42.0 0.73.4 0.73.9 0.77.0 0.78.0 0.81.0; do
  MIGRATE_DRY_RUN=1 bash "$MIGRATIONS/migrate.sh" /tmp/mig-test "$v" "$TARGET" >/dev/null 2>&1 \
    || BROKEN="$BROKEN $v"
done
check "every pre-1.0 version reaches v${TARGET}" "$([ -z "$BROKEN" ] && echo 0 || echo 1)" "unresolved:$BROKEN"

# ── 4. Every 1.x from-version resolves, once the chain grows past 1.0. ───────
BROKEN1=""
for f in "$MIGRATIONS"/v1.*-to-v*.sh; do
  [ -f "$f" ] || continue
  b="$(basename "$f")"; b="${b#v}"; from="${b%%-to-v*}"
  [ "$from" = "$TARGET" ] && continue
  MIGRATE_DRY_RUN=1 bash "$MIGRATIONS/migrate.sh" /tmp/mig-test "$from" "$TARGET" >/dev/null 2>&1 \
    || BROKEN1="$BROKEN1 $from"
done
check "every 1.x from-version reaches v${TARGET}" "$([ -z "$BROKEN1" ] && echo 0 || echo 1)" "unresolved:$BROKEN1"

# ── 5. A genuinely missing hop must still FAIL HARD. ─────────────────────────
# Collapsing to one baseline must not become "stamp whatever was asked for" —
# that is the v0.24.0 stuck-install incident the abort exists to prevent.
MIGRATE_DRY_RUN=1 bash "$MIGRATIONS/migrate.sh" /tmp/mig-test "$TARGET" 99.99.0 >/dev/null 2>&1
check "unreachable post-1.0 target still aborts" "$([ $? -ne 0 ] && echo 0 || echo 1)"

# ── 6. Same version in and out is a no-op, not an error. ─────────────────────
MIGRATE_DRY_RUN=1 bash "$MIGRATIONS/migrate.sh" /tmp/mig-test "$TARGET" "$TARGET" >/dev/null 2>&1
check "already-current is a no-op" "$?"

# ── 7. The fork guard actually fires. A guard that never triggers is not a ────
#      guard; plant a duplicate successor and require the runner to refuse.
#      This is what the two mislabelled scripts would hit today.
TMPM="$(mktemp -d)"; cp "$MIGRATIONS"/migrate.sh "$TMPM/"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMPM/v1.0.0-to-v1.1.0.sh"
cp "$TMPM/v1.0.0-to-v1.1.0.sh" "$TMPM/v1.0.0-to-v1.2.0.sh"
OUT="$(MIGRATE_DRY_RUN=1 bash "$TMPM/migrate.sh" /tmp/mig-test 1.0.0 1.2.0 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && echo "$OUT" | grep -q "more than one successor"; then
  ok "fork guard refuses an ambiguous graph and names it"
else
  bad "fork guard did not fire" "rc=$rc"
fi

# ── 8. The one guarantee carried over from the retired chain. ────────────────
# A workspace still holding .career-os/ never made the v0.29.0 state
# relocation, so the baseline must refuse rather than stamp 1.0.0.
LEG="$(mktemp -d)"; LEGSTATE="$(mktemp -d)"
mkdir -p "$LEG/.career-os/memory"
OUT="$(CLAUDE_PLUGIN_DATA="$LEGSTATE" bash "$MIGRATIONS/migrate.sh" "$LEG" 0.3.0 "$TARGET" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && [ ! -f "$LEGSTATE/version" ]; then
  ok "pre-v0.29.0 workspace fails hard and stamps nothing"
else
  bad "pre-v0.29.0 workspace was allowed through" "rc=$rc stamped=$(cat "$LEGSTATE/version" 2>/dev/null || echo none)"
fi

echo ""
echo "  ${pass} passed, ${fail} failed"
echo ""
[ "$fail" -eq 0 ]
