---
description: Bidirectional swarm sync — publish this agent's state, then catch up to the latest cyborg brain + plugins. Run at the start of significant work, after shipping, or when told a swarm update landed.
---

# /xos:swarm-sync — sync this agent with the swarm (both directions)

Bring the current agent into sync with the shared swarm state. Two duties, in order:
**PUBLISH** (write your state/work out so other agents see it), then **CATCH UP** (read
everyone else's latest in). Run at the start of significant work, after shipping, or when
told a swarm update landed.

This is the P15 git-native loop (commit → push → pull) plus plugin freshness. It is
gate-aware: a clean `$CYBORG_ROOT` fast-forward pull is allowed; any *mutating* op there
(restore, worktree, branch -d) is surfaced to the human as a `!` command, never forced.

---

## The two paths this command needs

Both are **per-install**, and this command used to hardcode one maintainer's.

| var | what it points at | required? |
| --- | --- | --- |
| `$CYBORG_ROOT` | the shared brain/substrate repo every agent pulls | optional — its step is SKIPPED and reported |
| `$WORKSPACE_ROOT` | this agent's own workspace repo | required — resolved, or this command ABORTS |

**Resolve both to a repo ROOT before running anything.** Two traps, both real:

- An **empty** value is not an error to git. `git -C "" pull` does not fail — it runs in the
  **current directory**, turning "pulls a directory that does not exist" into "pulls the
  wrong repo".
- `rev-parse` **searches ancestors**. Point a variable at any subdirectory inside some
  other checkout and a bare "is this a repo?" test says yes, then pulls the enclosing
  repository. Resolve to the toplevel, use *that*, and **say so when it differs from what
  was configured** — a silent switch of target is the whole hazard. Both variables get the
  same treatment; a trailing slash is not treated as a difference.

Do not test for a `.git` **directory** either: in a linked worktree `.git` is a FILE, so
`[ -d "$X/.git" ]` is false — and this workflow REQUIRES per-session worktrees, so that
test would abort in precisely the setup it mandates.

```bash
# Resolve $2 to its repo ROOT, echo it, and report on stderr if that differs
# from what was configured. BOTH variables go through this -- a silent switch to
# an ancestor repository is the hazard, and it is no less a hazard for the
# workspace than for the brain.
resolve_root() {                       # $1 = var name (for messages), $2 = path
  # Canonicalize BOTH sides the same way, physically rather than by string.
  # String comparison was wrong twice: it stripped a trailing slash on one side
  # only (so a root of "/" compared "" against "/"), and it left a relative path
  # like "." unequal to the absolute root git reports. Both printed a resolution
  # NOTE for a resolution that had not happened.
  _canon() { (cd "$1" 2>/dev/null && pwd -P); }
  _in="$(_canon "$2")"
  [ -n "$_in" ] || return 1
  _out="$(git -C "$2" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [ -n "$_out" ] || return 1
  _outc="$(_canon "$_out")"
  [ "${_outc:-$_out}" = "$_in" ] || echo "NOTE: $1 resolved to its repo root: $_out" >&2
  printf '%s\n' "$_out"
}

# $WORKSPACE_ROOT: required. Resolve, or stop.
WORKSPACE_ROOT="$(resolve_root WORKSPACE_ROOT "${WORKSPACE_ROOT:-$PWD}")" || {
  echo "ABORT: no workspace repo. Set WORKSPACE_ROOT, or run from inside one." >&2
  exit 1
}

# $CYBORG_ROOT: optional, but its absence is REPORTED, never silent.
HAVE_CYBORG=0
if [ -n "${CYBORG_ROOT:-}" ]; then
  if _resolved="$(resolve_root CYBORG_ROOT "$CYBORG_ROOT")"; then
    CYBORG_ROOT="$_resolved"; HAVE_CYBORG=1
  else
    echo "NOTE: CYBORG_ROOT=$CYBORG_ROOT is not inside a git repo — skipping the brain pull." >&2
  fi
else
  echo "NOTE: CYBORG_ROOT unset — skipping the brain pull." >&2
fi
[ "$HAVE_CYBORG" = 1 ] || echo "      This sync is PARTIAL. Set CYBORG_ROOT to make it complete." >&2
```

⚠️ **Report the skip in your summary to the user, not only to stderr.** The worst
outcome of this command is a run that pulled nothing and said "synced" — an agent that
believes it is synced will not sync again. Say *partial* when it was partial.

---

## Phase 1 — PUBLISH (write: push my state to the swarm)

1. **Commit pending unit-of-work** in the current workspace (any file write / decision /
   artifact this session produced that isn't committed). Use the repo's GIT-NATIVE flow —
   commit on a feature branch → ff-merge main → push, OR `push origin HEAD:main`. (The
   session-logger usually commits each turn; this just guarantees nothing is left behind.)
2. **Push** the workspace to `origin/main`.
3. **(Optional) status beacon** — if this agent's work matters to others, add/update its
   entry (or a `global_facts` line) in `$WORKSPACE_ROOT/AGENT_STATUS.yaml`
   (`last_update`, `current_task`) and push, so the swarm sees your state on their next sync.

## Phase 2 — CATCH UP (read: pull the swarm's latest in)

1. **Cyborg brain** — only when `HAVE_CYBORG=1` (see above); otherwise skip.
   Use an `if`, not `[ ... ] && ...`: the `&&` form exits **1** on the skip path, so a
   script or CI step that ends on it reports failure for a skip you documented as normal.

   ```bash
   if [ "$HAVE_CYBORG" = 1 ]; then
     git -C "$CYBORG_ROOT" pull --ff-only origin main
   fi
   ```
   (the worktree-isolation gate allows clean ff-pull). If git aborts on a dirty tree, the
   blocking file is usually a redundant local dup → surface to the human (restore is a
   *mutating* op the agent can't run on the shared primary):
   `! git -C "$CYBORG_ROOT" restore <file> && git -C "$CYBORG_ROOT" pull --ff-only origin main`
2. **Workspace** — `git -C "$WORKSPACE_ROOT" pull --ff-only origin main` (or `--rebase` if ahead).
3. **Plugins** — sync the marketplace clone, then update:
   `git -C ~/.claude/plugins/marketplaces/xos pull --ff-only origin main`
   `claude plugin install co-dialectic@xos --scope user`
   (add `career-intelligence@xos`, `exponential-developer@xos`, `xos@xos`, etc. if you use them).
4. **Reload** — run `/reload-plugins` so this running session loads the new plugin cache.
   (Cyborg gate scripts are re-read on every hook fire — already live; no reload needed for those.)

## Phase 3 — REPORT

Print a 6-second-scan summary:
- **Published:** commits pushed (repo @ short-SHA), any status beacon written.
- **Caught up:** cyborg HEAD (short-SHA), plugin versions now installed (e.g. co-dialectic 4.24.5).
- **Needs you:** any `!` command the human must run (dirty-tree restore, cross-machine pull).

---

## Notes

- **Same-machine sessions share `$CYBORG_ROOT` + the plugin cache.** If another session already
  pulled/installed, Phase 2 is mostly a no-op and you only need `/reload-plugins` for plugins.
- **Different-machine sessions** run the full Phase 2 (each machine has its own checkout + cache).
- **OAuth-only:** never set LLM API keys; `claude plugin install` and the CLIs use the user's subscriptions.
- **Don't force the primary:** never bypass the worktree-isolation gate — surface mutating
  `$CYBORG_ROOT` ops as `!` commands for the human.
