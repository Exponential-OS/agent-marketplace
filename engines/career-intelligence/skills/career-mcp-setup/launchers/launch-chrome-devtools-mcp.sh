#!/usr/bin/env bash
# launch-chrome-devtools-mcp.sh
# Boots Chrome (or Canary if available) with remote-debugging on port 9222 +
# a persistent profile dir. The chrome-devtools-mcp connects via http://localhost:9222.
#
# Idempotent: if port 9222 is already listening, exits cleanly (assumes Chrome already up).
#
# macOS + Linux supported. Persistent profile = LinkedIn / Substack / etc. auth sessions
# survive across launches.

set -euo pipefail

PROFILE_DIR="${CHROME_DEVTOOLS_MCP_PROFILE:-${HOME}/.codialectic/chrome-mcp-profile}"
PORT="${CHROME_DEVTOOLS_MCP_PORT:-9222}"

# Already running? Don't double-launch.
if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Chrome MCP browser already running on port ${PORT}"
  exit 0
fi

mkdir -p "${PROFILE_DIR}"

# Detect Chrome binary — Canary > regular Chrome > Chromium
if [[ "$(uname)" == "Darwin" ]]; then
  CANDIDATES=(
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )
elif [[ "$(uname)" == "Linux" ]]; then
  CANDIDATES=(
    "/usr/bin/google-chrome-unstable"
    "/usr/bin/google-chrome"
    "/usr/bin/chromium-browser"
    "/usr/bin/chromium"
  )
else
  echo "Unsupported OS: $(uname)" >&2
  exit 1
fi

CHROME_BIN=""
for c in "${CANDIDATES[@]}"; do
  if [[ -x "$c" ]]; then CHROME_BIN="$c"; break; fi
done

if [[ -z "$CHROME_BIN" ]]; then
  echo "❌ No Chrome binary found. Install Chrome Canary (recommended) or regular Chrome." >&2
  echo "   macOS: https://www.google.com/chrome/canary/" >&2
  exit 1
fi

# Launch detached in background
nohup "$CHROME_BIN" \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${PROFILE_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  >/dev/null 2>&1 &

# Wait briefly for port to come up
for i in 1 2 3 4 5; do
  sleep 1
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✓ Chrome MCP browser up on port ${PORT}"
    echo "  Profile: ${PROFILE_DIR}"
    echo "  Binary:  ${CHROME_BIN}"
    exit 0
  fi
done

echo "⚠ Chrome launched but port ${PORT} not yet listening. Check logs." >&2
exit 0
