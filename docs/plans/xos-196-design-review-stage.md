# /ship-feature Stage 5.9 — Design-Reasoning Review (Fable persona-jury) — REV 2 (post-Fable RED)

## Problem (why this stage exists)
`/ship-feature` reviews CODE after Codex builds (Stage 6 cross-family judge). Nothing
reviews the DESIGN + REQUIREMENTS reasoning before the build — where ~80% of defects are
born and where fixes cost ~10x. Live proof (twice this session): a Fable design lens caught
fatal theater flaws a cross-family CODE judge structurally could not — first in the codi
local-test nudge, then in THIS stage's own REV-1 spec. This stage is the design-time twin
of the build-time code judge.

## Placement — Gate-A.7 (VERIFIED against the real SKILL.md 0.9.0)
The pipeline ALREADY has **Gate-A.5 — Change-Manifest gate** (SKILL.md line ~213): runs
after Gate A (spec approved) + Stage 3.5, BEFORE Stage 4 (Codex build), FAIL-HARD, uses the
Stage-6 judge-panel harness run early. This new stage is **Gate-A.7 — Design-Reasoning
Review**, immediately AFTER Gate-A.5 (so the Change Manifest / blast-radius is an input to
the simplicity + forward-failure lenses) and BEFORE Stage 4:

  Gate A spec → Stage 3.5 (cond) → **Gate-A.5 Change-Manifest** → **Gate-A.7 DESIGN-REVIEW
  (this)** → Stage 4 Implement → Stage 5 tests → Stage 6 CODE judge → Stage 7 PR → Stage 8 merge

Gate-A.7 is the DESIGN-reasoning twin of Gate-A.5 (manifest removal-accounting) and Stage 6
(cross-family CODE judge): A.5 checks the manifest accounts for removals; A.7 checks the
design/requirements REASONING is sound; Stage 6 checks the built CODE. Mirror the existing
rules/<slug>/ gate pattern (handler.ts + AUDIT.ts + WATCH.ts + manifest.json + tests.ts;
bun; PreToolUse input shape; exit 0 PASS / 1 BLOCK; FAIL-HARD with remediation message).

## THE ENFORCEMENT SPINE (Fable findings 1+2 — the two FATALs; the whole point)
A verdict with no teeth is the theater this stage exists to kill. So the verdict is a
MACHINE-CHECKED ARTIFACT, not prose an orchestrator can reinterpret.

**Three-layer (P4):**
- **Semantic (SKILL.md):** documents the stage, the lenses, what the verdicts mean.
- **Invariant (TS+Bun handler + gate — this is where the teeth live):**
  1. `design-review/run.ts` — spawns a FRESH reviewer (spec + manifest only, NEVER the
     parent conversation — finding 5) and captures a STRUCTURED verdict:
     `{verdict: GREEN|YELLOW|RED, findings:[{severity,lens,fix}], spec_sha256,
       manifest_sha256, reviewer_model, reviewer_family, timestamp, cycle}`.
     Writes it into the change-manifest. Parsed deterministically — the interested
     orchestrator NEVER re-summarizes it (finding 1).
  2. `design-review-gate` (build-spawn gate, FAIL-HARD): build refuses to start unless a
     verdict record exists AND `verdict.spec_sha256 == sha256(current spec)` AND verdict
     ∈ {GREEN, YELLOW-with-only-classA-applied}. Missing verdict → BLOCK. Hash mismatch →
     BLOCK ("spec edited after review — re-review"). This single hash-match ALSO kills the
     "GREEN, then quietly edit the spec, then build" bypass (finding 1).
  3. Gate B re-verify: PR body must carry the verdict block; gate re-checks the hash.
- **Execution:** the Agent-tool call to Fable / cross-family reviewer (replaceable atom).

