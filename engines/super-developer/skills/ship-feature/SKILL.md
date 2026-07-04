---
name: ship-feature
description: "Use this skill whenever the user asks to implement, build, fix, ship, add, refactor, migrate, or change ANY code — features, bugs, plugins, skills, migrations, hooks, rules, configs, in any repo. Triggers on 'build X', 'fix Y', 'implement Z', 'ship this to <plugin>', a ticket id with code work. This is the Agentic SDLC pipeline; do NOT hand-roll `codex exec` or ad-hoc git/PR shipping — route through Stage 0 (claim), the 9 core stages, the Gate-A.5 change-manifest gate, Gate-A.7 design-review gate, Stage 5.5/5.6/5.7/5.8 quality gates, and Stage 10 (completion)."
---

## MANDATORY SCOPE

Use this skill whenever the user asks to implement, build, fix, ship, add, refactor, migrate, or change ANY code: features, bugs, plugins, skills, migrations, hooks, rules, configs, in any repo.

Runtime gate paths are plugin-local via `${CLAUDE_PLUGIN_ROOT}`. Keep invoked `bun run` rule/script paths portable; do not restore `~/cyborg` runtime invocations.

This also triggers on phrasing like "build X", "fix Y", "implement Z", "ship this to <plugin>", or a ticket id with code work. Do NOT hand-roll `codex exec` or ad-hoc git/PR shipping. Route the work through this pipeline. The only exception is a trivial single-file doc edit with no code, config, hook, rule, migration, skill, plugin, build, PR, or shipping impact.

# /ship-feature — Cost-Routed Agentic SDLC Pipeline

Trigger: `/ship-feature $ARGUMENTS`

`$ARGUMENTS` = required Linear ticket id plus feature/bug slug and repo context.
Examples: `THE-10 regen-bug`, `THE-10 regen-bug in ~/aiprojects/Adapt.ai`.

Runs Stage 0 (claim) + the 9 core stages, including the Gate-A.5 change-manifest gate, Gate-A.7 design-review gate, and Stage 5.5/5.6/5.7/5.8 quality gates, + Stage 10 (completion):
**work claim → brainstorm → spec → evals → change-manifest → design-review → worktree implementation → tests → E2E/VISUAL verification → simplify → targeted verification rerun → sandbox-install verify → cross-family review → PR → merge/deploy → publish/broadcast/ensure → completion**

---

## Cost routing

- **Claude (whale, Opus):** brainstorm, spec, eval-design, gate decisions, synthesis, catch hallucinations. Reads conclusions, never re-executes. Delegates cheap orchestration (deploy/git/poll) to a **Haiku sub-agent**, and cross-family review to the **`judge-panel` skill** — Opus is the last resort, not the default.
- **Codex teammates:** all implementation, tests, repo investigation. Run via `codex exec` from Bash. Parallel where independent. Codex writes ALL code.
- **Gemini/agy:** browser, smoke tests, large-file review via `agy`/Gemini. 50x cheaper. NEVER handed secrets.

Cost routing is now CODIFIED, not prose-only: `rules/cost-routing-gate` is the hard PreToolUse Edit/Write/Bash enforcement layer for fresh `/ship-feature` runs, blocking in-session source writes and deploy/poll loops in the live worktree and routing them out-of-process to `codex exec` or `claude --model haiku -p`; it complements the codi v4.34.0 advisory nudge rather than replacing it.

Note: `gemini-delegate.ts` now invokes `agy` (Antigravity, Ultra quota). Treat legacy `agly` references as migrated to `agy`.

### Model & size right-sizing (per task class)

Pick the cheapest agent + smallest model that does the job WELL. **If you're unsure which model or size fits a task, ASK the user — do not default to the whale.**

| Task class | Agent | Model / size |
|---|---|---|
| Deploy (railway up, push, poll, curl), file moves, git plumbing — needs an orchestrator to run + watch, but ZERO Opus judgment | **Haiku sub-agent** (`claude --model haiku -p` or Agent `model: haiku`) | **Haiku — ~20x cheaper than whale.** Whale NEVER babysits deploy/poll loops |
| Code implementation / tests / repo investigation | Codex (`codex exec`) | default; raise reasoning only for genuinely hard logic |
| Browser-driving, prod smoke, large-file reads, media review | agy/Gemini | **Flash (Low/Medium)** — cheap, mechanical |
| E2E + VISUAL verification (Stage 5.5 screenshots, console, flows) | **Claude + agy/Gemini-vision** | **Claude owns UI/visual design-lane judgment; agy reviews the ACTUAL rendered screenshots, not diffs.** Use Playwright/dev-server; use `chrome-devtools-mcp` when authenticated state matters |
| Cross-family review / adjudication | **co-dialectic `judge-panel` skill** (fish cascade → 1 tiebreaker) | Flash/nano fish first; whale only if panel escalates AND stays conflicted |
| Behavior-preserving simplify pass (Stage 5.6) | Codex / existing Claude Code **`/simplify`** skill | Quality-only: reuse/simplification/efficiency/altitude cleanups. Fall back to Codex-routed simplify only if `/simplify` is not invokable in-pipeline |
| Media generation (image/video) | agy | gemini-3-pro-image / Veo |
| UI / frontend / visual design / UX / styling / layout | **Claude (design persona — Jony Ive caliber)** | **Claude — UI is design judgment, NOT mechanical. Route UI/visual work to Claude, never Codex or agy.** |
| FREQUENT structural/semantic gates (codification-verification, named-person, content/path gates — fire every Write/Edit; ambiguity/structure, not deep reasoning) | their handler's LLM judge | **Haiku** (`CYBORG_SEMANTIC_JUDGE_MODEL`, default `claude-haiku-4-5`) — cheap, high-frequency |
| Brainstorm, spec, eval-design, gates, hallucination-catch, synthesis | Claude (whale, Opus) | the only Opus-justified work |

