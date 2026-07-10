# Cost-routing TEETH — hard PreToolUse gate

status: design
slug: xos-206-cost-routing-teeth
ticket: XOS-206
repo: ~/aiprojects/super-developer-plugin

## What

A new `rules/cost-routing-gate` PreToolUse gate (targets Edit, Write, Bash) that, **only during a genuinely live `/ship-feature` run**, BLOCKS the main-loop model (the "whale") from doing execution work it should delegate: writing/editing SOURCE files in the run's worktree (→ route to `codex exec`), and running long deploy/poll loops (→ hand to a Haiku sub-agent). Wired live in `~/.claude/settings.json` so it actually blocks, not just advises.

## Why

Fable-5 (Mythos-class main loop) sessions running `/ship-feature` bypassed the prose cost-routing instructions and burned tokens doing Stage-4 code and Stage-8 deploy inline instead of delegating to Codex/Haiku. Cost routing was 100% prose in SKILL.md plus an advisory codi nudge (v4.34.0) — zero enforcement. Under task pressure the path of least resistance (do it inline) wins, and the better the whale the stronger the pull. This is the per-action codification of the LLM-OPTIMIZATION invariant (currently `[NOT CODIFIED]`; only a weekly table-revisit schedule exists). Teeth-not-theater, same philosophy as XOS-195/design-review-gate.

## Scope

- In:
  - `rules/cost-routing-gate/` — new rule: `handler.ts` (PreToolUse gate), `manifest.json`, `tests.ts`, `AUDIT.ts`, `WATCH.ts` (mirror the `design-review-gate` rule shape exactly).
  - `skills/ship-feature/SKILL.md` — one paragraph in the Cost-routing section pointing to the gate as the enforcement primitive (mark it codified; reference `rules/cost-routing-gate`).
  - `CHANGELOG.md` + `.claude-plugin/plugin.json` — bump 0.10.0 → 0.11.0.
  - Live wiring block for `~/.claude/settings.json` (PreToolUse Edit/Write/Bash → the gate) documented in the rule README + printed at ship time (machine-local; applied in Stage 9/completion, not committed to the repo since settings.json is machine-local).
- Out:
  - Leak #2 (cheap main-loop orchestration) — separate follow-up ticket.
  - Changing any other gate or the pipeline stages.
  - Cleaning up the 40 stale `~/.ship-feature/active/` zombie markers — separate hygiene ticket (the gate must be robust to them regardless; see AC).

## Design decisions

