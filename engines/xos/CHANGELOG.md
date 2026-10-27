# Changelog — xos

## [0.1.2] — 2026-10-26 — `/xos:swarm-sync` named two repos that exist on one machine

`commands/swarm-sync.md` is a shipped command, and it hardcoded `~/cyborg` and
`~/anand-career-os` in seven places — including both `git pull` targets of its
entire CATCH UP phase.

On anyone else's machine those directories do not exist, so the command's one
job (pull the swarm's latest in) silently did nothing and then reported a
successful sync. That is worse than failing: an agent that believes it is
synced skips the real sync.

Both are `$CYBORG_ROOT` / `$WORKSPACE_ROOT` now, with a short table at the top
saying what each points at and what to do when it is unset. **A missing
`$CYBORG_ROOT` must be reported, not skipped** — the whole point is that a sync
which pulled nothing cannot be allowed to look like one that worked.
`$WORKSPACE_ROOT` falls back to the current repo root, which is almost always
right.

Found by `plugin-product-ship-gate` during the XOS-353 sweep. Note the gate only
flagged **one** of the seven: its I1 patterns catch `~/anand…` but not `~/cyborg`,
and its file scope is `SKILL.md`/`plugin.json`/`hooks.json`/`*.sh`, which does not
include `commands/*.md`. The other six came from reading the file. Both gaps are
XOS-357.

### Three passes of a cross-family panel on a docs-only change

Worth recording, because "it is only documentation" is exactly why nobody looks:

- The first replacement was **worse than the bug**. With `$CYBORG_ROOT` unset,
  `git -C "$CYBORG_ROOT" pull` expands to an empty path and git runs in the
  **current directory** — so "pulls a directory that does not exist" became
  "pulls whatever repo you happen to be standing in".
- The guard added to fix that used `[ -d "$X/.git" ]`, which is **false in a
  linked worktree** (there `.git` is a file). It would have aborted in exactly
  the per-session worktrees this workflow requires.
- The replacement for *that* used `rev-parse --git-dir`, which **searches
  ancestors** — so pointing the variable at any subdirectory inside some other
  checkout passed the test and then pulled the enclosing repository.

- And the fix for *that* reported a silent re-resolve for `$CYBORG_ROOT` only,
  while `$WORKSPACE_ROOT` switched targets without a word — and the changelog
  entry you are reading claimed both did. **An overclaim in the text describing
  the fix**, caught on the pass after the one that caught the code.

Each was found by a judge, not by review, and each was reproduced before being
fixed. The shipped version resolves **both** variables to a repo root with
`rev-parse --show-toplevel`, through one helper, and reports whenever the root it
resolved differs from the value configured (ignoring a trailing slash). Verified by **executing** the documented snippet across six
cases (worktree, outside any repo, root, nested subdir, non-repo, empty string),
not by reading it.

### Version note

The source tree said `0.1.0` while the marketplace shipped `0.1.1` — a vendor
that moved the catalog number without landing a source bump. Going to `0.1.2`
rather than reusing `0.1.1`, so no two artifacts ever claim that version with
different contents.