Rule of thumb: there is almost always SOME orchestrator — the question is which size. Deterministic task (deploy, curl, git op) → **Haiku sub-agent**, never the Opus whale. Mechanical task (scroll a page, read a file, convert text) → **Flash**. Cross-family review → **reuse `judge-panel`**, don't re-derive. Only true judgment/gating/synthesis earns Opus tokens. Ambiguous class → **ask**.

---

## Run EVERY stage as a team — `TeamCreate` + superpowers (the core orchestration)

**The default execution model for this pipeline is parallel agent teams, NOT serial single-agent work.** Each stage below is decomposable, so each stage is a candidate for **`TeamCreate`** — spin up a team for the stage's parallel work, let the teammates run concurrently, synthesize, move on. Do NOT hand-roll serial `codex exec` or run a lone subagent when a stage decomposes. Use the **superpowers** skills to run the teams:

- **`superpowers:brainstorming`** — Stage 1 design exploration.
- **`superpowers:writing-plans`** — Stage 2 spec.
- **`superpowers:subagent-driven-development`** + **`superpowers:dispatching-parallel-agents`** + **`superpowers:using-git-worktrees`** — Stage 4 parallel implementation.
- **`superpowers:test-driven-development`** — Stage 5.

Per stage, the team shape:

| Stage | TeamCreate the team as… |
|---|---|
| 1 Brainstorm | N agents each explore a DIFFERENT approach/angle → judge-panel the approaches → synthesize the winner (+ graft best ideas from runners-up). |
| 3 Eval design | one teammate per eval dimension (happy/boundary/environmental) drafting assertions in parallel. |
| 3.5 Plugin/skill eval loop | a teammate per (prompt × {with-skill, baseline}) pair — the with-skill-vs-baseline runs ARE the team. |
| 4 Implement | decompose into INDEPENDENT workstreams; **one teammate per workstream, each in its OWN git worktree** (isolation guard), each delegating code to Codex; merge when all green. Dependent edits stay serialized within a teammate. |
| 5.5 E2E + VISUAL verification | split by route/flow/viewport when useful; Claude owns the UI/visual verdict and routes actual rendered screenshots to agy/Gemini-vision. |
| 5.6 Simplify | invoke the existing `/simplify` skill over the changed code; if unavailable, use a Codex-routed quality-only pass. Keep it behavior-preserving and discard on regression. |
| 5.7 Targeted verification rerun | Codex reruns impacted tests/lint/typecheck/build; rerun 5.5 too when simplify touched UI files. |
| 6 Cross-family review | the `judge-panel` cascade already IS a parallel team (≥2 cross-family fish + tiebreaker) — reuse it, don't re-derive. |

Each teammate: owns its piece, works in an isolated worktree (never the shared primary checkout), reports back via SendMessage. Team-lead synthesizes. **A stage that decomposes and is run serially is a routing failure** — the parallelism is the point.

---

## Gate model

Run autonomously through reversible work. Gate A is always a human stop; Gate B is a locked merge gate whose default is autonomous merge on CI green.

- **GATE A:** human approves `docs/plans/<slug>.md` spec — STOP.
- **GATE B:** locked merge gate, not a mandatory human stop. DEFAULT = auto-merge on CI green (`gh pr merge --auto --squash`). STOP at PR for a human only when the session or ticket carries the single brake, or risk auto-applies it: **"human merge needed"** / `human-merge`. See Stage 8 for the exact locked model.
- **GATE A.5 (Change-Manifest):** between Gate A and the build — a fail-hard cross-family check that the build's Change Manifest enumerates every removal/migration the spec implies. A "replaces"-language spec with an empty `− removed`/`⚙ migrated` is BLOCKED (names the missing removal + remediation). See **Gate-A.5**.
- **GATE A.7 (Design-Reasoning Review):** between Gate-A.5 and Stage 4 — an enforced design review of the approved spec + Change Manifest. Missing/stale/RED/UNREACHABLE verdicts BLOCK Stage 4 through `rules/design-review-gate`, not prose.

Never gate reversible work. Brainstorm/spec before Gate A, and change-manifest/implementation/test/E2E-visual/simplify/rerun/review/PR between Gate A and Gate B, should run without extra interrupts unless user intent is ambiguous or data integrity is at risk.

---

## Board mapping

Backlog→Design(spec)→Build(worktree `feat/<slug>`)→Review(PR+verdict)→Deploy(id)→Done(smoke GREEN)

---

## Stage 0 — Work claim

Before Spec/Gate A, parse `$ARGUMENTS` enough to identify:

