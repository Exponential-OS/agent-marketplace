## [1.10.1] - 2026-11-23 - the catalog envelope is not a plugin (XOS-444)

Found by DOGFOODING the installed 1.10.0 against the real catalog, which is the only place it
could be found. The gate BLOCKed on every run:

```
⚠ STALE: $schema installed missing < marketplace
         https://anthropic.com/claude-code/marketplace.schema.json
```

A real marketplace root is an ENVELOPE — `{$schema, name, owner, metadata, plugins}` — and the
parser scanned it for plugin entries, turning a JSON Schema reserved key into a plugin whose
version was the schema URL and which can never be installed. `$`-prefixed keys are now skipped.

This bug is OLDER than 1.10.0 and was unreachable until it: the gate had never successfully
resolved a catalog, so it had never had one to misparse. Fixing the path did not cause the
defect, it exposed it — and it would have made the gate block permanently the first time
anyone wired it.

The gate's remaining BLOCK on this machine is a TRUE POSITIVE: `jury` is catalogued at 0.2.0
and is not installed.

284 passing, 0 failures, 6/6 rule suites. CI floor 282 -> 284. Mutation-verified: removing the
envelope guard fails both new tests, one at the parse and one at the verdict.

## [1.10.0] - 2026-11-23 - the publish gate stops reporting PASS having checked nothing, and starts checking SESSIONS (XOS-444)

Reported by a peer session that shipped co-dialectic 4.47.5, never posted a reload bulletin,
and found the gate had not stopped it. Anand found the stale install himself. Three defects,
each verified against the installed 1.9.1 before being credited.

**1. It was never wired.** The plugin had no `hooks/` directory at all; the gate ran only if
an agent remembered to run it. (Still unwired — see "What is NOT in this release".)

**2. It looked for the marketplace in the wrong place.** `join(cwd, "agent-marketplace/...")`
treats the catalog as a CHILD of the caller. It is a SIBLING of the source repo, and Stage 9
legitimately runs from the source repo, so resolution could not succeed. Now an ancestor walk
plus `~/aiprojects`, which works from a worktree too instead of hardcoding one layout.

**3. And then it reported PASS anyway.** That is what made (2) lethal rather than merely
annoying:

```
verdict: PASS
checked: []
target:  <a path that does not exist>
```

Six separate paths returned PASS when the gate could not check: marketplace absent, catalog
empty, handler crash, invalid JSON, crash before emit. A publish gate that cannot find its
reference data reporting PASS is a FAIL-HARD violation in load-bearing code, and it is
quotable as evidence that the fleet is current.

There is now a third verdict, `UNKNOWN`, carrying WHAT and HOW. PASS additionally requires at
least one plugin to have actually been compared. "I could not check" and "I checked and it is
clean" are different answers and no longer share a word.

### Anand's reframe, which is the larger half

> "there should be a gate that verifies that it has loaded itself and others loaded as well.
> that is the codification of the prose."

Even with the path fixed, the gate answered the wrong question. It compares FILES — catalog
version against installed version. The prose promises an outcome about SESSIONS. Both files
can agree perfectly while the whole fleet runs old code, because a plugin binds once at
session start and never rebinds (XOS-405). Merged != installed != LOADED.

Measured while writing this, with 4.47.5 installed and the catalog agreeing:

```
4.47.5   0.7m ago        4.47.0   0.9m ago
4.47.4   3.2m ago        4.36.0   0.2m ago   <- nine releases back, touched 12 seconds earlier
```

Four versions live at once, every file in agreement. No new telemetry was needed:
`~/.codialectic/sessions/<id>.json` already records the version a session actually LOADED,
and mtime already separates live from abandoned.

- **SELF is a BLOCK.** If the session running the publish has not loaded the installed plugin,
  the gate blocks and names that session's own `claude --resume <id>` line rather than advising
  that someone should reload. It blocks the session that wrote it, which is how it was tested.
- **PEERS are REPORTED, never gated on** — see below.
- Session ids must be UUIDs. Benchmarking has twice left synthetic ids (`verify-1`) in that
  directory, and a retracted claim on XOS-436 came from counting them.
