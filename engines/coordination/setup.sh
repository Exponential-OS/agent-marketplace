#!/bin/bash
# xOS Coordination engine — setup.sh
# Run once after install, and again after each upgrade.
#
# What it does:
#   1. Copies session-start-sync.sh to ~/.codialectic/coordination/ (stable path)
#   2. Registers the hook in ~/.codialectic/hooks/session_start.json
#      (merges into existing hooks file; does not overwrite other hooks)
#
# Usage:
#   bash ~/.claude/plugins/cache/xos/coordination/0.1.0/setup.sh
#
# Prerequisites:
#   - ~/.codialectic/context.json must exist with workspace_root set
#   - co-dialectic must be installed (provides the hooks contract)

set -euo pipefail

STABLE_DIR="$HOME/.codialectic/coordination"
HOOKS_FILE="$HOME/.codialectic/hooks/session_start.json"
SCRIPT_SRC="$(dirname "$0")/scripts/session-start-sync.sh"
SCRIPT_DEST="$STABLE_DIR/session-start-sync.sh"
HOOK_NAME="coordination-sync"

mkdir -p "$STABLE_DIR" "$(dirname "$HOOKS_FILE")"

# Copy hook script to stable path (version-agnostic; survives plugin upgrades)
cp "$SCRIPT_SRC" "$SCRIPT_DEST"
chmod +x "$SCRIPT_DEST"
echo "✓ Installed: $SCRIPT_DEST"

# Merge into hooks file — add if not present, skip if already registered
if [ -f "$HOOKS_FILE" ]; then
  ALREADY=$(python3 -c "
import json, sys
d = json.load(open('$HOOKS_FILE'))
print('yes' if any(h.get('name') == '$HOOK_NAME' for h in d.get('hooks', [])) else 'no')
" 2>/dev/null)

  if [ "$ALREADY" = "yes" ]; then
    echo "✓ Hook '$HOOK_NAME' already registered in $HOOKS_FILE"
    echo "  (re-run setup.sh after upgrade to refresh the script at stable path)"
    exit 0
  fi

  python3 -c "
import json, os
with open('$HOOKS_FILE') as f:
    d = json.load(f)
d.setdefault('hooks', []).append({
    'name': '$HOOK_NAME',
    'command': 'bash',
    'args': ['$SCRIPT_DEST'],
    'required': False,
    'timeout_seconds': 15
})
with open('$HOOKS_FILE', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
print('✓ Hook registered: $HOOKS_FILE')
"
else
  python3 -c "
import json, os
d = {'hooks': [{'name': '$HOOK_NAME', 'command': 'bash', 'args': ['$SCRIPT_DEST'], 'required': False, 'timeout_seconds': 15}]}
with open('$HOOKS_FILE', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
print('✓ Created: $HOOKS_FILE')
"
fi

echo ""
echo "brain-multi-session-sync is active."
echo "On each session start, waky-waky will pull your workspace and surface agent state as Tier 1.5 context."
echo ""
echo "Next step: ensure ~/.codialectic/context.json has workspace_root set."
echo "  Optional: set coordination_status_rel_path (default: AGENT_STATUS.yaml)"
