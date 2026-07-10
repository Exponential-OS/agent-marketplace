# xdev — fast-invoke short-code for exponential-developer

`xdev` is the **short-code fast-invoke wrapper** for the `exponential-developer` product (the
Agentic SDLC pipeline). It exists so the daily-driver command is fast to type:

| Form | Command | Use |
|---|---|---|
| Fast (short-code) | `/xdev:ship` | what you type every day |
| Full (discoverable) | `/exponential-developer:ship-feature` | typing `exponential-developer:` reveals all features |

Both resolve to the **same** pipeline. This wrapper holds **no copy** of it: `commands/ship.md` is a
one-line namespace delegator that invokes the `exponential-developer:ship-feature` skill (the single
source of truth). See [`docs/REPO-ARCHITECTURE.md`](../../../docs/REPO-ARCHITECTURE.md) §4a.

## Why a separate plugin (and why not a symlink)

Claude Code scopes every command by the plugin's own `plugin.json` `name` — there is no `short_code`
or alias field, and bare invocation never resolves a plugin command (verified against docs + CLI,
2026-07-09). So the only way to get a `xdev:` scope is a plugin literally named `xdev`.

It delegates by **namespace**, not a symlink. A command symlink would break (`${CLAUDE_PLUGIN_ROOT}`
points at the wrapper's empty root) and symlinking the skill dir would register a duplicate
same-trigger skill. Symlinks are exception-only in this ecosystem (they have caused real damage —
see the config-import-not-symlink invariant).

## Dependency

**Requires `exponential-developer@xos`.** `xdev` is an alias; it delegates to that product's skill.
Install both: `exponential-developer@xos` (the pipeline) and `xdev@xos` (the fast command).

## Pattern for other products

Short-codes are opt-in by typing frequency: `career-intelligence → career`, `brand-intelligence → brand`.
Add a wrapper only where the daily typing earns the extra thin plugin + install (§4a cost note).