- "Live" is 30 minutes, matching the SDLC WORK-CLAIM invariant rather than inventing a second
  definition of live for the same swarm.
- Only `co-dialectic` records a per-session loaded version today. That is a named limit, not an
  assumption: any other plugin would have to write its own session state for this to widen.

### What is NOT in this release, and why

**Peer staleness does not block.** Blocking Anand's release because somebody else's terminal is
old is a product call he owns. The handler surfaces stale peers in `sessions.stalePeers` and
keeps the verdict PASS. A test pins that boundary so a future change to it has to be deliberate.

**The gate is still unwired.** What event should fire a *publish* gate is a design question with
real blast radius, and wiring it into `~/.claude/settings.json` is a latency decision that is
Anand's, not an agent's.

**A customer machine with no marketplace now gets UNKNOWN rather than PASS.** Whether that
should become a BLOCK interacts with XOS-414 (making `/ship-feature` inert for a non-Anand
buyer), so it is deliberately left as UNKNOWN.

282 passing, 0 failures, 6/6 rule suites. CI floor 273 -> 282. Eight mutants; two survived the
first run and both were MY tests asserting weaker properties than they advertised — the
"sibling" test passed through a home-directory fallback and never exercised the walk. Both
fixed and killed. One guard is documented in-code as defense-in-depth and explicitly NOT
counted as tested, because removing it alone fails nothing.

## [1.9.1] - 2026-11-23 - the shipped test suite must pass where it SHIPS (XOS-415)

Found by running the VENDORED copy, which is the only place it reproduces: the source suite
passed 56/0 and the vendored suite failed 55/1.

```
error: ENOENT: no such file or directory,
  open '/Users/anandvallam/aiprojects/docs/plans/skip-rule-fail-closed.md'
```

A test read this plugin's own spec via `../../../../../../docs/plans/`. Six levels up is the
repo root from `plugins/cross/exponential-developer/skills/ship-feature/design-review/`, and
it is somewhere else entirely from `engines/exponential-developer/...` in the marketplace or
from the installed plugin cache -- both are SHALLOWER. The path was right in exactly one
layout and wrong in every layout a customer has.

- The spec's Change-manifest section is now a verbatim FIXTURE in `manifest-corpus.ts`
  (`OWN_SPEC_MANIFEST`), extracted programmatically rather than retyped, and asserted at
  extraction time to not contain the claim line -- otherwise the test it feeds would silently
  change meaning. A plugin that ships carries its own fixtures.
- STRUCTURAL GUARD so the class cannot recur: `no shipped test reaches outside the plugin
  root` walks every `*.test.ts` / `tests.ts` in the plugin, resolves every
  `import.meta.dir, "..."` target, and fails naming any that escapes the plugin root.
  Mutation-verified by reintroducing the exact offending path.

A test that reaches outside the plugin is testing the repo, not the plugin -- and it reports
green to the author while failing for everyone who installs it.

273 passing, 0 failures, 6/6 rule suites, in the source repo AND from a vendored layout.
CI floor 272 -> 273.

## [1.9.0] - 2026-11-23 - Gate-A.7 skips only on an explicit claim (XOS-415)

The skip rule read a change's own prose description to decide whether the change was
mechanical. It waved through a rewrite of its own reviewer control flow because the manifest
listed only `SKILL.md`. Two prose detectors were tried and both failed cross-family review in
BOTH directions at once -- missing real code work while blocking editorial English like
"fix typo(s) in the install section". Prose detection was the wrong design, not an
undertuned one, and both detectors are deleted.

**Skipping now requires an affirmative claim.** An exact standalone line in the
`## Change manifest` section, inside or outside its fenced block:

```text
I claim this change is mechanical-only.
```

Omission is an accident; an affirmative claim is reviewable. No claim means review, older
specs included, and no migration is needed because nothing moves from blocking to passing.
The claim is NECESSARY, NEVER SUFFICIENT -- the four existing guards still run after it
(<=5 files, no declared public surface or behavior change, >=1 path, all paths mechanical).

