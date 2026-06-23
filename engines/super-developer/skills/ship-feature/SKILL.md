---
name: ship-feature
description: "Use this skill whenever the user asks to implement, build, fix, ship, add, refactor, migrate, or change ANY code — features, bugs, plugins, skills, migrations, hooks, rules, configs, in any repo. Triggers on 'build X', 'fix Y', 'implement Z', 'ship this to <plugin>', a ticket id with code work. This is the Agentic SDLC pipeline; do NOT hand-roll `codex exec` or ad-hoc git/PR shipping — route through Stage 0 (claim), the 9 core stages, and Stage 10 (completion)."
---

## MANDATORY SCOPE

Use this skill whenever the user asks to implement, build, fix, ship, add, refactor, migrate, or change ANY code: features, bugs, plugins, skills, migrations, hooks, rules, configs, in any repo.

Runtime gate paths are plugin-local via `${CLAUDE_PLUGIN_ROOT}`. Keep invoked `bun run` rule/script paths portable; do not restore `~/cyborg` runtime invocations.

This also triggers on phrasing like "build X", "fix Y", "implement Z", "ship this to <plugin>", or a ticket id with code work. Do NOT hand-roll `codex exec` or ad-hoc git/PR shipping. Route the work through this pipeline. The only exception is a trivial single-file doc edit with no code, config, hook, rule, migration, skill, plugin, build, PR, or shipping impact.

# /ship-feature — Cost-Routed Agentic SDLC Pipeline

Trigger: `/ship-feature $ARGUMENTS`

`$ARGUMENTS` = required Linear ticket id plus feature/bug slug and repo context.
Examples: `THE-10 regen-bug`, `THE-10 regen-bug in ~/aiprojects/Adapt.ai`.

Runs Stage 0 (claim) + the 9 core stages + Stage 10 (completion):
**work claim → brainstorm → spec → evals → worktree implementation → tests → cross-family review → PR → merge/deploy → prod smoke → completion**

---

## Cost routing

- **Claude (whale, Opus):** brainstorm, spec, eval-design, gate decisions, synthesis, catch hallucinations. Reads conclusions, never re-executes. Delegates cheap orchestration (deploy/git/poll) to a **Haiku sub-agent**, and cross-family review to the **`judge-panel` skill** — Opus is the last resort, not the default.
- **Codex teammates:** all implementation, tests, repo investigation. Run via `codex exec` from Bash. Parallel where independent. Codex writes ALL code.
- **Gemini/agy:** browser, smoke tests, large-file review via `agy`/Gemini. 50x cheaper. NEVER handed secrets.

Note: `gemini-delegate.ts` now invokes `agy` (Antigravity, Ultra quota). Treat legacy `agly` references as migrated to `agy`.

### Model & size right-sizing (per task class)

Pick the cheapest agent + smallest model that does the job WELL. **If you're unsure which model or size fits a task, ASK the user — do not default to the whale.**

| Task class | Agent | Model / size |
|---|---|---|
| Deploy (railway up, push, poll, curl), file moves, git plumbing — needs an orchestrator to run + watch, but ZERO Opus judgment | **Haiku sub-agent** (`claude --model haiku -p` or Agent `model: haiku`) | **Haiku — ~20x cheaper than whale.** Whale NEVER babysits deploy/poll loops |
| Code implementation / tests / repo investigation | Codex (`codex exec`) | default; raise reasoning only for genuinely hard logic |
| Browser-driving, prod smoke, large-file reads, media review | agy/Gemini | **Flash (Low/Medium)** — cheap, mechanical |
| Cross-family review / adjudication | **co-dialectic `judge-panel` skill** (fish cascade → 1 tiebreaker) | Flash/nano fish first; whale only if panel escalates AND stays conflicted |
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
| 6 Cross-family review | the `judge-panel` cascade already IS a parallel team (≥2 cross-family fish + tiebreaker) — reuse it, don't re-derive. |

