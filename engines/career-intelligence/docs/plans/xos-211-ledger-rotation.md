# XOS-211 (forward-prevention slice) — Ledger day-file rotation/cap so no ledger file exceeds ~40MB

status: design
slug: xos-211-ledger-rotation
ticket: XOS-211
repo: ~/aiprojects/career-intelligence-engine (hooks/scripts/capture-*.sh)

## What
Cap the session-logger's per-day ledger files at a size threshold (~40MB, env-overridable) by **sharding**: when today's active ledger file reaches the threshold, the appender rolls to the next shard (`YYYY-MM-DD.md` → `YYYY-MM-DD.02.md` → `YYYY-MM-DD.03.md` …). Both capture hooks resolve the *active* shard via one shared helper; all readers that consume a day's ledger glob `YYYY-MM-DD*.md` in shard order.

## Why
XOS-211: `brain/sessions/ledger/*.md` day-files grew to 95MB on origin/main (one union-merge from GitHub's 100MB hard-reject that would freeze all pushes to the brain repo). The acceptance criterion is "no ledger file exceeds ~40MB." Today `capture-prompt.sh`/`capture-response.sh` append unconditionally to a single `$TODAY.md` (identical logic in both) with no size bound. This slice removes the unbounded-single-file driver going forward. (The other two drivers — `merge=union` duplication and the existing 25GB `.git` history — are explicitly OUT, see below.)

**Disposition of the EXISTING oversized files (e.g. the 95MB `2026-07-03.md`) — stated explicitly so the ticket-level criterion isn't silently unmet:** this slice does NOT retroactively split already-committed oversized day-files. Two reasons: (1) rewriting a committed 95MB file into shards on the 1008-commit-divergent `xos` branch interacts with `merge=union` + `career-os-daily-squash.yml` in ways that need the same human grooming as the merge-model fix; (2) shrinking the underlying 25GB `.git` blobs requires the gated history rewrite regardless. What this slice DOES for an existing oversized base: the resolver treats a base `$DATE.md` already ≥ threshold as a full shard and rolls NEW appends to `$DATE.02.md`, so the oversized file **stops growing** immediately (removing the "one more append → 100MB freeze" acute risk from new writes). The definitive size reduction of existing files + `.git` is folded into the **gated history-shrink pass** (XOS-211 residual, human-gated). Net: this slice's acceptance is "**no NEWLY-written ledger content causes a file to exceed threshold**," and it neutralizes the append-driven detonation path; the merge-driven path and existing-blob cleanup remain the documented gated follow-ons.

## Scope
- In: new `hooks/scripts/_ledger-path.sh` — a sourced helper exposing `resolve_active_ledger "$LEDGER_DIR" "$DATE"` that echoes the path of the ACTIVE shard to append to:
  - base name `$DATE.md` (= shard 1); subsequent shards `$DATE.NN.md` with zero-padded 2-digit NN starting at `02`. **Ordering is by explicit shard NUMBER, never by naive lexical glob-sort** (see DD2 — `$DATE.02.md` byte-sorts BEFORE `$DATE.md`).
  - active = the highest-numbered existing shard whose size < threshold, where the base `$DATE.md` counts as shard 1 and `$DATE.NN.md` as shard N. **Determine "highest existing" by the MAXIMUM shard number among all existing `$DATE(.NN)?.md` files — tolerate gaps** (if `$DATE.md` and `$DATE.03.md` exist but `.02` is missing, max = 3; never stop at the first missing NN). If that highest shard is ≥ threshold, roll to `max+1` (a fresh shard — which may fill a prior gap number or extend past it; correctness only needs a monotonically-usable next number, so `max+1` is safe). If no file exists, base `$DATE.md`.
  - threshold: `CAREER_OS_LEDGER_MAX_BYTES` env, default `41943040` (40 MiB).
  - pure path resolution + `stat` size check; no writes of content (caller still writes the header + append).
- In: `hooks/scripts/capture-prompt.sh` + `hooks/scripts/capture-response.sh` — source `_ledger-path.sh`; replace the hardcoded `LEDGER_FILE="$LEDGER_DIR/$TODAY.md"` with `LEDGER_FILE="$(resolve_active_ledger "$LEDGER_DIR" "$TODAY")"`. The existing "create with `# Session Ledger — $TODAY` header if absent" block stays (now applies per-shard; each shard gets the header). No other logic changes; the scoped-commit paths already commit the whole `brain/sessions/ledger/` path glob so new shards are captured.
- In: readers that consume a whole day's ledger as a single file → glob `$DATE*.md` in sorted order and concatenate:
  - `hooks/scripts/init-repo.sh` (the `$YESTERDAY.md` read, ~line 255) → iterate `$YESTERDAY*.md` sorted.
  - `hooks/scripts/judge-session.py` — if it reads `ledger/$DATE.md` for judging, read all `$DATE*.md` sorted (verify during build; if it only reads its own `judgments/$DATE.md` output, no change).
  - `src/telemetry/beta-funnel.ts` (`readdirSync(ledgerDir)`) — enumerates the dir. **Two things to verify/fix:** (i) shards `$DATE.NN.md` are counted as ledger files (they are `*.md` — likely fine); (ii) **if it derives the date/day from the filename** (e.g. `basename.replace('.md','')`), a shard name `2026-07-05.02.md` → `2026-07-05.02` is NOT a valid date and would miscount or throw. Any filename→date parse MUST strip the optional `.NN` shard suffix first: extract the leading `YYYY-MM-DD` (regex `^(\d{4}-\d{2}-\d{2})`), so `$DATE.md` and `$DATE.02.md` both map to day `$DATE`. Add a test with a shard filename.
- Out (separate tickets / gated — do NOT bundle):
  - `merge=union` on `brain/sessions/ledger/**` (set by `init-repo.sh:124`) — the duplication multiplier. Changing the merge model risks concurrent-append conflict-hell across live sessions; genuine design fork. Capped shards bound its blast (a 40MB shard union'd ≤ 80MB) but do not eliminate it. **Separate ticket.**
  - The existing 25GB `.git` + >50MB history blobs → filter-repo/BFG history rewrite + force-push. **Irreversible, human-gated.**
  - `career-os-daily-squash.yml` branch-reconciliation cadence interaction — note only.

## Design decisions
1. **Shard, don't truncate.** Truncating/rotating-away loses session history (the ledger is replayable memory — data-integrity). Sharding preserves every byte; readers glob. New shards are the ONLY behavioral change.
2. **Order by explicit shard number, NOT lexical sort** (A.7 finding). The base `$DATE.md` has no numeric suffix, and `$DATE.02.md` byte-sorts BEFORE `$DATE.md` (`0`=0x30 < `m`=0x6D after the shared `$DATE.` prefix), so any `ls | sort` / naive glob-sort would pick the wrong active shard and concatenate history out of order. Instead: treat base `$DATE.md` as shard **1**; probe `$DATE.02.md`, `$DATE.03.md`, … by incrementing the integer NN. The resolver walks NN upward from 1 (1 = base) until it finds the highest existing shard, checks its size, and rolls to NN+1 if full. Readers reconstruct a day as `[$DATE.md] ++ [$DATE.NN.md for NN in 2..max, numerically ascending]`. NN is zero-padded to 2 digits only for tidy filenames, never for ordering. Ceiling: `.99` (99 shards × 40MB ≈ 3.9GB/day, far beyond any real day); if `.99` fills, keep appending to `.99` and log a warning — never silently drop (oversized `.99` beats lost data).
3. **Single shared helper, both hooks identical.** capture-prompt + capture-response had duplicated resolution; extract once (P19). One source of truth for the shard rule so the two writers never disagree on the active shard.
4. **Env-overridable threshold, safe default.** `CAREER_OS_LEDGER_MAX_BYTES` (default 40 MiB) keeps every shard well under GitHub's 50MB warn / 100MB reject even after a union-merge doubling (40→80 < 100).
5. **Fail-safe.** If `stat`/size resolution fails, fall back to the base `$DATE.md` (current behavior) — never crash the hook, never block the session (matches the hooks' existing fail-open posture).
6. **Reader back-compat.** A day with only the legacy `$DATE.md` resolves to exactly `[$DATE.md]` (shard 1, no `.NN` shards), so pre-rotation days read identically.
7. **Concurrent-writer safety at the roll boundary** (A.7 forward-failure finding). Two writers — `capture-prompt.sh` + `capture-response.sh` in the same turn, or two concurrent sessions in the same workspace — can both resolve the active shard while `$DATE.md` is just under threshold, or both decide to roll and race to create `$DATE.02.md`. Mitigations: (a) the resolve-and-roll step runs under a best-effort lock — `flock` (or an `mkdir` lock fallback where `flock` is unavailable) on a lockfile placed OUTSIDE the ledger dir, in the plugin runtime state dir (`$STATE_DIR/.ledger-rotate.<workspace-hash>.lock`, alongside the hooks' existing `git-errors.log`), NOT inside `$LEDGER_DIR` — so it is never git-committed by the scoped-commit glob nor counted by `beta-funnel.ts`'s `readdirSync(ledgerDir)`. Only one writer picks/creates the active shard at a time; (b) the "write header if shard file absent" step is create-if-absent (`[ ! -f ] && printf header`), idempotent, so even if the lock is unavailable and two writers touch a fresh shard, at most one header is written; (c) **fail-open** — if locking fails or times out (short timeout, e.g. 2s), fall back to the base `$DATE.md` append (current behavior), never block the session. Consequence of a lost race is bounded and benign: a shard exceeds threshold by at most one exchange (acceptable per AC), never data loss or a crash. Note: concurrent `>>` appends themselves are unchanged from today's behavior (both hooks already append to one file); this DD only serializes the *roll decision*.

## Acceptance criteria
- [ ] `resolve_active_ledger DIR DATE` with no existing file → echoes `DIR/DATE.md`.
- [ ] With `DATE.md` < threshold → echoes `DATE.md` (append continues to base).
- [ ] With `DATE.md` ≥ threshold and no `.02` → echoes `DATE.02.md` (rolls).
- [ ] With `DATE.md` ≥ threshold and `DATE.02.md` < threshold → echoes `DATE.02.md` (uses highest under-threshold shard).
- [ ] With `DATE.md` and `DATE.02.md` both ≥ threshold → echoes `DATE.03.md`.
- [ ] Non-contiguous shards: with `DATE.md` + `DATE.03.md` present (no `.02`), resolver picks the max-numbered existing shard (`.03`) — never stops at the missing `.02`; if `.03` is full, rolls to `.04` (unit-tested).
- [ ] The rotate lockfile lives in `$STATE_DIR` (NOT `$LEDGER_DIR`) → it is not git-tracked and not enumerated as a ledger file by `beta-funnel.ts` (asserted).
- [ ] Threshold honors `CAREER_OS_LEDGER_MAX_BYTES` env override.
- [ ] After the appender writes a rolled shard, the new shard begins with the `# Session Ledger — DATE` header.
- [ ] A whole-day reader returns shards in NUMERIC order `[$DATE.md, $DATE.02.md, $DATE.03.md, …]` — NOT lexical (`$DATE.02.md` must come AFTER `$DATE.md`, and `$DATE.10.md` after `$DATE.09.md`). Verified for single-shard (legacy) and multi-shard days.
- [ ] Resolver never uses `ls | sort | tail` / naive lexical glob-sort to pick the active shard (unit test asserts correct pick with `$DATE.md` + `$DATE.02.md` both present).
- [ ] Concurrent-writer: two writers resolving simultaneously at the threshold produce at most one fresh shard with at most one header (idempotent create-if-absent), and never crash; a lost lock falls back to base-file append (fail-open). Tested by simulating two near-simultaneous resolves.
- [ ] `stat` failure / unreadable dir / lock failure → helper falls back to `DATE.md`, hook does not crash (fail-open).
- [ ] No NEWLY-written ledger content pushes a file past threshold by more than one exchange (roll happens at the next append after crossing). An existing already-oversized base `$DATE.md` is treated as a full shard → new appends roll to `$DATE.02.md` and the oversized base stops growing (verified).
- [ ] Any reader that derives a date from a ledger filename maps BOTH `$DATE.md` and `$DATE.02.md` to day `$DATE` (leading `^\d{4}-\d{2}-\d{2}` extraction; unit-tested with a shard filename) — no invalid-date parse / miscount / throw.

## Test plan
- [ ] Unit (bats or a bash test harness matching repo convention) for `_ledger-path.sh`: the 6 resolution cases above + env override + fail-open + numeric-not-lexical ordering (base vs `.02`) + a ≥10-shard case (`.09` → `.10` ordering).
- [ ] Concurrency test: launch two resolver invocations near-simultaneously against an at-threshold base; assert ≤1 new shard, ≤1 header, no crash, no lost content.
- [ ] Reader test: create `DATE.md` + `DATE.02.md` + `DATE.10.md` fixtures; assert the whole-day reader concatenates in numeric order (base, .02, .10).
- [ ] Regression: existing capture-prompt/response tests stay green (append still works; single-shard day unchanged).
- [ ] beta-funnel.ts: add a shard fixture; assert readdir-based enumeration counts shards as ledger files.

## Rollback
Revert the commit. Base `$DATE.md` files are untouched; the helper only adds shard resolution. Without it, appends go to `$DATE.md` (status quo ante). No data migration.

## Change manifest
```
+ added     hooks/scripts/_ledger-path.sh                         — shared active-shard resolver
+ added     hooks/scripts/<ledger-path>.test.*                    — unit tests for the resolver + readers
~ modified  hooks/scripts/capture-prompt.sh                       — source helper; use resolved active shard
~ modified  hooks/scripts/capture-response.sh                     — source helper; use resolved active shard
~ modified  hooks/scripts/init-repo.sh                            — yesterday-read globs $YESTERDAY*.md
~ modified  hooks/scripts/judge-session.py                        — IF it reads the ledger by date, glob $DATE*.md (else no change)
~ modified  src/telemetry/beta-funnel.ts                          — confirm/extend shard enumeration + test
~ modified  .claude-plugin/plugin.json + package.json             — version bump 0.79.0 -> 0.80.0 (+ any other version-consistency sources the CI gate checks)
− removed   (none)
⚙ migrated  (none — additive; legacy single-file days remain valid first shards)
```


## Design-review verdict (Gate-A.7)

- verdict: YELLOW
- cycle: 1
- reviewer: anthropic/claude-fable-5
- cross_family: not_required
- manifest_sha256: 87336bd26c2818ad4b9fb8b05f370b3baf0ecf4039267eeb25ecd22a8e52cd8a
- timestamp: 2026-07-06T01:48:39.501Z
- findings:
  - [YELLOW] missing-requirements: Design decision #2's claim that lexical sort = chronological is incorrect: in byte-wise sort `DATE.02.md` orders BEFORE `DATE.md` (digit '0' 0x30 < 'm' 0x6D at the position after the shared `DATE.` prefix). Any resolver implemented as `ls | sort | tail -1` and any whole-day reader that naively sorts the `$DATE*.md` glob will pick the wrong active shard / concatenate out of order. Fix: specify the ordering rule explicitly as [base `DATE.md` first, then `DATE.NN.md` ascending by NN] in `_ledger-path.sh` and in every reader (init-repo.sh, judge-session.py, beta-funnel.ts), correct the decision #2 wording, and add a unit test asserting `DATE.md` precedes `DATE.02.md` in whole-day concatenation and that the resolver selects `DATE.02.md` (not `DATE.md`) as highest shard when both exist.
  - [YELLOW] forward-failure: Two writers (capture-prompt + capture-response, or two concurrent sessions on the same machine) can race at the threshold boundary: both resolve while `DATE.md` is just under threshold, or both roll and hit the per-shard 'create header if absent' check simultaneously, yielding a duplicate header or a shard that overshoots by two exchanges. Add one sentence to the spec stating the accepted behavior (races are benign: last-resolver-wins, overshoot bounded by concurrent-writer count, duplicate header tolerated by readers) or use `mkdir`/`noclobber`-style atomic shard creation in the helper; add this case to the acceptance criteria either way so the tolerance is explicit and testable.
- adjustments:
  - Class A; applied=false: Design decision #2's claim that lexical sort = chronological is incorrect: in byte-wise sort `DATE.02.md` orders BEFORE `DATE.md` (digit '0' 0x30 < 'm' 0x6D at the position after the shared `DATE.` prefix). Any resolver implemented as `ls | sort | tail -1` and any whole-day reader that naively sorts the `$DATE*.md` glob will pick the wrong active shard / concatenate out of order. Fix: specify the ordering rule explicitly as [base `DATE.md` first, then `DATE.NN.md` ascending by NN] in `_ledger-path.sh` and in every reader (init-repo.sh, judge-session.py, beta-funnel.ts), correct the decision #2 wording, and add a unit test asserting `DATE.md` precedes `DATE.02.md` in whole-day concatenation and that the resolver selects `DATE.02.md` (not `DATE.md`) as highest shard when both exist.
  - Class B; applied=false: Two writers (capture-prompt + capture-response, or two concurrent sessions on the same machine) can race at the threshold boundary: both resolve while `DATE.md` is just under threshold, or both roll and hit the per-shard 'create header if absent' check simultaneously, yielding a duplicate header or a shard that overshoots by two exchanges. Add one sentence to the spec stating the accepted behavior (races are benign: last-resolver-wins, overshoot bounded by concurrent-writer count, duplicate header tolerated by readers) or use `mkdir`/`noclobber`-style atomic shard creation in the helper; add this case to the acceptance criteria either way so the tolerance is explicit and testable.


## Design-review verdict (Gate-A.7)

- verdict: YELLOW
- cycle: 2
- reviewer: anthropic/claude-fable-5
- cross_family: not_required
- manifest_sha256: 87336bd26c2818ad4b9fb8b05f370b3baf0ecf4039267eeb25ecd22a8e52cd8a
- timestamp: 2026-07-06T01:52:19.528Z
- findings:
  - [YELLOW] missing-requirements: The spec caps future growth but never states what happens to the existing ~95MB day file already on origin/main — it will still violate the ticket-level criterion 'no ledger file exceeds ~40MB' and remains one union-merge away from GitHub's 100MB hard reject. Add an explicit disposition to the spec: either (a) include a one-time split of any existing ≥threshold legacy day file into the new shard scheme (readers already support multi-shard days, so this is additive and reversible), or (b) document in Scope/Out that static legacy files are accepted as-is with the rationale (no longer appended to, below 100MB) plus a stated check that no live branch can still union-merge that file past 100MB.
  - [YELLOW] missing-requirements: The beta-funnel.ts test only asserts shard files are counted during enumeration. If beta-funnel (or any reader) derives the day/date from the filename (e.g. basename minus '.md'), a shard name like '2026-07-05.02.md' would parse as date '2026-07-05.02' and mis-attribute or drop the row. Extend the acceptance criterion and test to assert correct DATE attribution for shard filenames, not just that shards are counted as ledger files.
- adjustments:
  - Class B; applied=false: The spec caps future growth but never states what happens to the existing ~95MB day file already on origin/main — it will still violate the ticket-level criterion 'no ledger file exceeds ~40MB' and remains one union-merge away from GitHub's 100MB hard reject. Add an explicit disposition to the spec: either (a) include a one-time split of any existing ≥threshold legacy day file into the new shard scheme (readers already support multi-shard days, so this is additive and reversible), or (b) document in Scope/Out that static legacy files are accepted as-is with the rationale (no longer appended to, below 100MB) plus a stated check that no live branch can still union-merge that file past 100MB.
  - Class B; applied=false: The beta-funnel.ts test only asserts shard files are counted during enumeration. If beta-funnel (or any reader) derives the day/date from the filename (e.g. basename minus '.md'), a shard name like '2026-07-05.02.md' would parse as date '2026-07-05.02' and mis-attribute or drop the row. Extend the acceptance criterion and test to assert correct DATE attribution for shard filenames, not just that shards are counted as ledger files.


## Design-review verdict (Gate-A.7)

- verdict: YELLOW
- cycle: 3
- reviewer: anthropic/claude-fable-5
- cross_family: not_required
- manifest_sha256: 87336bd26c2818ad4b9fb8b05f370b3baf0ecf4039267eeb25ecd22a8e52cd8a
- timestamp: 2026-07-06T01:55:45.665Z
- findings:
  - [YELLOW] missing-requirements: The lockfile `.ledger-rotate.lock` is placed inside `$LEDGER_DIR`, but the spec also states the scoped-commit paths commit the whole `brain/sessions/ledger/` path glob and `beta-funnel.ts` enumerates that directory via readdirSync. Specify that the lockfile must not be committed or counted: either place it outside the ledger dir (e.g. `${CLAUDE_PLUGIN_DATA}` or a tmp path keyed by workspace), or add it to .gitignore AND require readers to filter to `*.md` only. Add an acceptance criterion that no lock artifact appears in commits or reader enumeration.
  - [YELLOW] missing-requirements: The resolver is specified as 'walks NN upward from 1 until it finds the highest existing shard' — define behavior for a non-contiguous shard sequence (e.g. `$DATE.md` + `$DATE.03.md` present but `.02` missing, via manual deletion or partial sync). Either (a) document stop-at-first-gap as the rule (appends resume at the first missing NN) and assert readers still concatenate all existing shards numerically, or (b) resolve the active shard by scanning the glob for the max NN rather than incremental probing. Add one unit test for the gapped case so writer and reader behavior can't diverge.
- adjustments:
  - Class B; applied=false: The lockfile `.ledger-rotate.lock` is placed inside `$LEDGER_DIR`, but the spec also states the scoped-commit paths commit the whole `brain/sessions/ledger/` path glob and `beta-funnel.ts` enumerates that directory via readdirSync. Specify that the lockfile must not be committed or counted: either place it outside the ledger dir (e.g. `${CLAUDE_PLUGIN_DATA}` or a tmp path keyed by workspace), or add it to .gitignore AND require readers to filter to `*.md` only. Add an acceptance criterion that no lock artifact appears in commits or reader enumeration.
  - Class B; applied=false: The resolver is specified as 'walks NN upward from 1 until it finds the highest existing shard' — define behavior for a non-contiguous shard sequence (e.g. `$DATE.md` + `$DATE.03.md` present but `.02` missing, via manual deletion or partial sync). Either (a) document stop-at-first-gap as the rule (appends resume at the first missing NN) and assert readers still concatenate all existing shards numerically, or (b) resolve the active shard by scanning the glob for the max NN rather than incremental probing. Add one unit test for the gapped case so writer and reader behavior can't diverge.


## Design-review verdict (Gate-A.7)

- verdict: GREEN
- cycle: 4
- reviewer: anthropic/claude-fable-5
- cross_family: not_required
- manifest_sha256: 87336bd26c2818ad4b9fb8b05f370b3baf0ecf4039267eeb25ecd22a8e52cd8a
- timestamp: 2026-07-06T01:58:48.134Z
- findings: none