Line endings are not part of the claim. A bare `split("\n")` left `\r` welded to the line, so
a CRLF-authored spec could never claim at all and the failure looked identical to not having
claimed. Only a TRAILING `\r` is stripped, per line: normalising `\r` globally was tried first
and is a BYPASS, because it turns an inline `\r` into a line break and promotes a mention
("x\rI claim...") into a standalone claim.

`manifestSummary` is now EXPORTED so tests can assert WHICH paths were extracted, not just
the resulting verdict. `shouldSkip` returns the same verdict whether a path is read correctly
or mangled into something else that is also non-mechanical, so a verdict assertion cannot
tell a working extractor from a broken one -- a mutation removing a path-parsing guard
survived an entire suite until path identity became assertable.

Corpus discipline: `manifest-corpus.ts` holds 22 BENIGN and 9 CODE cases plus one pinned
accepted false negative, written BEFORE the implementation and never edited to pass. It is
what caught the over-blocking in the rejected attempts.

**NOT fixed in this release, and deliberately not papered over.** While hardening the above,
six review rounds established that the PATH GUARD cannot see several classes of file, so
`paths.every(isMechanicalPath)` passes vacuously on an empty set. Each of these, paired with
a mechanical `README.md`, SKIPS review today and also skips on every prior version:

    install.sh   .env   .env.local   a.sh   Jenkinsfile   CODEOWNERS
    VERSION_check -> reported as "VERSION", a different and mechanical file
    docs/../src/auth.ts -> traversal defeats the docs/ prefix check
    "... handle (none) token case" -> `(none)` anywhere drops the whole line

An attempt to fix these by extending the path patterns was made and REVERTED in full: each
round closed the shapes it was given and opened new ones, including bypasses introduced by
the fixes themselves. Enumerating path shapes is the same losing approach as prose detection,
one level down. XOS-442 (P1) owns the redesign -- a strict grammar that refuses an unparsed
line, or reading real `git diff` paths instead of scraping the manifest.

272 passing, 0 failures, 6/6 rule suites. CI floor 261 -> 272.

## [1.8.0] - 2026-11-20 - close stdin on every codex exec dispatch, guarded by a test (XOS-418)

`codex exec` reads stdin even when the prompt is an argument; its first line is literally
"Reading additional input from stdin...". With stdin inherited it waits on a pipe that
never closes: alive, 0% CPU, zero output, and it never times out. Three sessions measured
it; the worst ran 10h45m on a 39-byte log. The wrapper had already returned exit 0 from
its own echo, so the orchestrator reported success while the build never started.

- `< /dev/null` on every documented dispatch in this plugin: SKILL.md x4, plus the
  cost-routing-gate BLOCK remediation message, README and manifest. The handler message
  mattered most: it is what an agent reads at the moment the gate tells it to use codex.
- Two anti-instructions recorded so they are not re-derived. Do NOT add
  `--skip-git-repo-check` (different check; the discriminator is git-repo presence, not
  path, and a worktree satisfies it on its own). Do NOT grep for the stdin line to detect
  a stall (it prints on every run, healthy included).
- Shipped WITH a standing guard rather than as prose, since the defect's own thesis is
  that prose regresses silently. Two tests that DISCOVER files by walking the plugin and
  excluding non-instruction surfaces by category, mutation-verified to bite.

20 pass cost-routing-gate, 45 pass design-review, CI floor 259 -> 261.
`jury` has the same exposure; filed as XOS-425 rather than bundled.

## [1.7.0] — 2026-11-20 — Stage 4 routes Claude-native artifact authoring to Claude (XOS-420)

Stage 4 said "Codex owns repo investigation and ALL code changes" with no condition, while
the same file already used SHIPPED-ARTIFACT-CLASS at Stage 5.8 and Stage 9. The pipeline
consulted artifact class to VERIFY and to PUBLISH a plugin, and never to BUILD one — build
was the single artifact-blind stage. The cost-routing table already proved it could express
the exception, carrying exactly one carve-out ("UI is design judgment, NOT mechanical").

