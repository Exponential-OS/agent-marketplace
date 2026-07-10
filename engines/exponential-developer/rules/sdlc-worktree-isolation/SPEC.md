# SPEC — sdlc-worktree-isolation (XOS-43)

## Problem (observed 2026-06-09)
Two interactive sessions both ran mutating git operations against the SAME primary checkout
(one HEAD/one index). Result: bilateral data loss — one session's CONSTITUTION.md
edit was reverted by the other's `git checkout`; a live `.git/index.lock` race blocked staging.

Superset already isolates the *task* repo (`anand-career-os` has 7 per-session worktrees).
The gap is the SHARED brain/infra repo, which has only its primary checkout — every
session reaches into it directly. `sdlc-work-claim` coordinates *tickets*; this coordinates the
*filesystem*.

## The invariant (already in CONSTITUTION.md, SDLC WORK-CLAIM companion clause)
> Each session/machine MUST work in its OWN worktree/clone, never a shared checkout.

## Deliverable: a PreToolUse Bash hook + reusable handler (living-code triad)

### 1. handler.ts (core, canonical, Bun, executable)
Input JSON: `{ "command": "<bash string>", "cwd": "<abs path>" }`
Logic:
  - Identify whether `command` is a MUTATING git op against a DESIGNATED SHARED repo.
    - Mutating git subcommands: commit, add, merge, rebase, reset, rm, mv, stash (push/pop/apply),
      checkout -b, checkout (branch switch), switch, cherry-pick, apply, restore --staged, tag -d, push.
    - Read-only (ALWAYS PASS): status, log, diff, show, fetch, `pull --ff-only`, branch (list), branch -a,
      worktree (any), rev-parse, ls-files, ls-tree, cat-file, blame, remote -v, config --get.
  - Determine the TARGET repo + working dir:
    - If `git -C <path>` present → target = realpath(<path>).
    - Else → target = realpath(cwd).
  - DESIGNATED SHARED repos (config, see manifest `shared_repos`): plugin installs may configure this; otherwise the handler defaults to the user's home `cyborg` checkout.
    Expand ~ to homedir. A repo is "shared-primary" when target's toplevel == the repo's PRIMARY
    worktree (the first entry of `git -C <repo> worktree list --porcelain`, i.e. the main checkout),
    NOT a linked worktree under `.git/worktrees/`.
  - VERDICT:
    - BLOCK (exit 1) if: mutating git op AND target is the PRIMARY checkout of a designated shared repo.
    - PASS (exit 0) otherwise (read-only, non-shared repo, or a linked worktree of a shared repo).
  - Detection of primary-vs-linked: in a linked worktree, `git rev-parse --git-dir` resolves under
    `.git/worktrees/<name>`; in the primary it's `<repo>/.git`. Equivalent: compare
    realpath(toplevel) to realpath(primary-worktree-path from `worktree list --porcelain` line 1).
  - Output JSON: `{verdict, target, reason, message}` where message on BLOCK includes WHAT + HOW:
    WHAT: "mutating git op against the SHARED primary checkout <repo> — concurrent sessions collide here."
    HOW: "Use a per-session worktree:  git -C <repo> worktree add /tmp/<repo-name>-<task> -b <branch> origin/main
          then run git ops with -C /tmp/<repo-name>-<task> and push HEAD:main. See SDLC WORK-CLAIM INVARIANT."
  - FAIL-HARD: BLOCK exits non-zero. Log every invocation to ~/.cyborg-enforcement-log.jsonl
    (slug, verdict, target, ts).

### 2. The hook wiring (PreToolUse on Bash)
A thin entry that the Claude Code PreToolUse-Bash hook calls, passing the tool's command + cwd,
and maps handler BLOCK → hook deny (non-zero / deny JSON). Follow the existing pattern used by
other cyborg PreToolUse hooks (look at how named-person-claim-grounding wires Write/Edit, and the
existing cd+git-antipattern Bash hook already active in this environment — mirror its deny shape).
Keep the load-bearing code in TypeScript (NO-SHELL-IN-RULES-TREE invariant); the hook glue may be
the minimal shell the harness requires, living OUTSIDE rules/<slug>/ if a shell entry is mandated.

### 3. AUDIT.ts — source-check handler invariants (BLOCK exits non-zero; mutating-verb list present;
   read-only allowlist present; shared_repos config read) + log summary. Exit 1 if a source invariant regressed.

### 4. WATCH.ts — keep/kill/modify: run tests; check the hook is registered; check the configured shared repo still has
   only its primary worktree shared (if every session got its own worktree, the rule's premise changed).

### 5. tests.ts (bun test) — synthetic, no real mutation:
   - BLOCK: `git -C <shared-repo> commit -m x` from a non-worktree cwd.
   - BLOCK: bare `git commit` with cwd = shared primary.
   - PASS: `git -C /tmp/cyborg-xyz commit` (linked worktree).
   - PASS: `git -C <shared-repo> status` (read-only) and `git -C <shared-repo> worktree add ...`.
   - PASS: `git -C ~/aiprojects/foo commit` (non-designated repo).
   - PASS: `git -C <shared-repo> fetch` / `pull --ff-only`.
   (Stub the worktree-list resolution so tests don't depend on machine state.)

### 6. manifest.json — full schema (match named-person-claim-grounding): name, slug, version 1.0.0,
   status active, created 2026-06-09, enforcement{how,audit,watch,log,runtime,no_bash_in_load_bearing_paths},
   hook_type PreToolUse, hook_target_tools [Bash], cadence per-bash-tool-call, litmus, dispatch_slug,
   shared_repos array, related_invariant "SDLC WORK-CLAIM / GIT-NATIVE COORDINATION".

### 7. BUGFIX (separate, in rules/sdlc-work-claim/handler.ts): BLOCK currently exits 0.
   FAIL-HARD requires non-zero on BLOCK. Make processInput's CLI entrypoint exit(1) when verdict==BLOCK,
   exit(0) on PASS. Add a regression test to sdlc-work-claim/tests.ts.

## Out of scope
- anand-career-os (Superset already isolates per session).
- Auto-provisioning worktrees (the hook BLOCKS + instructs; auto-provision is a later enhancement).
