# /xos:swarm-sync — sync this agent with the swarm (both directions)

Bring the current agent into sync with the shared swarm state. Two duties, in order:
**PUBLISH** (write your state/work out so other agents see it), then **CATCH UP** (read
everyone else's latest in). Run at the start of significant work, after shipping, or when
told a swarm update landed.

This is the P15 git-native loop (commit → push → pull) plus plugin freshness. It is
gate-aware: a clean `~/cyborg` fast-forward pull is allowed; any *mutating* `~/cyborg` op
(restore, worktree, branch -d) is surfaced to the human as a `!` command, never forced.

---

## Phase 1 — PUBLISH (write: push my state to the swarm)

1. **Commit pending unit-of-work** in the current workspace (any file write / decision /
   artifact this session produced that isn't committed). Use the repo's GIT-NATIVE flow —
   commit on a feature branch → ff-merge main → push, OR `push origin HEAD:main`. (The
   session-logger usually commits each turn; this just guarantees nothing is left behind.)
2. **Push** the workspace to `origin/main`.
3. **(Optional) status beacon** — if this agent's work matters to others, add/update its
   entry (or a `global_facts` line) in `~/anand-career-os/AGENT_STATUS.yaml`
   (`last_update`, `current_task`) and push, so the swarm sees your state on their next sync.

## Phase 2 — CATCH UP (read: pull the swarm's latest in)

1. **Cyborg brain** — `git -C ~/cyborg pull --ff-only origin main`
   (the worktree-isolation gate allows clean ff-pull). If git aborts on a dirty tree, the
   blocking file is usually a redundant local dup → surface to the human (restore is a
   *mutating* op the agent can't run on the shared primary):
   `! git -C ~/cyborg restore <file> && git -C ~/cyborg pull --ff-only origin main`
2. **Workspace** — `git -C ~/anand-career-os pull --ff-only origin main` (or `--rebase` if ahead).
3. **Plugins** — sync the marketplace clone, then update:
   `git -C ~/.claude/plugins/marketplaces/xos pull --ff-only origin main`
   `claude plugin install co-dialectic@xos --scope user`
   (add `career-intelligence@xos`, `super-developer@xos`, `xos@xos`, etc. if you use them).
4. **Reload** — run `/reload-plugins` so this running session loads the new plugin cache.
   (Cyborg gate scripts are re-read on every hook fire — already live; no reload needed for those.)

## Phase 3 — REPORT

Print a 6-second-scan summary:
- **Published:** commits pushed (repo @ short-SHA), any status beacon written.
- **Caught up:** cyborg HEAD (short-SHA), plugin versions now installed (e.g. co-dialectic 4.24.5).
- **Needs you:** any `!` command the human must run (dirty-tree restore, cross-machine pull).

---

## Notes

- **Same-machine sessions share `~/cyborg` + the plugin cache.** If another session already
  pulled/installed, Phase 2 is mostly a no-op and you only need `/reload-plugins` for plugins.
- **Different-machine sessions** run the full Phase 2 (each machine has its own checkout + cache).
- **OAuth-only:** never set LLM API keys; `claude plugin install` and the CLIs use the user's subscriptions.
- **Don't force the primary:** never bypass the worktree-isolation gate — surface mutating
  `~/cyborg` ops as `!` commands for the human.