- Claude-native surfaces route to **Claude**: `SKILL.md`, `hooks.json` and hook handlers,
  `plugin.json`/`marketplace.json`, `commands/*.md`, rule manifests, `.claude/settings.json`,
  agent definitions, output-style files, `CLAUDE.md`/memory rules. The list is explicitly
  NON-exhaustive; the litmus is the rule.
- The built-in authoring skills are **named**, not described: `skill-creator`,
  `superpowers:writing-skills`, `hookify`, `update-config`, `claude-api`. The last four
  appeared ZERO times before this; `skill-creator` appeared four times, all evaluation.
- Everything else still goes to Codex. The boundary is portability, not language: *would
  this file be identical if Claude Code did not exist?* A hook handler is TypeScript and
  still Claude-native; `design-review/run.ts` is ordinary and stays Codex work.
- Granularity is the FILE. A mixed ticket splits per-file; a mixed FILE goes to Claude whole.

Six Gate-A.7 cycles, converging GREEN with zero findings.

## [1.6.0] — 2026-11-19 — Gate-A.7's mandatory reviewer walks a candidate ladder (XOS-413)

Gate-A.7 pinned ONE model for the MANDATORY primary reviewer with no fallback, while the
OPTIONAL cross-family reviewer already walked a `gemini -> codex` ladder. Any account that
could not reach the pin got `UNREACHABLE -> BLOCK` with no route forward.

Measured first: `claude-fable-5`, `claude-fable-5-1`, `claude-sonnet-5` and
`claude-haiku-4-5` all resolve. The pin is live, so this was a resilience defect rather
than a dead-model one — changing the string would only have relocated the single point of
failure.

- `DESIGN_REVIEW_MODEL`, when set, is honoured exactly and alone. An operator who names a
  model gets one honest attempt at it, never a silent substitution.
- Otherwise a descending ladder is walked, advancing ONLY on `nonzero_exit`. A `timeout`
  proves the model IS reachable and the work is slow, so advancing would turn one slow
  review into N; `unparseable` means the model already answered.
- Budget is shared across the ladder, admission checked before EVERY candidate.
- Fail-closed preserved: every candidate failing still BLOCKS, with the final attempt's
  own reason rather than a generic label.
- `models_tried` is recorded on SUCCESS as well as on UNREACHABLE, so a GREEN produced
  after a silent capability downgrade is visible rather than indistinguishable.

45 pass / 0 fail in the design-review suite; CI floor raised 247 -> 259.

# Changelog

## [1.6.0] — 2026-11-20 — Explicit mechanical claim; silence means review (XOS-415)

Replace both rejected prose-detector attempts with an exact standalone claim in the Change
manifest, documented in SKILL.md. Unmarked manifests now require review, including older
specs. The claim is necessary, never sufficient: all four existing guards still run.
The skip-side contract stays unchanged; no-skip results add `no_mechanical_claim`.

Delete codeWorkSignals and its three regexes. Preserve the adversarial corpus verbatim,
repurposed for marked/unmarked behavior and guard preservation. Remove 13 tests from the
rejected attempts, replacing their detector/default-skip assumptions with nine contract
tests. Preserve all 33 original tests, adding the required claim to the mechanical-skip
fixture and retaining the authorized toMatchObject assertion for no-skip diagnostics.

## [1.5.0] — 2026-11-19 — Gate-A.7 blocks for a reason it can name (XOS-204)

The gate fail-closes correctly, but the record it wrote could not say WHY. A reviewer
killed by our own timeout, a model that does not exist, a CLI that is not installed, and
a reviewer that answered in prose all produced the identical `UNREACHABLE` sidecar. So
everyone who hit it read that next to `claude-fable-5`, reached for XOS-56, and concluded
the model was gone. **This bug was filed five separate times across 4.5 months**, and four
of those sessions each spent real time disproving the model theory first.

