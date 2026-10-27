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
            "command": "bun ${CLAUDE_PLUGIN_ROOT}/rules/cost-routing-gate/handler.ts"
          }
        ]
      }
    ]
  }
}
```

⚠️ **If the hook never fires, `bun` is probably not on the PATH hooks run with.** Hooks
do not always inherit an interactive shell's PATH, and a `command` that does not resolve
fails silently — the gate simply never runs and nothing reports it.

Find your own absolute path:

```bash
command -v bun
```

and use that value in place of `bun` above — **single-quoted**, because a home directory
with a space in it (`/Users/Jane Doe/.bun/bin/bun`) otherwise splits into two words and the
hook executes `/Users/Jane`:

Replace **only** the `"command"` line in the block above with this one (it is a fragment,
not a whole document — a `json` fence here would be a snippet that does not parse, which is
the mistake this file is already about):

```text
"command": "'/absolute/path/to/bun' ${CLAUDE_PLUGIN_ROOT}/rules/cost-routing-gate/handler.ts"
```

Single quotes need no JSON escaping inside the double-quoted value. They do **not** survive
an apostrophe in the path itself (`/Users/O'Brien/.bun/bin/bun`), and quoting your way out of
that inside JSON is not worth the footgun: make a symlink at a plain path and point the hook
there instead.

```bash
ln -sf "$(command -v bun)" ~/.local/bin/bun-for-hooks
```

Note the path is one **on your machine**: the
literal that used to be here was a maintainer's home directory, which is why this gate was
dead for everyone else.

Writing `$(command -v bun)` into the JSON instead does not solve anything, even where the
substitution does expand: `command -v` is itself a PATH lookup, so it fails in exactly the
case you are trying to fix. Resolve it **once, yourself**, and paste the result.

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
printf '%s\n' "$payload" | bun ${CLAUDE_PLUGIN_ROOT}/rules/cost-routing-gate/handler.ts
echo "expected BLOCK exit=1 actual=$?"

printf '%s\n' "$payload" | env COST_ROUTING_GATE_OFF=1 bun ${CLAUDE_PLUGIN_ROOT}/rules/cost-routing-gate/handler.ts
echo "expected PASS exit=0 actual=$?"

rm -f "$marker"
rm -rf "$tmp"
```
