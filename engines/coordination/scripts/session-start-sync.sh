#!/bin/bash
# brain-multi-session-sync — xOS Coordination engine, session-start hook
#
# Pulls the workspace's git-backed brain state and cats the status file.
# Output goes to stdout → waky-waky ingests it as Tier 1.5 context.
# Works across local Claude, cloud Claude, Cursor, Codex — any session
# sharing a git-backed workspace root.
#
# Config source: ~/.codialectic/context.json
#   workspace_root              — absolute path to the git workspace (required)
#   coordination_status_rel_path — relative path to status file within workspace
#                                  (default: AGENT_STATUS.yaml)

CONTEXT_FILE="$HOME/.codialectic/context.json"

if [ ! -f "$CONTEXT_FILE" ]; then
  echo "⚠ brain-multi-session-sync: ~/.codialectic/context.json not found — skipping sync" >&2
  exit 0
fi

WORKSPACE=$(python3 -c "
import json, sys
try:
    d = json.load(open('$CONTEXT_FILE'))
    print(d.get('workspace_root', ''))
except Exception as e:
    print('', file=sys.stderr)
" 2>/dev/null)

if [ -z "$WORKSPACE" ]; then
  echo "⚠ brain-multi-session-sync: workspace_root not set in context.json — skipping sync" >&2
  exit 0
fi

STATUS_REL=$(python3 -c "
import json
d = json.load(open('$CONTEXT_FILE'))
print(d.get('coordination_status_rel_path', 'AGENT_STATUS.yaml'))
" 2>/dev/null)

STATUS_REL="${STATUS_REL:-AGENT_STATUS.yaml}"

# Pull quietly; surface pull errors as warnings but don't block
git -C "$WORKSPACE" pull --ff-only origin main --quiet 2>&1 | \
  grep -v "^Already up to date" | \
  while read -r line; do echo "⚠ brain-multi-session-sync: $line" >&2; done

STATUS_FILE="$WORKSPACE/$STATUS_REL"
if [ -f "$STATUS_FILE" ]; then
  cat "$STATUS_FILE"
else
  echo "⚠ brain-multi-session-sync: $STATUS_FILE not found" >&2
fi