The information was never missing, only discarded: `Bun.spawnSync` distinguishes a
timeout (`exitCode:null` + `SIGTERM`) from a real failure (`exitCode:3`), and
`defaultCommandRunner` collapsed both into `ok: exitCode === 0`.

**UNREACHABLE now records** `reason` / `elapsed_ms` / `exit_code` / `signal` /
`stderr_tail`. `unknown` is the INITIAL value, never a terminal `else` — an unrecognized
failure must not wear a confident wrong label.

**The 120s budget is now configurable and fits the work.** It was hardcoded at three call
sites against a measured 87-190s workload, so `defaultCommandRunner`'s own `?? 120_000`
was dead code. Worse, it scaled against spec quality: the same model returned a real
YELLOW in 101s, then UNREACHABLE at 120s after the spec grew by 60 lines *this gate had
itself demanded*. Two budgets, one resolver:

* `DESIGN_REVIEW_TIMEOUT_MS` — per call, default `300_000`
* `DESIGN_REVIEW_TOTAL_BUDGET_MS` — whole run, default `540_000`

Neither can be configured below `MIN_USABLE_CALL_MS` (90s), because a budget too small to
complete a measured review would place a doomed call and then report `timeout`.

**`sanitizedEnv` now strips what its own header always claimed.** `ANTHROPIC_API_KEY` was
absent from the strip list while the primary reviewer is `claude -p` — the one key that
can divert it to pay-per-token billing was the only one left in the environment. Both
existing tests asserted `OPENAI_API_KEY`, a key that reviewer never reads. Now a
`/_API_KEY$/` pattern plus an explicit extras set, so a future provider's key is covered
without anyone editing a list.

**Cross-family probing is tri-state.** A probe that timed out is not evidence a CLI is
absent, and absence is no longer keyed on `exitCode === 1` (POSIX specifies only
*nonzero*). A sentinel proves `command -v` actually ran. "No cross-family reviewer CLI
available" is claimed only when every candidate demonstrably ran and found nothing.

**SKILL.md's documented invocation now carries an explicit Bash timeout.** The tool
default is 120s, so the documented call died before the new budget was reachable — writing
no sidecar at all, which is strictly worse than the bug.

Fail-closed is unchanged: every UNREACHABLE path still exits 1.

## [1.4.1] — 2026-10-26 — two shipped docs carried a maintainer's absolute paths

`rules/cost-routing-gate/README.md` gave the hook registration as a copy-paste
`hooks.json` block whose `command` was `/Users/anandvallam/.bun/bin/bun`, in three
places. **Documentation meant to be pasted IS configuration**: anyone who followed
it got a hook pointing at a home directory that is not theirs, and a PreToolUse
hook whose binary does not resolve fails quietly — the gate simply never fires,
and nothing says so.

Now plain `bun`, plus the note that was actually missing: if the hook never fires,
`bun` is not on the PATH hooks run with, and the fix is to run `command -v bun`
yourself and paste the result. That is the real reason an absolute path was there, and it was
never written down — so the hardcoded one read like a requirement rather than one
person's workaround.

`rules/sdlc-worktree-isolation/SPEC.md` named a specific workspace repo twice in
an incident write-up, and pointed at `CONSTITUTION.md` for an invariant it quotes
in full three lines below. That pointer sent a customer to a file this plugin does
not ship; removing it loses nothing, because the text was already there.

Found during the XOS-353 sweep. The ship gate caught the `/Users/` path and one
repo name; the third absolute path, the `$(command -v bun)` gap and the dangling
canon reference came from reading the files — `README.md` and `SPEC.md` are
outside its scan scope (XOS-357).

## [1.4.0] — 2026-10-25 — XOS-351: every acceptance criterion carries its own proof