- `ticket`: required Linear issue id. If absent, stop and create/find the Linear ticket first.
- `slug`: kebab-case feature/bug slug.
- `repo`: explicit repo path from args, else current repo.
- `session`: stable id for this `/ship-feature` run.
- `branch`: `feat/<slug>`.
- `worktree`: planned worktree path for Stage 4.
- `host`: current machine hostname.

**Freshness preflight (XOS-112 coupling, light only).** Before claiming work, check the installed runtime's broadcast state if it is exposed. If a broadcast says a newer REQUIRED `/ship-feature` version exists and this loaded skill/plugin version is stale, refuse to start and tell the user to reload/update before continuing. Do not build XOS-112 broadcast infrastructure here; this skill only consumes that signal when present. When shipping a new REQUIRED `/ship-feature` version, the release path should emit a `requires_reload` broadcast so old loaded agents stop cleanly.

Run the Linear claim gate and abort the whole pipeline on any non-zero exit:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/rules/sdlc-work-claim/handler.ts '{"action":"claim","ticket":"<ticket>","session":"<session>","branch":"feat/<slug>","host":"<host>","worktree":"<worktree>"}'
```

This is the cross-machine work-allocation lock. Do not continue if another live session owns the ticket. Refresh it with `action=heartbeat` at stage transitions and release it with `action=release` when abandoning the run.

**Filesystem isolation (companion to the ticket lock).** The ticket lock prevents two sessions taking the same *ticket*; it does NOT prevent two sessions colliding in the same git working copy of a SHARED repo. When this run mutates a shared brain/infra repo (default `~/cyborg`), do it from a per-session worktree, never the shared primary checkout — `git -C ~/cyborg worktree add /tmp/cyborg-<slug> -b feat/<slug> origin/main`, commit there, `push origin HEAD:main`. This is enforced by the `sdlc-worktree-isolation` PreToolUse Bash gate (`${CLAUDE_PLUGIN_ROOT}/rules/sdlc-worktree-isolation/handler.ts`), which BLOCKS mutating git ops against the shared primary checkout. Root fix (eliminate the shared primary entirely) tracked in XOS-44.

---

## Stage 1 — Brainstorm

Parse `$ARGUMENTS` into:

- `slug`: kebab-case feature/bug slug.
- `ticket`: required Linear issue id.
- `repo`: explicit repo path from args, else current repo.

**Run this via `superpowers:brainstorming`** — not a lone ad-hoc brainstorm. Explore several DISTINCT approaches/angles in parallel, judge-panel them, and synthesize the winner (grafting the best ideas from runners-up). The brainstorm covers the smallest valuable feature slice, user impact, likely repo surfaces, risks, and rollback path.

**Brainstorm AS the domain's 0.001%-caliber persona** (co-dialectic Protocol 11), not a generic voice: UX / visual / product-design → Claude **design persona (Jony Ive caliber)**; architecture / systems → **Jeff Dean**; positioning / naming / launch → **Steve Jobs**; data / metrics → **Nate Silver**; debugging → **Linus Torvalds**. Cross-domain features → fuse personas (e.g. Ive + Jobs for a UX launch). The right expert's brainstorm beats a generic one — the same routing the cost table already mandates for UI work, applied at brainstorm time.

If the feature intent cannot be inferred from `$ARGUMENTS` + repo context, ask one clarifying question. Otherwise continue.

---

## Stage 2 — Spec

**Run this via `superpowers:writing-plans`.** Claude writes `docs/plans/<slug>.md` in the target repo using the writing-plans discipline.

A Linear ticket is required for any non-trivial change because it is the cross-machine work-claim unit. The only exception is the trivial single-file doc edit carved out in MANDATORY SCOPE.

Required sections:

```markdown
# <Feature Name>
status: design
slug: <slug>
ticket: <ticket>
repo: <repo-path>

## What
<1-3 sentences>

## Why
<user/product outcome>

## Scope
- In:
- Out:

## Acceptance criteria
- [ ] <specific, testable criterion>

## Test plan
- [ ] <test/eval that will prove the feature works>

