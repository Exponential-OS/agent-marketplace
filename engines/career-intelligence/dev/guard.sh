#!/usr/bin/env bash
# guard.sh — Directory guard for dev skills
# Usage: bash dev/guard.sh <required-dir> <skill-name>
#   required-dir: "plugin" or "home"
#   skill-name: name shown in error message
#
# Exit 0 = correct directory, Exit 1 = wrong directory (prints guidance)

set -euo pipefail

REQUIRED="${1:-}"
SKILL="${2:-dev skill}"

if [ -z "$REQUIRED" ]; then
    echo "Usage: bash dev/guard.sh <plugin|home> <skill-name>"
    exit 1
fi

case "$REQUIRED" in
    plugin)
        if [ -f "hooks/hooks.json" ] || [ -f ".claude-plugin/plugin.json" ]; then
            exit 0
        fi
        echo "STOP: '$SKILL' must run from the plugin repo (\$CAREER_OS_PLUGIN)."
        echo ""
        echo "  Current directory: $(pwd)"
        echo "  Expected: $CAREER_OS_PLUGIN"
        echo ""
        echo "  Cowork:  Open a session with \$CAREER_OS_PLUGIN as the context folder"
        echo "  Code:    cd $CAREER_OS_PLUGIN && claude"
        echo "  CLI:     cd $CAREER_OS_PLUGIN && claude -p \"$SKILL\""
        exit 1
        ;;
    home)
        if [ -d ".career-os" ] || [ -f "NEXT_SESSION_HANDOFF.md" ]; then
            exit 0
        fi
        echo "STOP: '$SKILL' must run from the career workspace (\$CAREER_HOME)."
        echo ""
        echo "  Current directory: $(pwd)"
        echo "  Expected: $CAREER_HOME"
        echo ""
        echo "  Cowork:  Open a session with \$CAREER_HOME as the context folder"
        echo "  Code:    cd $CAREER_HOME && claude"
        echo "  CLI:     cd $CAREER_HOME && claude -p \"$SKILL\""
        exit 1
        ;;
    *)
        echo "Unknown directory type: $REQUIRED (expected 'plugin' or 'home')"
        exit 1
        ;;
esac