- **Stage 2 spec template:** each acceptance criterion now requires a `verify:` line naming the exact command that proves it, and the output that counts as proof. A criterion with no command is not a criterion, it is a hope — and it is precisely what forces a human to re-read the diff at merge, which is how review became the bottleneck rather than the build.
- **Replaces the separate `## Test plan` section.** A parallel list of tests never said *which* criterion each test proved, so nothing caught a criterion no test covered. Pairing them makes that gap structural instead of a judgement call. Nothing depended on the old section — the only other reference was a test fixture, and the design-review gate never required it (checked before removing).
- **New `## Unverifiable criteria` section.** Taste, tone, "does this feel right" genuinely cannot be reduced to a command. Listing one there is allowed; hiding one among the verifiable is not. This is the list a human actually reads, and keeping it separate is what makes that review small rather than a full diff re-read.
- **Gate A is now explicitly the load-bearing human gate.** With Gate B defaulting to auto-merge, these commands are the only thing between an approved spec and `main` for most work. Approving a spec whose criteria have no commands is approving a promise that someone checks later — which, with auto-merge on, means nobody does.
- Carries two warnings into the template from this workspace's own failures: a gate whose green verdict replaces a human must be **mutation-tested** (shown to reject known-bad input — every unmutated guard here turned out vacuous), and prefer a command that **fetches and asserts the artifact** over one that checks a reference to it (a readiness gate once greened a PR whose visual review linked 404 images).

## [1.3.0] — 2026-07-10 — THE-541: cross-family judge → canonical `jury`

- Stage 6 (+ cost-routing, Gate-A.5, visual verdict) now invoke the canonical **`jury`** skill (cross/jury) instead of co-dialectic `judge-panel` — retiring the near-duplicate (XOS-217). jury v0.2.0 is OAuth-only, self-updating (agy-models discovery wins), effort-laddered, with per-lane model+version transparency. Same rubric/verdict interface; receipt marker unchanged.


## [1.2.0] — 2026-07-10 — XOS-221: Stage 4 build-reliability (foundation-first)

Stage 4 delegated to `codex exec` but never specified how — so builds silently stalled or returned partial work (observed twice building THE-541). Codified the three non-negotiables:
- **`codex exec --sandbox workspace-write`** — codex defaults to a read-only sandbox; a builder without this plans, can't `apply_patch`, and stops with no edits. (Judge/review lanes stay read-only.)
- **Model + effort by the resilience rule** — inherit codex config model (gpt-5.6-sol; never gpt-5.6-codex/API-only), `-c model_reasoning_effort=high`, step down on "at capacity", parse+retry on invalid-effort 400. Never pin ultra/xhigh (capacity-walled).
- **Orchestrator verifies completion** — never trust a "launched"/partial return; confirm requested changes present (diff + greps) + `bun build` clean before Stage 5. Amendment-D open-and-wander applied to the builder.

## [1.1.0] — 2026-07-09 — XOS-218: local-first gates + anti-404 visual gate + v2 amendments

Gates run LOCAL, pre-PR — **not GitHub Actions** (new "Where gates run" invariant). Motivated by a real 2026-07 failure: a GitHub Actions "PR Readiness Gate" greened a PR whose visual review linked **404 images** (checked *presence*, not *resolution*), PRs sat waiting async while agents forgot to rebase (collision mess), and Actions minutes hit **paid overage**.

- **Local-first gate architecture (invariant):** all deterministic gates run in-pipeline before `gh pr create`; GitHub Actions is a thin backstop (fresh-clone build + merge-queue) — do NOT add `.github/workflows` that re-run lint/types/tests/visual/sonar. BANS presence-not-substance passing conditions ("image attachment detected", "tests file exists").
- **C — anti-404 / anti-rubber-stamp visual gate (Stage 5.5):** every visual proof must RESOLVE (non-zero valid PNG / HTTP 200) AND a named vision reviewer must have SEEN the pixels; emits a visual-review receipt; "attachment detected" is a FAIL, not a PASS.
- **E — local reliability pre-sweep (Stage 6.7):** run Sonar-rated patterns (non-null assertions, array-index keys, unassociated labels, non-interactive onClick) locally on touched files before the PR; root-cause fixes only, suppressions forbidden. Kills the 3-round-trip Sonar CI loop.
- **B — adversarial judge-flag verification (Stage 6):** no flag acted on blind; each verified against code with line evidence and classified CONFIRMED (fix) / DISPROVEN (receipt) / PRE-EXISTING (follow-up ticket). ~half of judge flags were hallucinations from truncated diffs.
- **A — XL-staged build mode (Stage 4):** optional 2–4 staged Codex dispatches on one branch for large changes (>1,200 lines / >15 files / >5 themes / "apply to ALL X"); orchestrator verifies + commits between stages.
- **D — cost-route watchers + never open-and-wander (Stage 8):** whale touches only judgment; the Haiku/Monitor watcher owns the PR to a terminal state (watch-to-green, rebase on drift, merge, or escalate) — an untended PR is the collision-mess root cause.