1. **Live-run detection is heartbeat-fresh, not presence.** `~/.ship-feature/active/` currently holds ~40 stale zombie markers (sessions that never released). A presence check would block every session forever. The gate treats a run as live ONLY if a marker's heartbeat is fresh (`< 30 min`, matching the SDLC WORK-CLAIM reclaimable threshold; reuse the same freshness logic the sibling rules use). No fresh marker → PASS immediately (fast no-op — the common case in any non-ship-feature session).
2. **Path-scoped to the live run's worktree.** The global hook fires in every session. To avoid blocking an unrelated session's edits, BLOCK only when the Edit/Write target path is inside a fresh marker's declared `worktree`/`cwd`/`repo` (marker JSON carries these). Edit outside any live run's worktree → PASS. **Malformed/missing worktree field:** if a fresh marker has no resolvable `worktree`/`cwd`/`repo` (field absent, empty, or not an existing dir), the gate CANNOT path-scope → it PASSes that marker (can't-determine → don't block; consistent with the fail-open philosophy). A source write is blocked only when it resolves inside at least one fresh marker's valid worktree.
3. **Source-vs-allowed split.** Within a live run's worktree, ALLOW paths under `docs/**` and any `*.md` (spec, plan, design-review sidecar, `docs/verify/**` screenshots — legitimate whale artifacts). BLOCK everything else (source: `.ts/.tsx/.js/.jsx/.py/.go/.rs/.java/.rb/.json` config, etc.) with remediation → `codex exec`.
4. **Bash deploy/poll loops.** BLOCK Bash commands matching a deploy/poll-loop signature during a live run, with remediation → **out-of-process** Haiku sub-agent (`claude --model haiku -p` ONLY — NOT the in-session `Agent`/`Task` tool; see decision 8). Precise, conservative match rule (err toward PASS — a false negative is safe, a false positive blocks benign scripts): BLOCK only if the command contains a deploy/watch primitive (`railway up`, `railway redeploy`, `gh pr checks --watch`, `gh run watch`, `vercel --prod` with a following poll) AND a polling construct in the same command (`while`/`until` paired with `sleep`, or a repeated status-check loop); OR a bare `while`/`until` loop that contains BOTH `sleep` and a status/poll command. Everything else — ordinary one-shot Bash (git, tests, curl, a single `railway up` with no poll, reads) — PASSes. Ambiguous → PASS. **Path-scoped like decision 2 (no cross-session false positive):** a matching deploy/poll-loop is blocked ONLY when the Bash invocation `cwd` (provided by the PreToolUse hook) resolves inside a fresh marker's valid worktree. A deploy loop in an unrelated session/repo — even while some other session's ship-feature marker is fresh — PASSes, because its cwd is outside that marker's worktree. If cwd can't be resolved or no fresh marker has a valid worktree, PASS.
5. **Fail-open + bypass.** Handler crash → PASS (never wedge a session). Env bypass `COST_ROUTING_GATE_OFF=1`. FAIL-HARD contract on an intended BLOCK: exit non-zero, message carries `WHAT:` + `HOW:`. Log to `~/.cyborg-enforcement-log.jsonl`.
6. **Codex writes ALL of this** (dogfooding): the whale writes only this spec + wires the live hook + gates/synthesizes. The gate code, tests, AUDIT, WATCH → Codex.
7. **Complements, does not replace, the codi v4.34.0 nudge.** The existing advisory cost-routing nudge (co-dialectic UserPromptSubmit injection) STAYS as the gentle pre-turn reminder layer; this gate ADDS the hard per-action enforcement layer (defense-in-depth). The nudge lives in the co-dialectic plugin and is untouched by this change — hence `⚙ migrated (none)` and `− removed (none)` are correct: no existing surface is retired, the advisory layer and the enforcement layer coexist.
8. **Whale-vs-fish is resolved by IN-PROCESS vs OUT-OF-PROCESS, not by model inspection** (Gate-A.7 findings 1+2). A PreToolUse hook cannot see which model issued the call. It does not need to: correct delegation is *out-of-process* — `codex exec` (code) and `claude --model haiku -p` (deploy) run as separate CLI subprocesses whose Edit/Write/Bash do NOT pass through THIS session's PreToolUse hooks. Therefore, by construction, ANY in-session Edit/Write (or deploy-loop Bash) during a live ship-feature run IS the whale doing execution it should have delegated — so blocking it in-session is exactly right. The corollary (finding 1): remediation must point ONLY to out-of-process delegation. It must NOT suggest the in-session `Agent`/`Task` sub-agent tool, because that fires the SAME PreToolUse hook and its delegated Bash/writes would be blocked too — a self-contradiction. Decision 4's remediation text and the handler's block message therefore name `codex exec` / `claude --model haiku -p` only.

   **Complete enumeration of legit in-session writes during a live run** (confirming the premise leaves no legitimate case blocked): (a) the spec/plan + design-review sidecar under `docs/plans/**` — ALLOWED by decision 3 (docs/**, *.md); (b) verification screenshots under `docs/verify/**` — ALLOWED; (c) `~/.claude/settings.json` live-wiring — OUTSIDE any worktree, not path-scoped, PASSes; (d) git operations (Stage 9 vendor via `git archive`, commits, push) — these are Bash git, not Edit/Write, and are not deploy-loops, so PASS. That leaves exactly one class the gate blocks: in-session Edit/Write of source code in the run's worktree — which is precisely the whale-doing-Codex's-job case. Genuine one-off exceptions (should be rare) use the `COST_ROUTING_GATE_OFF=1` escape hatch (decision 5). The premise holds.

## Acceptance criteria

- [ ] `rules/cost-routing-gate/handler.ts` PASSes instantly when no fresh (`<30min`) marker exists (zombie markers present must NOT trigger a block) — unit-tested with a dir full of stale markers + zero fresh.
- [ ] During a fresh live run: Edit/Write to a source file inside the run's worktree → BLOCK (exit non-zero, `WHAT:`/`HOW:` → codex exec). Edit/Write to `docs/**` or `*.md` inside the worktree → PASS. Edit/Write outside any live worktree → PASS.
- [ ] Bash deploy/poll-loop signature with cwd inside a fresh run's worktree → BLOCK (→ `claude --model haiku -p`, out-of-process only); same signature with cwd OUTSIDE any live worktree → PASS (no cross-session false positive); ordinary one-shot Bash (incl. a single `railway up` with no poll) → PASS; ambiguous → PASS.
- [ ] Block-message remediation text names ONLY out-of-process delegation (`codex exec`, `claude --model haiku -p`) — never the in-session Agent/Task tool (which fires the same hook).
- [ ] Fresh marker with missing/empty/non-existent `worktree`/`cwd`/`repo` → that marker cannot scope → source write PASSes (unit-tested).
- [ ] `COST_ROUTING_GATE_OFF=1` → PASS; handler crash → PASS (fail-open).
- [ ] `bun test rules/cost-routing-gate/tests.ts` green; `bun rules/cost-routing-gate/AUDIT.ts` PASS.
- [ ] `plugin.json` + `CHANGELOG.md` at 0.11.0; SKILL.md Cost-routing section references the gate as the codified enforcement primitive.
- [ ] Stage 5.8 sandbox-install of 0.11.0 activates clean; live wiring block documented for settings.json.
- [ ] (Gate-A.7 cycle-6 finding 1) Implementation confirms the PreToolUse payload fields it relies on: Edit/Write expose the target file path (reliable — this carries the PRIMARY source-write teeth); Bash exposes `cwd` (best-effort — the deploy-loop block; if `cwd` is absent, PASS/fail-open, documented as an accepted limitation since source-write blocking is the primary leak). A probe test asserts the handler reads the real payload shape the sibling `sdlc-worktree-isolation` Bash gate already uses.
- [ ] (Gate-A.7 cycle-6 finding 2) Completion does not just paste the settings.json wiring — it VERIFIES teeth: with a fresh marker active, a test source-write in the worktree returns BLOCK, and `COST_ROUTING_GATE_OFF=1` returns PASS. Silent-dormant wiring is caught, not assumed.

## Test plan

- [ ] Unit (injectable now/marker-dir/fs like the sibling rules): no-fresh-marker→PASS (incl. all-stale); fresh-run source-write→BLOCK; fresh-run docs/md-write→PASS; out-of-worktree write→PASS; deploy-poll Bash→BLOCK; one-shot Bash→PASS; env-off→PASS; crash→fail-open.
- [ ] AUDIT structural checks (fail-open present, WHAT/HOW in block message, JSONL logging, no-shell-in-rules-tree).
- [ ] Stage 5.8: sandbox-install 0.11.0, confirm the rule handler runs and the skill still activates.

## Rollback

Remove the settings.json hook block (machine-local) → gate goes dormant instantly. Revert the commit to drop the rule. Gate is fail-open, so even a broken handler cannot wedge a session.

## Change manifest

```
+ added     rules/cost-routing-gate/handler.ts    — PreToolUse Edit/Write/Bash cost-routing gate
+ added     rules/cost-routing-gate/manifest.json
+ added     rules/cost-routing-gate/tests.ts
+ added     rules/cost-routing-gate/AUDIT.ts
+ added     rules/cost-routing-gate/WATCH.ts
+ added     rules/cost-routing-gate/README.md     — incl. settings.json live-wiring block
~ modified  skills/ship-feature/SKILL.md          — Cost-routing section → reference the codified gate
~ modified  .claude-plugin/plugin.json            — 0.10.0 → 0.11.0
~ modified  CHANGELOG.md                          — 0.11.0 entry
− removed   (none)
⚙ migrated  (none — new enforcement primitive; prose instructions stay as human-readable intent)
```


## Design-review verdict (Gate-A.7)

- verdict: UNREACHABLE
- cycle: 1
- reviewer: anthropic/claude-fable-5
- cross_family: not_required
- manifest_sha256: 03f9337dce36d6db661ea54f982a2a4fa6b47b47814cfc3315ce55b06a02030b
- timestamp: 2026-07-04T10:53:47.349Z
- findings: none


## Design-review verdict (Gate-A.7)

- verdict: UNREACHABLE
- cycle: 2
- reviewer: anthropic/claude-fable-5
- cross_family: not_required
- manifest_sha256: 03f9337dce36d6db661ea54f982a2a4fa6b47b47814cfc3315ce55b06a02030b
- timestamp: 2026-07-04T10:57:25.566Z
- findings: none


## Design-review verdict (Gate-A.7)

- verdict: YELLOW
- cycle: 3
- reviewer: anthropic/opus
- cross_family: not_required
- manifest_sha256: 03f9337dce36d6db661ea54f982a2a4fa6b47b47814cfc3315ce55b06a02030b
- timestamp: 2026-07-04T17:17:38.257Z
- findings:
  - [medium] forward-failure: Design decision #4 offers `Agent model: haiku` as a valid Bash remediation, but an in-session sub-agent dispatched via the Agent tool fires the SAME PreToolUse hook — so the delegated Haiku sub-agent's deploy/poll Bash would itself be BLOCKED, contradicting the recommended fix. Restrict the remediation text to out-of-process delegation only (`claude --model haiku -p`, `codex exec`), OR have the handler detect sub-agent/child-process origin and exempt it. State the chosen mechanism in the spec and add an AC covering it.
  - [medium] missing-requirements: The gate BLOCKs all source writes inside a live worktree regardless of which model/agent issued the tool call, but the spec never states how it distinguishes the whale's own tool calls from legitimately-delegated in-session sub-agent tool calls (the same settings.json hook fires for both). Add an explicit statement of the origin-detection assumption (e.g. 'delegation is always to separate OS processes, which bypass the hook') and an AC/test asserting a sub-agent path is handled as intended.
  - [low] missing-requirements: The Bash deploy/poll-loop signature is described by example (`until/while … sleep …`, `gh pr checks --watch`) but the exact match rule is unspecified, creating false-positive risk (a benign test or script using `while … sleep` that is not a deploy poll would be blocked). Enumerate the precise signature patterns in the spec and add a test case for a benign `while/sleep` command that must PASS, alongside the existing one-shot-Bash→PASS case.
- adjustments:
  - Class B; applied=false: Design decision #4 offers `Agent model: haiku` as a valid Bash remediation, but an in-session sub-agent dispatched via the Agent tool fires the SAME PreToolUse hook — so the delegated Haiku sub-agent's deploy/poll Bash would itself be BLOCKED, contradicting the recommended fix. Restrict the remediation text to out-of-process delegation only (`claude --model haiku -p`, `codex exec`), OR have the handler detect sub-agent/child-process origin and exempt it. State the chosen mechanism in the spec and add an AC covering it.
  - Class B; applied=false: The gate BLOCKs all source writes inside a live worktree regardless of which model/agent issued the tool call, but the spec never states how it distinguishes the whale's own tool calls from legitimately-delegated in-session sub-agent tool calls (the same settings.json hook fires for both). Add an explicit statement of the origin-detection assumption (e.g. 'delegation is always to separate OS processes, which bypass the hook') and an AC/test asserting a sub-agent path is handled as intended.
  - Class B; applied=false: The Bash deploy/poll-loop signature is described by example (`until/while … sleep …`, `gh pr checks --watch`) but the exact match rule is unspecified, creating false-positive risk (a benign test or script using `while … sleep` that is not a deploy poll would be blocked). Enumerate the precise signature patterns in the spec and add a test case for a benign `while/sleep` command that must PASS, alongside the existing one-shot-Bash→PASS case.


## Design-review verdict (Gate-A.7)

- verdict: YELLOW
- cycle: 4
- reviewer: anthropic/opus
- cross_family: not_required
- manifest_sha256: 03f9337dce36d6db661ea54f982a2a4fa6b47b47814cfc3315ce55b06a02030b
- timestamp: 2026-07-04T17:20:24.226Z
- findings:
  - [medium] forward-failure: Decision 8's premise — 'ANY in-session Edit/Write during a live ship-feature run IS the whale doing execution it should have delegated' — assumes 100% of source writes during a run are out-of-process. Before Stage 4, enumerate every point where the ship-feature pipeline itself (or the whale legitimately) writes a non-docs/non-.md source file in-session during a live run: e.g. the plugin.json version bump (.json → BLOCKED per decision 3), merge-conflict resolution in a source file at Gate B, or applying a one-line reviewer fix. Confirm each such point is either routed out-of-process (codex exec), targets docs/**|*.md, or is explicitly expected to rely on COST_ROUTING_GATE_OFF/bypass. Document the enumeration so the gate cannot silently block its own pipeline. (Fail-open + bypass env bound the blast radius, so this is YELLOW not RED.)
  - [low] missing-requirements: Add an explicit acceptance criterion/test for a FRESH marker whose JSON is missing or has malformed worktree/cwd/repo fields (decision 2 assumes 'marker JSON carries these'). Specify the intended behavior — a fresh marker with no resolvable worktree should PASS (cannot path-scope), not crash or over-block — and cover it in the unit suite alongside the all-stale-markers case.
- adjustments:
  - Class A; applied=false: Decision 8's premise — 'ANY in-session Edit/Write during a live ship-feature run IS the whale doing execution it should have delegated' — assumes 100% of source writes during a run are out-of-process. Before Stage 4, enumerate every point where the ship-feature pipeline itself (or the whale legitimately) writes a non-docs/non-.md source file in-session during a live run: e.g. the plugin.json version bump (.json → BLOCKED per decision 3), merge-conflict resolution in a source file at Gate B, or applying a one-line reviewer fix. Confirm each such point is either routed out-of-process (codex exec), targets docs/**|*.md, or is explicitly expected to rely on COST_ROUTING_GATE_OFF/bypass. Document the enumeration so the gate cannot silently block its own pipeline. (Fail-open + bypass env bound the blast radius, so this is YELLOW not RED.)
  - Class B; applied=false: Add an explicit acceptance criterion/test for a FRESH marker whose JSON is missing or has malformed worktree/cwd/repo fields (decision 2 assumes 'marker JSON carries these'). Specify the intended behavior — a fresh marker with no resolvable worktree should PASS (cannot path-scope), not crash or over-block — and cover it in the unit suite alongside the all-stale-markers case.


## Design-review verdict (Gate-A.7)

- verdict: YELLOW
- cycle: 5
- reviewer: anthropic/opus
- cross_family: not_required
- manifest_sha256: 03f9337dce36d6db661ea54f982a2a4fa6b47b47814cfc3315ce55b06a02030b
- timestamp: 2026-07-04T17:23:02.184Z
- findings:
  - [YELLOW] missing-requirements: Decision 4 / the Bash acceptance criterion block deploy/poll-loop Bash whenever ANY fresh marker exists ('during a live run') but — unlike Edit/Write (decision 2) — never path-scope the Bash command to the live run's worktree/cwd. A deploy-poll loop in an unrelated session/repo will be blocked whenever a fresh ship-feature marker exists elsewhere (cross-session false positive). Add a criterion: only block deploy/poll Bash when the invoking process cwd resolves inside a fresh marker's valid worktree/cwd/repo (reuse the same path-scoping + can't-determine→PASS logic as decision 2), and unit-test the out-of-worktree Bash→PASS case.
- adjustments:
  - Class B; applied=false: Decision 4 / the Bash acceptance criterion block deploy/poll-loop Bash whenever ANY fresh marker exists ('during a live run') but — unlike Edit/Write (decision 2) — never path-scope the Bash command to the live run's worktree/cwd. A deploy-poll loop in an unrelated session/repo will be blocked whenever a fresh ship-feature marker exists elsewhere (cross-session false positive). Add a criterion: only block deploy/poll Bash when the invoking process cwd resolves inside a fresh marker's valid worktree/cwd/repo (reuse the same path-scoping + can't-determine→PASS logic as decision 2), and unit-test the out-of-worktree Bash→PASS case.


## Design-review verdict (Gate-A.7)

- verdict: YELLOW
- cycle: 6
- reviewer: anthropic/opus
- cross_family: not_required
- manifest_sha256: 03f9337dce36d6db661ea54f982a2a4fa6b47b47814cfc3315ce55b06a02030b
- timestamp: 2026-07-04T17:24:56.580Z
- findings:
  - [YELLOW] missing-requirements: The Bash path-scoping (decision 4 / AC-3) depends on the PreToolUse hook payload actually providing the Bash invocation `cwd`. This is asserted but not verified. If Claude Code's PreToolUse payload omits cwd for Bash (or the command `cd`s into the worktree after launch), Bash deploy/poll detection silently fails-open and the Stage-8 deploy-loop leak — a primary motivating case — is never caught. Add an AC/pre-implementation check that confirms the hook payload exposes cwd for Bash; if it does not, document the reduced coverage and the chosen fallback.
  - [YELLOW] forward-failure: Activation is machine-local: the settings.json hook block is applied manually in Stage 9/completion and never committed. If wiring is skipped or mis-pasted the gate is a silent no-op (theater-in-practice) with no signal. Add a Stage 9/5.8 verification step + AC that asserts the hook is actually registered and firing after wiring (e.g., print current settings.json PreToolUse block and run one confirming BLOCK/PASS probe), not merely that the wiring block is documented.
- adjustments:
  - Class A; applied=false: The Bash path-scoping (decision 4 / AC-3) depends on the PreToolUse hook payload actually providing the Bash invocation `cwd`. This is asserted but not verified. If Claude Code's PreToolUse payload omits cwd for Bash (or the command `cd`s into the worktree after launch), Bash deploy/poll detection silently fails-open and the Stage-8 deploy-loop leak — a primary motivating case — is never caught. Add an AC/pre-implementation check that confirms the hook payload exposes cwd for Bash; if it does not, document the reduced coverage and the chosen fallback.
  - Class B; applied=false: Activation is machine-local: the settings.json hook block is applied manually in Stage 9/completion and never committed. If wiring is skipped or mis-pasted the gate is a silent no-op (theater-in-practice) with no signal. Add a Stage 9/5.8 verification step + AC that asserts the hook is actually registered and firing after wiring (e.g., print current settings.json PreToolUse block and run one confirming BLOCK/PASS probe), not merely that the wiring block is documented.
