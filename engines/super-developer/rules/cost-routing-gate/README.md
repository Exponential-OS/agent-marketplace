# cost-routing-gate

`cost-routing-gate` is a PreToolUse Edit/Write/Bash rule for `/ship-feature`. It only acts when `~/.ship-feature/active/*.json` contains a fresh marker (`heartbeat` less than 30 minutes old) with an existing `worktree`, `cwd`, or `repo` scope.

Inside that live worktree:

- Edit/Write to `docs/**` and `*.md` PASS.
- Edit/Write to source/config files BLOCK and route to `codex exec`.
- Conservative deploy/poll-loop Bash BLOCKs and routes to `claude --model haiku -p`.
- No fresh marker, stale markers, missing cwd, unscopable markers, unrelated worktrees, ordinary Bash, crashes, and `COST_ROUTING_GATE_OFF=1` PASS/fail open.

## ~/.claude/settings.json wiring

Do not commit this machine-local wiring. Add it to `~/.claude/settings.json` when activating the gate:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/anandvallam/.bun/bin/bun /Users/anandvallam/aiprojects/super-developer-plugin/rules/cost-routing-gate/handler.ts"
          }
        ]
      }
    ]
  }
}
```

## Verify teeth

```bash
set +e
tmp="$(mktemp -d)"
marker="$HOME/.ship-feature/active/cost-routing-gate-verify.json"
mkdir -p "$tmp/src" "$HOME/.ship-feature/active"

cat > "$marker" <<EOF
{
  "ticket": "XOS-206",
  "session": "cost-routing-gate-verify",
  "heartbeat": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "worktree": "$tmp"
}
EOF

payload="{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$tmp/src/app.ts\"},\"cwd\":\"$tmp\"}"
printf '%s\n' "$payload" | /Users/anandvallam/.bun/bin/bun /Users/anandvallam/aiprojects/super-developer-plugin/rules/cost-routing-gate/handler.ts
echo "expected BLOCK exit=1 actual=$?"

printf '%s\n' "$payload" | env COST_ROUTING_GATE_OFF=1 /Users/anandvallam/.bun/bin/bun /Users/anandvallam/aiprojects/super-developer-plugin/rules/cost-routing-gate/handler.ts
echo "expected PASS exit=0 actual=$?"

rm -f "$marker"
rm -rf "$tmp"
```