## [1.0.0] — 2026-07-09 — Renamed super-developer → exponential-developer

- Plugin renamed `super-developer` → **`exponential-developer`** (product name). Commands/skill now
  scope as `exponential-developer:ship-feature` (was super-developer:*). Install: `exponential-developer@xos`.
- Fixed stale `~/aiprojects/super-developer-plugin` hardcoded paths in cost-routing-gate/README → `${CLAUDE_PLUGIN_ROOT}`.
- No behavior change to the pipeline itself; identity + scope rename per xos/docs/REPO-ARCHITECTURE.md §4.


## 0.12.0 - 2026-07-04

- Consume the XOS-207 cross_family signal in the Stage-6 receipt (XOS-210, receipt half): the ship-feature-judge-receipt now carries a `cross_family` line read from the judge JSON authoritative `cross_family.degraded` field (co-dialectic >=4.35.0), so a Stage-6 review that silently lost a family (lane errored/timed-out/emptied) is now visible in the PR instead of masquerading as full cross-family. A `cross_family.degraded: true` result on a T3+ change AUTO-APPLIES human-merge (the review carried only one family blind spots). Consumer reads cross_family.degraded, never all_flags[0]. codi Protocol-8 consumer half deferred (separate slice).

## 0.11.0 - 2026-07-04

- Make the Gate-A.7 primary design-review reviewer configurable with `DESIGN_REVIEW_MODEL`, defaulting to `claude-fable-5`, so Fable-5 quota exhaustion can be routed around without changing the Gemini cross-family fallback.
- Add `rules/cost-routing-gate`: a PreToolUse Edit/Write/Bash gate that enforces fresh `/ship-feature` cost routing by blocking in-session source writes inside the live worktree and conservative deploy/poll loops, routing them out-of-process to `codex exec` or `claude --model haiku -p`.

## 0.10.0 - 2026-07-03

- Add Gate-A.7 Design-Reasoning Review (XOS-196): a FAIL-HARD pre-build stage between Gate-A.5 and Stage 4. The new `skills/ship-feature/design-review/run.ts` fresh-reviewer harness reads only the approved spec + Change Manifest, records structured GREEN/YELLOW/RED/UNREACHABLE/SKIPPED verdicts in `docs/plans/<slug>.design-review.json`, supports objective mechanical skips, Class-A/B adjustment handling, max-two-RED parking, and appends the PR-ready verdict block. The new `rules/design-review-gate` PreToolUse Bash gate blocks Stage-4 build spawns on missing/stale/RED/UNREACHABLE/Class-B-applied records.

## 0.9.0 - 2026-07-01

- Wire superpowers skills into Stage 1/2/5 bodies (XOS-178): Stage 1 now runs via superpowers:brainstorming (N-angle explore → judge-panel → synthesize), Stage 2 via superpowers:writing-plans, Stage 5 via superpowers:test-driven-development. Previously these were only named in the top orchestration summary; the stage bodies (what an executing agent reads) invoked nothing, so they ran ad-hoc. Stage 4 already wired its superpowers; this brings 1/2/5 to the same standard. Body = execution truth.
  - Also route Stage 1 brainstorm to the domain's 0.001% persona (UX→Ive, arch→Dean, positioning→Jobs) and apply domain-persona lenses in Stage 6 review (UX→Jobs+Ive), matching Stage 5.5. Personas were only wired at visual-verification (5.5) before.