## Verdict semantics + boundaries (finding 8 — remove model-variance from control flow)
- **RED** = a lens-1/3/7 failure: wrong problem · theater-class (won't change behavior) ·
  unverifiable DoD. These are fatal-by-definition.
- **YELLOW** = bounded lens-2/4/5/6 findings (missing edge case, over/under-engineered,
  reinvention, forward-failure) that don't hit the RED bar.
- **GREEN** = none of the above.
- **Rubber-stamp guard:** a reviewer that NEVER returns RED is a stamp with edit privileges.
  The audit (metric section) tracks RED-rate ≈ 0 on non-trivial specs as a RED FLAG.

## Control flow
- **GREEN** → build.
- **YELLOW** → adjustments are CLASSIFIED (finding 2 — no silent requirements rewrite):
  - **Class A** (additive/clarifying: narrows ambiguity, NO scope/behavior/DoD change) →
    auto-apply, re-hash the spec, record the delta in the manifest. ONE pass, no re-review
    of the reviewer's own edits.
  - **Class B** (changes scope · removes/alters a requirement · changes user-visible
    behavior or DoD) → NEVER auto-applied. Build proceeds on the ORIGINAL Gate-A spec;
    the finding is attached to the PR body as a MANDATORY spec-delta diff for human review
    at Gate B. If a Class-B finding makes the original unbuildable → HOLD (park, below).
    (Honors HUMAN-JUDGMENT-PRIMACY: the reviewer has zero authority to co-author requirements.)
- **RED** → STOP. Max **2 RED cycles** (finding 3). Re-review is SCOPED: the reviewer gets
  its own prior findings and judges only "were these addressed?"; a NEW finding triggers a
  second RED only at severity ≥ the RED bar. **RED is NEVER auto-downgraded to YELLOW.**
  Autonomous 2nd RED → PARK: release/mark the Stage-0 claim blocked, write an escalation
  artifact, stop. (Not retry-forever; not proceed.)

## Skip tier (finding 4 — objective, not orchestrator self-declared)
Skip Stage 5.9 for T0–T1 mechanical changes, gated by OBJECTIVE manifest properties ONLY:
file-count ≤ threshold AND all paths in a mechanical allowlist (docs, version files, config)
AND no new public surface AND no behavior flag. NEVER by the orchestrator's self-declared
tier (it's incentivized to lowball). Every skip records `design_review: skipped(rule=X)` in
the manifest — a silent skip is indistinguishable from theater.
- **T2** = Fable-alone (lens diversity).
- **T3+** = cross-family design jury (Fable + Gemini/GPT product-architect lens — family
  diversity where stakes justify).
- **Cheap cross-family spot-check** (finding 5): whenever a same-family review returns
  first-pass GREEN with ZERO findings on a NON-trivial spec, fire one Gemini-Flash
  (fish-swarm, ~free) cross-check — a zero-finding same-family GREEN is the least trustworthy
  verdict in the system (COMPLEMENTARY-COMPOSITION invariant).

## The bus — where design lessons compound (finding 7; product-vs-solution safe)
- **Run-scoped** findings → change-manifest + PR body.
- **Recurring** design-defect class (caught ≥2 runs) → a PR that adds a new named LENS to
  the reviewer's VERSIONED rubric file IN THE PLUGIN REPO (`design-review/lenses.md` or
  `.json`). CI'd, shipped to every user of the product, auto-loaded exactly when it fires
  (P19 — lesson at the lowest layer where all consumers benefit). This is the compounding
  channel: each caught pattern makes the next instance cheaper.
- NEVER hardcode a workspace file (AGENT_STATUS.yaml / a personal constitution). Workspace
  busses are reached ONLY via the existing emit-event/workspace-adapter seam — the stage is
  a shipped PRODUCT (no `.env.local`, no "EIR", no AI-Fund rules, no personal handles).

## Success metric + kill criterion (finding 6 — a gate you can't measure = latency)
The structured verdict records ARE the instrument. Metric: of design-class defects caught at
Stage 6 + post-merge (fix-commits/reverts within N days), the fraction caught BEFORE vs AFTER
5.9 ships. WATCH-style audit every ~20 runs (keep/kill/modify). **Kill rule:** if 5.9's GREEN
runs leak design-class defects downstream at the pre-5.9 baseline rate after N runs → the
stage is theater → kill or redesign. Secondary signals: RED verdicts later human-validated vs
overridden; Class-A adjustment adoption; RED-rate (≈0 = rubber-stamp alarm).

## Builder notes from Fable's GREEN re-review (implement these)
1. Gate condition precision: implement the build-spawn block as "no Class-B adjustment was
   applied to the reviewed spec" (a Class-B YELLOW is BUILDABLE on the ORIGINAL spec hash —
   the reviewed spec is unchanged). Match the DoD seam test's semantics.
2. Classifier conservative-fail: DEFAULT ambiguous adjustments to Class B (toward human
   review). Add a classifier test case for an ambiguous adjustment → Class B.

## DoD (now ships enforcement primitives, not prose)
- Gate-A.7 documented in super-developer SKILL.md (semantic layer), placed after Gate-A.5
  Change-Manifest, before Stage 4 Implement.
- `design-review/run.ts` (spawn fresh reviewer, capture structured verdict → manifest).
- `design-review-gate` build-spawn gate: FAIL-HARD on missing-verdict / spec-hash-mismatch /
  RED (with remediation message per FAIL-HARD invariant).
- Adjustment classifier (Class A vs B) + max-2-RED-cycle bound + park-on-2nd-RED.
- Objective skip-tier check + recorded skip reason.
- Versioned rubric file (`design-review/lenses.*`) seeded with the 7 lenses.
- Tests (P22 — test the SEAMS, not just happy verdicts): missing-verdict BLOCK ·
  spec-hash-tamper BLOCK · RED BLOCK · YELLOW-Class-B NOT auto-applied · skip-rule fires on
  mechanical / does NOT fire on feature · 2nd-RED parks.
- Version-consistency bump across super-developer's version sources; CI green.
- Merge gate: super-developer is existential + this adds enforcement primitives → T3+ →
  PR stops at human-merge with the judge receipt.
