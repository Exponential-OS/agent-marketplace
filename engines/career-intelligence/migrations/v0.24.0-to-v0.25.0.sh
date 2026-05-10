#!/usr/bin/env bash
# Migration v0.24.0 → v0.25.0
#
# Task substrate cutover. Tasks.md is DEPRECATED. Skills now read/write
# tasks via GitHub Issues at thewhyman/anand-career-os (canonical single
# inbox for all Cyborg work). Repo of work indicated by `repo:*` label;
# cadence by `cadence:*` (operational/strategic/meta); tier by `tier:*`
# (p1/p2/p3/backlog).
#
# Skills updated in this version:
#   - mission-control       (read-only on tasks; renders dashboard from gh)
#   - apply-tracker         (opens kind:waiting-on / kind:prep / kind:offer-eval)
#   - cruise-control        (executes from tier:p1 first, then tier:p2)
#   - pipeline-sync         (reconciles Pipeline ↔ Tracker ↔ open issues)
#   - outreach-composer     (opens kind:follow-up nudges)
#   - job-search-scheduler  (opens kind:scan-result per new role)
#   - network-intelligence  (read-only on tasks)
#
# This migration is a version stamp + advisory — there are NO data
# transformations to perform on the user's .career-os/ workspace.
# Existing entries in .career-os/tasks/Tasks.md are NOT auto-migrated;
# skills start writing fresh to GitHub Issues going forward. If the user
# wants to bulk-import existing operational items, a separate migration
# helper can be authored later — for now, ship-fast / fail-fast: skills
# operate on the new substrate from this commit forward, and stragglers
# get re-discovered as conditions surface them.

set -euo pipefail

CONTEXT_DIR="${1:-.}"
mkdir -p "$CONTEXT_DIR/.career-os/config"
echo "0.25.0" > "$CONTEXT_DIR/.career-os/config/version"

echo "✅ Migration v0.24.0 → v0.25.0 complete (task substrate → GitHub Issues)."
echo ""
echo "What changed in v0.25.0:"
echo "  • TASK SUBSTRATE: .career-os/tasks/Tasks.md → GitHub Issues at"
echo "    thewhyman/anand-career-os (canonical single inbox for all Cyborg work)."
echo "  • Skills now read via 'gh issue list' and write via 'gh issue create' /"
echo "    'gh issue close'. github-mcp MCP server is the structured fallback."
echo "  • Issue labeling: tier:p1|p2|p3|backlog · cadence:operational|strategic|meta"
echo "    · repo:anand-career-os · kind:waiting-on|prep|offer-eval|verify|follow-up|scan-result"
echo ""

# Advisory: warn if user has Tasks.md content that won't auto-migrate.
if [[ -f "$CONTEXT_DIR/.career-os/tasks/Tasks.md" ]]; then
  TASK_LINES=$(grep -c '^\s*-\s\|^###\s' "$CONTEXT_DIR/.career-os/tasks/Tasks.md" 2>/dev/null || echo 0)
  if (( TASK_LINES > 0 )); then
    echo "⚠️  Detected legacy task list: .career-os/tasks/Tasks.md ($TASK_LINES items)"
    echo "   v0.25.0 skills no longer write here. Existing items remain readable but"
    echo "   will not be picked up by mission-control / cruise-control / pipeline-sync."
    echo ""
    echo "   To bulk-import operational items into GitHub:"
    echo "     gh repo view thewhyman/anand-career-os --json url   # confirm repo exists"
    echo "     # then run a one-off importer (not bundled — author per-need):"
    echo "     # for each typed work item, gh issue create --label 'tier:p3,cadence:operational,repo:anand-career-os,kind:waiting-on'"
    echo ""
    echo "   Or leave Tasks.md as-is for historical reference and let skills"
    echo "   re-discover open work as conditions surface (apply events, scan results,"
    echo "   pipeline reconciliations)."
    echo ""
  fi
fi

# Smoke-check that gh is installed and authenticated — this is the new substrate.
if ! command -v gh >/dev/null 2>&1; then
  echo "⚠️  'gh' CLI not found in PATH. Skills require gh for task substrate access."
  echo "   Install: https://cli.github.com  (or 'brew install gh' on macOS dev box;"
  echo "   future Docker-based shipping will bundle it per the P3 portability rule)."
  echo ""
elif ! gh auth status >/dev/null 2>&1; then
  echo "⚠️  'gh' is installed but not authenticated."
  echo "   Run: gh auth login   (select GitHub.com, HTTPS, web auth)"
  echo "   Skills will fail-fast on first task-write until this is resolved."
  echo ""
else
  echo "✅ gh CLI installed + authenticated — task substrate ready."
  echo ""
fi

echo "Task-routing reference:"
echo "  • Workspace manifest: ~/anand-career-os/workspace.manifest.yaml → task_routing:"
echo "  • Issue inbox:        https://github.com/thewhyman/anand-career-os/issues"
echo "  • CLI quick scan:     gh issue list --repo thewhyman/anand-career-os --state open"
echo ""
echo "Marketplace:"
echo "  • Canonical install: /plugin marketplace add thewhyman/agent-marketplace"
echo "                        /plugin install career-os@thewhyman"