## 0.8.0 - 2026-07-01

- Stage 5.8 plugin/skill sandbox-install + turn-on verification (XOS-173): new CONDITIONAL stage between 5.7 and 6, fires by shipped-artifact-class (plugin/skill/engine or shared install.sh/marketplace/plugin.json/vendor changes). Installs the built plugin into an ISOLATED sandbox (temp HOME + CLAUDE_PLUGIN_DATA, never the live ~/.claude) and proves it ACTIVATES (skill triggers/loads, engine entrypoint runs non-error, hooks fire) — not merely name-resolves. Fail-hard: install-fail or no-turn-on ⇒ BLOCK back to Stage 4; sandbox-unavailable ⇒ BLOCK. Recovers the lost Stage-5.8 (XOS-170) and closes the "merged != activated" gap that killed codi (4.30 source vs 4.27 installed).

## 0.7.0 - 2026-07-01

- Gate-A.5 Change-Manifest gate (XOS-164): new pipeline stage between Gate A (spec approved) and Stage 4 (build). Builder emits a file-level Change Manifest (+added/~modified/−removed/⚙migrated) + pseudocode before any code; a cross-family judge (Stage 6 harness) BLOCKs when the spec uses "replaces/supersedes/instead of/deprecates" about an existing surface but the −removed and ⚙migrated buckets don't account for it. Fail-hard; judge-unreachable ⇒ BLOCK. Catches the additive-bias "add-without-remove" defect class at plan-time (observed 3× in one session: Tune header, provenance chrome, Build page).

## 0.6.0 - 2026-06-29

- Add Stage 9 PUBLISH+BROADCAST+ENSURE to `/ship-feature` so shipped means activated across the running swarm/users, with artifact-class routing and loud version-skew checks. Add `ship-feature-publish-gate` to detect stale xos plugin cache installs against the marketplace catalog. (XOS-142)

## 0.5.0 - 2026-06-29

- Make `/ship-feature` cross-family review unskippable at merge: Stage 6 now emits the canonical `ship-feature-judge-receipt:v1` receipt, Stage 7 requires it in the PR body, and `ship-feature-gate` blocks `gh pr merge` when the target PR lacks the receipt while failing open with a warning on PR-body fetch errors. (XOS-138)

## 0.4.1 - 2026-06-28

- Fix Stage 5.5 screenshot-attach mechanism: commit PNGs to the tracked `docs/verify/<ticket>/` path so they render in the PR "Files changed" tab (the proven-reliable method for a PRIVATE repo). Replaces the prior `github.com/user-attachments` 200-gate, which the bus proved is not reliably scriptable by a cell (raw/release URLs 404 for a private-repo viewer; inline user-attachments needs web-UI drag-drop). (XOS-118 follow-up)

## 0.4.0 - 2026-06-28

- Add Stage 5.5 E2E + VISUAL verification, Stage 5.6 real `/simplify`, and Stage 5.7 targeted verification rerun to `/ship-feature`. (XOS-118)
- Document the light XOS-112 reload-on-upgrade preflight coupling for required `/ship-feature` upgrades.

## 0.3.0 - 2026-06-23

- Removed the fable-5 reasoning gate (claude-fable-5 unavailable; reintroduced by mistake in 0.2.0). Reasoning validation now via cross-family judge-panel. (XOS-59 / XOS-56 follow-up)

## 0.2.0 - 2026-06-10

- Self-contained: bundled sdlc-work-claim, sdlc-worktree-isolation, ship-feature-gate rules + fable5-reasoning-validate script into the plugin; skill now invokes them via `${CLAUDE_PLUGIN_ROOT}` (portable on any machine, no `~/cyborg` dependency).

## 0.1.0 - 2026-06-10

- Package the canonical `ship-feature` Agentic SDLC skill as the cross-xOS `super-developer` plugin.
- Add the `/ship-feature` command alias.
- Declare global workspace binding so `/ship-feature` resolves from every cwd/repo.