## Rollback
<how to undo safely>
```

Reasoning validation, when warranted, is covered by the cross-family judge-panel (Stage 6).

**GATE A — STOP:** present the spec path and ask for human approval before proceeding.

---

## Stage 3 — Eval / acceptance criteria up front

After Gate A approval, Claude tightens the acceptance criteria and eval plan before any code is written.

Output for Codex:

- exact tests/evals to add or run
- expected pass/fail signals
- manual smoke path if automated coverage is insufficient
- files/areas likely in scope

Claude does not implement.

---

## Stage 3.5 — Plugin / Skill eval loop (agent team) — CONDITIONAL

**Fires ONLY when the target is a plugin or a skill** (new or improved SKILL.md, a co-dialectic/career-intelligence/xos plugin skill, etc.). For plain code/bug/config work, skip to Stage 4.

A skill that isn't proven to beat baseline is unshipped quality. Run the **skill-creator eval loop via a Claude AGENT TEAM** (this work is inherently parallel — that is the point):

1. Write 2–3 realistic test prompts a real user would say.
2. **Spawn a Claude agent team** — for each test prompt, a **with-skill** subagent and a **baseline** subagent (no skill / previous version), launched in the SAME turn (parallel, not serial). This is the agent-team work; do NOT serialize it.
3. Grade each run against assertions → `grading.json`; aggregate → `benchmark.json` (pass-rate, time, tokens, delta vs baseline).
4. Generate the eval-viewer and present results to the human; collect feedback.
5. Iterate the skill until it beats baseline on the discriminating evals. The loop closes when with-skill clearly wins, not at first draft.

Gate: a plugin/skill does NOT proceed to PR/Gate B until the eval loop shows it beats baseline (or the human explicitly waives it). Reference: the skill-creator skill + `eval-viewer/generate_review.py`.

---

## Gate-A.5 — Change-Manifest gate (spec → build)

Runs after Gate A (spec approved) and Stage 3.5, BEFORE Stage 4 (Codex build). FAIL-HARD.

**Why:** LLM builders are structurally biased toward additive, visible output — an "add" is a rewarded diff; a "remove/migrate" is invisible work with no forcing function, so it silently drops. When a spec says "X **replaces / supersedes / instead of / deprecates** Y," the build ships X but omits the deletion/migration of Y; nothing fails, so duplicate/dead surfaces reach prod and are caught only by the human at review — the exact QA-tax this pipeline exists to remove. A required removal slot flips an omitted removal from an unknown-unknown into a checkable contradiction at the cheapest point (plan-time, pre-code) and collapses the interpretation variance of "replaces" to zero.

**The manifest.** Before any code is written, Claude (team-lead, from the Stage 3 scope) emits a file-level **Change Manifest** — every intended change in four required buckets, plus pseudocode for non-trivial logic:

```
+ added     <path>          — new file / symbol
~ modified  <path>          — edited in place
− removed   <path|symbol>   — deleted / stops rendering / dead-code excised
⚙ migrated  <from> → <to>   — moved / renamed / replaced; old path retired
```

Every bucket MUST be present. An empty bucket is written explicitly as `− removed: (none)` so an omission is a stated claim, never a silent gap.

**BLOCK contract (fail-hard).** A cross-family **judge-panel** (the Stage 6 harness, run early here) checks the manifest against the approved spec:

- If the spec uses "replaces / supersedes / instead of / deprecates / retires / migrates" (or a clear synonym) about an EXISTING surface, AND both the `− removed` and `⚙ migrated` buckets fail to account for that surface → **BLOCK**. The error MUST name (a) the spec sentence implying a removal, (b) the unaccounted surface, and (c) the remediation ("add the `− removed` / `⚙ migrated` entry for <surface>, or amend the spec to state the old surface stays").
- FAIL-HARD: on BLOCK the pipeline does not advance to Stage 4. Judge unreachable ⇒ treat as BLOCK (no silent skip), same contract as the Stage 6 fish-required gate.

**Output.** The approved Change Manifest is appended to `docs/plans/<slug>.md` under `## Change manifest` and handed to Stage 4 as the authoritative build scope: Codex builds exactly the manifest; Stage 5.5/6 verify nothing outside it changed and every `− removed` surface is actually gone.

---

## Gate-A.7 — Design-Reasoning Review (Fable persona-jury)

Runs after Gate-A.5 and before Stage 4. This is the design-time twin of Gate-A.5 and Stage 6: A.5 checks that removals/migrations are accounted for, Stage 6 reviews built code, and A.7 reviews the spec + Change Manifest reasoning where most defects are born.

**Stakes routing.** T0/T1 mechanical changes may skip only by the objective skip-rule in `skills/ship-feature/design-review/run.ts`: small file count, all paths in the mechanical allowlist, no new public surface, and no behavior flag. Never skip because the orchestrator self-declared a low tier. T2 runs the Fable reviewer alone. T3+ adds a cross-family reviewer when available; if unavailable, the verdict records `cross_family: unavailable`.

**Verdicts.** `GREEN` proceeds. `YELLOW` proceeds only when adjustments are Class A, or when any Class-B finding is left unapplied and Stage 4 builds the original reviewed spec. Class A is additive/clarifying with no scope, behavior, or DoD change. Class B changes scope, removes/alters a requirement, or changes user-visible behavior/DoD; it is never auto-applied and goes to Gate B for human judgment. `RED` stops. Max two RED cycles: scoped re-review asks only whether prior findings were addressed; a second RED writes escalation and parks the run.

**Enforcement.** Run `bun run ${CLAUDE_PLUGIN_ROOT}/skills/ship-feature/design-review/run.ts docs/plans/<slug>.md` before any Stage-4 `codex exec` or `git worktree add ... -b feat/*`. The sidecar `docs/plans/<slug>.design-review.json` is the machine-checked artifact. `rules/design-review-gate` FAIL-HARD blocks Stage 4 when the sidecar is missing, stale by `spec_sha256`, RED, UNREACHABLE, or records an applied Class-B adjustment. Activation is human-gated like `ship-feature-gate`: the handler enforces this contract when invoked (and when a human wires it as a PreToolUse hook in `~/.claude/settings.json`); the run.ts + gate invocation above is the operative path until then.

**Fails closed (the XOS-56 fix).** The earlier reasoning gate (XOS-48) was removed (XOS-56/59) because it fail-OPENED when `claude-fable-5` was unavailable — a gate that silently passes is worse than none. This gate FAILS CLOSED: if the reviewer CLI is unreachable or returns unparseable output, run.ts records `UNREACHABLE`, which BLOCKS Stage 4. Reintroducing `claude-fable-5` is safe precisely because an unavailable model now blocks instead of waving work through.

