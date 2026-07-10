# Changelog

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