Each teammate: owns its piece, works in an isolated worktree (never the shared primary checkout), reports back via SendMessage. Team-lead synthesizes. **A stage that decomposes and is run serially is a routing failure** — the parallelism is the point.

---

## Gate model

Run autonomously through reversible work. Gate A is always a human stop; Gate B is a locked merge gate whose default is autonomous merge on CI green.

- **GATE A:** human approves `docs/plans/<slug>.md` spec — STOP.
- **GATE B:** locked merge gate, not a mandatory human stop. DEFAULT = auto-merge on CI green (`gh pr merge --auto --squash`). STOP at PR for a human only when the session or ticket carries the single brake, or risk auto-applies it: **"human merge needed"** / `human-merge`. See Stage 8 for the exact locked model.

Never gate reversible work. Brainstorm/spec before Gate A, and implementation/test/review/PR between Gate A and Gate B, should run without extra interrupts unless user intent is ambiguous or data integrity is at risk.

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

Claude brainstorms the smallest valuable feature slice, user impact, likely repo surfaces, risks, and rollback path.

If the feature intent cannot be inferred from `$ARGUMENTS` + repo context, ask one clarifying question. Otherwise continue.

---

## Stage 2 — Spec

Claude writes `docs/plans/<slug>.md` in the target repo.

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

Codex runs the Stage 3 test plan in the worktree.

Required:

- automated tests green
- acceptance evals green
- lint/typecheck/build green when present
- no unrelated changes

Any failure returns to Stage 4 until green.

---

## Stage 6 — Cross-family review

Run cross-family review before PR.

Use `agy`/Gemini for:

- large diffs
- large files
- browser-visible behavior
- smoke-review candidates

Do not pass secrets to Gemini/agy.

**Use the co-dialectic `judge-panel` skill** for the verdict — it runs ≥2 cheap cross-family fish (Gemini-Flash + GPT-nano) first and escalates to ONE expensive tiebreaker only on disagreement. Do NOT make the Opus whale the default judge. The whale steps in only if `judge-panel` escalates AND the tiebreaker still can't resolve. Whale always does the final hallucination-catch (cheap: scan, don't re-execute).

Required verdict: `GREEN` or `RED`.

If `RED`, Codex fixes and returns to Stage 5.

---

## Stage 7 — PR

Codex creates an unmerged PR:

```bash
gh pr create --fill
```

PR must include:

- spec link: `docs/plans/<slug>.md`
- tests/evals run
- cross-family review verdict
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

## Stage 9 — Post-deploy smoke

Run production smoke through Gemini/agy.

Smoke result must be:

- `GREEN` — feature works in prod; move to Done.
- `RED` — report exact failure, logs/URL checked, and rollback/fix recommendation.

Declare done only after smoke `GREEN`.

---

## Stage 10 — Completion protocol

After post-deploy smoke is `GREEN`, close the loop. Three artifacts — none optional:

1. **Update the PR body** summary: what was fixed, tests/evals run, judge verdict, deploy/smoke status, known risks, rollback path.
2. **Post a COMMENT to the Linear ticket AND set it Done.** The `complete` action does BOTH — it does not just flip the status, it writes a structured completion comment so other sessions/humans see WHO did WHAT. The comment carries: *what was fixed · which session + host did it · findings discovered · the PR URL*:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/rules/sdlc-work-claim/handler.ts '{"action":"complete","ticket":"<ticket>","session":"<session>","host":"<host>","summary":"<what fixed>","pr_url":"<pr-url>","findings":"<tests, judge verdict, smoke, rollback notes>"}'
```

3. **Confirm** the ticket comment is posted and the state is `Done`.

The ticket comment is the cross-session coordination wire — skip it and the next agent/human can't see who shipped what (GROW-AND-GROW-OTHERS). Do not declare the run complete until the `complete` action returns `PASS`, the completion comment is on the ticket, and the ticket is confirmed Done.

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
Smoke-test:   GREEN / RED
Board:        Backlog→Design→Build→Review→Deploy→Done
```

Loop closes at prod smoke, not at PR.