---

## Stage 4 — Implement in git worktree (as a TEAM)

**This stage is `TeamCreate` work by default — run it via `superpowers:subagent-driven-development` + `superpowers:dispatching-parallel-agents`.** Decompose the change into INDEPENDENT workstreams; spin up an implementation team with **one teammate per workstream, each in its OWN git worktree** (`superpowers:using-git-worktrees` — never the shared primary checkout). Each teammate delegates the actual code to Codex (`codex exec`). Dependent edits stay serialized inside one teammate. Merge when all workstreams are green. Running independent workstreams SERIALLY here is the exact failure this skill exists to prevent.

Codex owns repo investigation and ALL code changes (the teammates route to it):

```bash
# each teammate, in its own worktree:
git -C <repo> worktree add /tmp/<repo>-<workstream> -b feat/<slug>-<workstream> origin/main
```

Claude reads Codex conclusions and diffs only; Claude (team-lead) never re-executes implementation work — it decomposes, dispatches the team, and synthesizes.

Use Codex for:

- code investigation
- implementation
- migrations/config changes
- tests and fixtures
- local verification

Claude reads Codex conclusions and diffs only; Claude never re-executes implementation work.

---

## Stage 5 — Tests + evals green

**Run this via `superpowers:test-driven-development`** (spec → tests → implementation → green). Codex runs the Stage 3 test plan in the worktree under TDD discipline.

Required:

- automated tests green
- acceptance evals green
- lint/typecheck/build green when present
- no unrelated changes

Any failure returns to Stage 4 until green.

---

## Stage 5.5 — E2E + VISUAL verification — CONDITIONAL

Run this after Stage 5 is green and before Stage 6 review.

Trigger:

- **Required** when the change touches frontend, UI, styles, routes, visual assets, browser-visible behavior, or UI/manual-smoke acceptance criteria.
- **Backend-only** changes skip as `not_applicable`, with evidence: files touched plus why no browser-visible behavior or UI acceptance criteria were affected.
- **Plugin/CLI products with no web UI** degrade to CLI-output/render verification: run representative commands at narrow and standard terminal widths, then assert no stack traces, broken tables, clipped output, or missing/incorrect help text.

Tools:

- **Web UI:** run the branch on a LOCAL dev/preview server in the worktree (`npm run dev` -> localhost, or equivalent); never verify local changes on prod. Use Playwright against local dev, authenticating in-process with test credentials from the repo's local secret store or credential provider; NEVER echo/log the password. Use the skill-creator eval/benchmark + Playwright harness to drive critical flows and screenshots at desktop width `1440` and mobile width `375`; use `chrome-devtools-mcp` / authenticated Chrome on port `9222` when browser state matters. Do not pass secrets to external reviewers.
- **Web UI visual verdict:** send ACTUAL rendered screenshots to the cross-family `judge-panel` with domain personas (`--persona "Steve Jobs" --persona "Jony Ive"` for UX/visual; XOS-124), plus `agy`/Gemini-vision when useful. Claude owns the final visual verdict.
- **Plugin/CLI (no web UI):** run representative commands/flows at narrow and standard terminal widths; capture stdout/stderr; optionally capture a terminal screenshot for `agy`/Gemini-vision if visual review is useful. Do not pass secrets.
- **Sensorium routing:** visual/UI e2e is a sensorium faculty headless agents lack; route it to an organ-with-eyes (authenticated browser session, `chrome-devtools-mcp` on port `9222`, or the human). Do not ask a headless agent to "verify visually"; it will fake it. The CLI path can stay with the running session.

Web UI process:

- Dogfood the real customer path: real UI + real flow + real auth (E2E user) + real data. Verification via direct-DB / `tsx` / service-role scripts, component-isolation render, or standalone demo harness does not count.
- Capture the local Playwright run: assertions, console state, screenshots, and skill-creator eval/benchmark result.
- Attach screenshots the proven-reliable way for a PRIVATE repo: commit the PNGs to the tracked `docs/verify/<ticket>/*.png` path (desktop ~1280 + mobile ~390) and push to the PR branch — committed PNGs RENDER in the PR's "Files changed" tab, which is the guaranteed proof a viewer can see in one click. (Repo `.gitignore` typically ignores loose screenshots but ALLOWS `docs/verify/` — commit to that tracked path.) Then add a PR comment listing each committed screenshot and what it shows. Do NOT rely on `raw.githubusercontent...` / release-download asset URLs (they 404 for a viewer on a private repo) or on inline-in-description `github.com/user-attachments/...` assets (those need a GitHub web-UI drag-drop or an undocumented upload API — not reliably scriptable by a cell).

Pass/fail:

- **Web UI `PASS`:** ran on LOCAL dev/preview, not prod; authenticated local dev through Playwright with E2E creds; dogfooded the real customer path through real UI/auth/data, not a bypass or demo harness; desktop and mobile screenshots are non-blank; no overflow, clipping, incoherent overlap, or broken responsive layout; no critical console errors; critical Playwright eval/benchmark flows pass; persona `judge-panel` returns `GREEN`; screenshots are committed to `docs/verify/<ticket>/` and pushed so they render in the PR's "Files changed" tab for the reviewer (NOT raw/release/user-attachments URLs that 404 on a private repo).
- **Plugin/CLI `PASS`:** commands exit cleanly with no stack traces or errors; stdout/stderr is well-formed at both widths with no broken tables, clipped/overflowing output, or garbled layout; help/usage text is present and correct; optional terminal-screenshot vision review returns `GREEN` if used.
- **Backend-only `not_applicable`:** unchanged: include evidence with files touched plus why no browser-visible behavior or UI acceptance criteria were affected.
- **`FAIL` (either mode):** any required check fails. Loop to Stage 4/5, fix, rerun automated tests, then rerun Stage 5.5.

---

## Stage 5.6 — Real `/simplify`

Run this after Stage 5.5 is `PASS` or `not_applicable`, before Stage 6 review.

Invoke the existing Claude Code built-in `/simplify` skill over the changed code. Its lane is: review changed code for reuse, simplification, efficiency, and altitude cleanups; apply fixes; quality-only. **Do not build a new simplify skill.**

If `/simplify` is not invokable from the pipeline context, fall back to a Codex-routed simplification pass with the same behavior-preserving constraint.

Allowed changes:

- dedupe obvious repeated logic
- remove dead code, stale comments, and unused dependencies introduced or exposed by the change
- simplify over-abstraction
- improve names when the diff becomes clearer
- keep public behavior, APIs, schemas, UI, and acceptance semantics unchanged

Forbidden changes:

- broad refactors unrelated to the ticket
- feature or UX changes
- API/schema/migration behavior changes
- acceptance-criteria changes

Discard the simplify patch on any behavior change, acceptance drift, or test failure.

---

## Stage 5.7 — Targeted verification rerun

After Stage 5.6, rerun the impacted verification set before Stage 6:

- tests/evals affected by the changed files
- lint, typecheck, and build when present and relevant
- any Stage 3/5 checks that cover code touched by simplify
- Stage 5.5 again if simplify touched UI, styles, routes, visual assets, browser-visible behavior, or CLI rendering

If the rerun fails because of the simplify patch, discard the simplify patch and rerun Stage 5. If the failure persists without the simplify patch, return to Stage 4/5 and fix the underlying issue.

---

## Stage 5.8 — Plugin / skill sandbox-install + turn-on verification — CONDITIONAL

Run after Stage 5.7 is green and before Stage 6. **Fires by SHIPPED-ARTIFACT-CLASS, not path-glob:** any change whose shipped artifact is a plugin, skill, or engine, OR that touches a shared `install.sh`, `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, or a vendor path. Plain app/code/config work → skip to Stage 6.

**Why:** "merged" ≠ "activated." A plugin can pass tests, merge, and even install, yet fail to actually TURN ON — the skill doesn't activate, the engine entrypoint throws, a hook doesn't fire, or the version-consistency gate rejects it at install. That failure is invisible until a user installs it — the exact defect that killed codi (source at 4.30.0, vendored/installed at 4.27.0, statusline stale; nobody caught it until a human saw codi dead). This stage moves that discovery left of the user.

**Step 1 — sandbox install (ISOLATED, never the live env).** Install the just-built plugin into a throwaway sandbox: a temp `HOME` and temp `CLAUDE_PLUGIN_DATA` exported for the subprocess only. NEVER install into the live `~/.claude` from the pipeline. Confirm the install completes with zero errors (version-consistency, manifest parse, file layout).

**Step 2 — turn-on verify INSIDE the sandbox.** Prove the artifact ACTIVATES, not merely name-resolves:
- **skill:** it must ACTIVATE on its trigger (produce its behavior / load its body), not just appear in a registry listing.
- **engine / plugin:** run a real entrypoint (a command or skill it provides) and confirm non-error output.
- **hooks:** the hooks it registers must fire (e.g., a UserPromptSubmit / Stop hook emits its expected marker).

**Step 3 — FAIL-HARD.** If the sandbox install fails OR the artifact does not turn on, BLOCK: return to Stage 4, fix, rerun Stage 5 → 5.5/5.6/5.7 as applicable, then rerun 5.8. Do NOT advance to Stage 6 on a plugin that installed but did not activate. Sandbox unavailable ⇒ BLOCK (no silent skip) — same contract as the other fail-hard gates.

**Output:** a one-line turn-on receipt (artifact-class · sandbox path · activated=yes) carried into the Stage 6 review and the PR body.

---

## Stage 6 — Cross-family review

This stage is NON-OPTIONAL. The pipeline runs the cross-family judge between green build and PR — there is no decision to skip, and (running on cheap fish: agy + codex, off the Opus wall) no cost reason to. A PR produced without this stage is a pipeline violation the merge gate (Stage 8) will refuse.

Run cross-family review after Stage 5.8 is green and before PR.

Use `agy`/Gemini for:

- large diffs
- large files
- browser-visible behavior
- smoke-review candidates

Do not pass secrets to Gemini/agy.

**Use the co-dialectic `judge-panel` skill** for the verdict — it runs ≥2 cheap cross-family fish (Gemini-Flash + GPT-nano) first and escalates to ONE expensive tiebreaker only on disagreement. Do NOT make the Opus whale the default judge. The whale steps in only if `judge-panel` escalates AND the tiebreaker still can't resolve. Whale always does the final hallucination-catch (cheap: scan, don't re-execute).

**Apply domain-persona lenses, not only cross-family.** Cross-*family* (Gemini + GPT) catches training-distribution blind spots; cross-*persona* catches domain blind spots. For UX / visual artifacts, run the judge with `--persona "Steve Jobs" --persona "Jony Ive"` (as Stage 5.5 already does); for architecture use a systems-caliber lens, for data a statistical lens. Route the persona set by the artifact's domain.

**FAIL-HARD if no fish are reachable:** if `judge-panel` cannot reach ≥1 cross-family fish, HALT the pipeline and surface this fish-remediation block. NEVER silently skip and proceed to PR. This mirrors the FAIL-HARD invariant and co-dialectic Protocol 8 T3 behavior.

```text
FISH REMEDIATION REQUIRED
WHAT: Stage 6 cannot reach any cross-family judge fish, so the /ship-feature pipeline is halted before PR.
HOW: restore at least one cross-family judge route (agy/Gemini or Codex/OpenAI), fix auth/network/tool installation, rerun judge-panel, and only continue once ≥1 fish returns a result.
```

Required verdict: `GREEN` or `RED`.

If `RED`, Codex fixes and returns to Stage 5, then repeats Stage 5.5/5.6/5.7 and Stage 5.8 as applicable before review runs again.

At the END of Stage 6, emit the canonical receipt block below, populated from the `judge-panel` JSON: `final_verdict` → `verdict` (`GREEN`/`RED`), families that returned → `families`, `all_flags` count plus one-line summary → `flags`, `cascade.escalated` → `escalated`, and the current ISO8601 timestamp → `ts`.

```markdown
<!-- ship-feature-judge-receipt:v1 -->
## 🧪 Cross-family judge receipt
- verdict: GREEN | RED
- families: <comma list of families that actually returned, e.g. google, openai>
- flags: <count> — <one-line summary or "none">
- escalated: yes | no
- ts: <ISO8601>
```

---

## Stage 7 — PR

Codex creates an unmerged PR:

```bash
gh pr create --fill
```

PR must include:

- spec link: `docs/plans/<slug>.md`
- tests/evals run
- Stage 5.5 visual/CLI verification status
- Stage 5.6 simplify summary and Stage 5.7 rerun status
- the cross-family judge RECEIPT block (the `ship-feature-judge-receipt:v1` marker + verdict/families/flags/escalated/ts) — verbatim from Stage 6. The merge gate (Stage 8) BLOCKS any PR whose body lacks this receipt.
- known risks / rollback

Do not merge.

---

## Stage 8 — Merge + deploy

Before merge or push, re-check the Linear claim:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/rules/sdlc-work-claim/handler.ts '{"action":"check","ticket":"<ticket>","session":"<session>"}'
```

Abort unless the command exits 0 and the JSON still shows `owner_session` equal to this run's `session`, `reclaimable:false`, and a fresh heartbeat. A session that lost or released the claim must not merge, push, or deploy.

**Merge gating (LOCKED 2026-06-09 — Gate B; NO GitHub branch protection):**
ONE concept, ONE phrase to remember: **"human merge needed"** (matches the `human-merge` Linear label). Default is autonomous; this phrase is the only brake. No invented keywords (no "coffee"/"non-auto"), no files, no session-ids.

**Cross-family receipt backstop (XOS-138):** `ship-feature-gate` now FAIL-HARD blocks `gh pr merge` when the target PR body lacks the `ship-feature-judge-receipt:v1` receipt from Stage 6. This is the structural backstop for the human-visible receipt in the PR body.

```text
DEFAULT = auto-merge on CI green  (gh pr merge --auto --squash)
STOP at PR for a human to merge IF either:
  • the user says "human merge needed" in the session   → that session stops at PR
  • the ticket has the `human-merge` label (or says "human merge needed" in its text) → that ticket stops at PR
```

- **Two scopes, same words.** Say it in a session → the whole session stops at PR. Put it on a Linear ticket → that ticket stops at PR. Nothing said = auto. The conversation/ticket IS the state — nothing shared across sessions, so no collision by construction.
- **Session state:** `ship_mode != "auto"` is the session-scope brake created by the exact phrase **"human merge needed"**.
- **Auto-escalation (defense in depth):** the build agent AUTO-APPLIES `human-merge` when the diff hits a risk heuristic even if the human didn't say it — publishing/irreversible surface (Substack/LinkedIn publish), auth/secrets, schema migration, large blast radius, OR judge-panel RED. Maps to stakes tiers (T0–T2 auto, T3+ human).
- **Adapt AI:** human-merge always — not via this local flow at all; AdaptAI builds route through Tier-2 cloud; the ship command's personal-repo allowlist NEVER touches `~/aifund-adaptai`.

If Gate B stops, present the PR URL, review verdict, test summary, deploy plan, and the `human-merge` reason. Do not merge or deploy.

If Gate B does not stop, **hand merge + deploy to a Haiku sub-agent** (`claude --model haiku -p` or Agent `model: haiku`) — the Opus whale must not watch the build/poll loop.

1. The Haiku sub-agent queues the autonomous merge:

```bash
gh pr merge --auto --squash
```

2. After the PR is merged, if the repo has a relevant `ship-*` command, the Haiku sub-agent runs that.
3. Else the Haiku sub-agent runs the default deploy path:

```bash
git pull --ff-only origin main
railway up -y
# poll deploy until SUCCESS
# curl production URL and verify expected response
```

Haiku reports back the deploy id + SUCCESS/curl status. Record the deploy id.

---

## Stage 9 — PUBLISH + BROADCAST + ENSURE

Run only after Stage 8 merge/deploy is confirmed. For human-merge PRs, this fires on merge-detection once the PR reaches main. "Shipped" means activated across the running swarm/users, not merely merged.

Detect the artifact class from the merged diff and run every matching recipe. Each recipe must include a LOUD skew check before PASS; stale activation is `RED`, not "done".

- **plugin / skill / engine** (`plugins/**`, `skills/**`, `engines/**`, `.claude-plugin/**`) — PUBLISH: vendor the merged `origin/main` source into the marketplace (`git archive` merged main → `agent-marketplace/engines/<plugin>/`), bump `agent-marketplace/.claude-plugin/marketplace.json`, and push. BROADCAST: post the bus bulletin (Linear comment / AGENTS) with `<plugin>@<new-version>`, reinstall path, and what changed. ENSURE: carry `requires_reload: <plugin>@<new-version>` so sessions run `claude plugin install <plugin> && /reload-plugins`; run `bun run ${CLAUDE_PLUGIN_ROOT}/rules/ship-feature-publish-gate/handler.ts` for `<plugin>` or `all` and treat any `⚠ STALE` line as the loud reload block until remediated.
- **cyborg substrate** (`constitution/**`, `.githooks/**`, `rules/**`) — PUBLISH: push `origin/main`. BROADCAST: file a bus delegation to the CYBORG AGENT with the merged SHA and changed substrate paths. ENSURE: the CYBORG AGENT runs the shared `~/cyborg` primary-sync (`stash` + `pull`) and reports the shared primary HEAD. The xos pipeline ROUTES this lane only; it never syncs the shared primary itself. Skew check: delegation stays loud until shared primary HEAD equals `origin/main`.
- **workspace settings/config** (MCP, `workspace.manifest.yaml`) — PUBLISH: edit the manifest as the root of truth. BROADCAST: publish the manifest version/hash and impacted agents/tools. ENSURE: run `sync.sh` to compile and propagate to every agent + tool. Skew check: generated target hashes/versions must match the manifest or list each stale target loudly.
- **SaaS / web product** — PUBLISH: the Stage-8 deploy. BROADCAST: deploy id, expected build/client-bundle version, flags, and migrations. ENSURE: cache/CDN bust, client bundle version-bump, client reload path (service-worker update / "new version" prompt), feature-flag flip, and migration applied. VERIFY a live user receives the new version, not a cached old bundle. Skew check: live build id/bundle version/flag/migration state must match expected or list the stale surface loudly.
- **backend-only / non-distributable** — `not_applicable` with evidence: changed files, service boundary, and why no plugin cache, shared substrate, workspace manifest, client bundle, flag, migration, or distributable artifact needs activation.

Stage 9 result must be `GREEN`, `RED`, or `not_applicable` with evidence. Declare done only after Stage 9 is `GREEN` or `not_applicable`.

---

## Stage 10 — Completion protocol

After Stage 9 PUBLISH+BROADCAST+ENSURE is `GREEN` or `not_applicable`, close the loop. Three artifacts — none optional:

1. **Update the PR body** summary: what was fixed, tests/evals run, judge verdict, deploy/smoke status, Stage 9 publish/broadcast/ensure status, any `requires_reload`, known risks, rollback path.
2. **Post a COMMENT to the Linear ticket AND set it Done.** The `complete` action does BOTH — it does not just flip the status, it writes a structured completion comment so other sessions/humans see WHO did WHAT. The comment carries: *what was fixed · which session + host did it · findings discovered · the PR URL*:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/rules/sdlc-work-claim/handler.ts '{"action":"complete","ticket":"<ticket>","session":"<session>","host":"<host>","summary":"<what fixed>","pr_url":"<pr-url>","findings":"<tests, judge verdict, deploy/smoke, Stage 9 activation/ensure, rollback notes>"}'
```

3. **Confirm** the ticket comment is posted and the state is `Done`.

The ticket comment is the cross-session coordination wire — skip it and the next agent/human can't see who shipped what (GROW-AND-GROW-OTHERS). Do not declare the run complete until Stage 9 evidence is recorded, the `complete` action returns `PASS`, the completion comment is on the ticket, and the ticket is confirmed Done.

---

## Final report

```text
━━━ /ship-feature complete ━━━

Feature:      <slug>
Ticket:       <ticket>
Spec:         docs/plans/<slug>.md
Branch:       feat/<slug>
PR:           <url>
Review:       GREEN / RED
Deploy:       <deploy-id-or-none>
Activation:   GREEN / RED / not_applicable
Reload:       <requires_reload-or-none>
Board:        Backlog→Design→Build→Review→Deploy→Done
```

Loop closes at Stage 9 activation/ensure, not at PR.
