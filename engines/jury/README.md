# jury — cross-family cascade-then-jury reviewer (xOS cross primitive)

The free **"jury beats judge"** base: a standalone cross-family reviewer that runs a small-fish cascade (Gemini + GPT) and escalates to a cross-family tiebreaker when the fish disagree. OAuth local CLIs only — **no API keys**.

## Why it lives here

`jury` is a **cross-cutting xOS primitive** (`plugins/cross/jury`, alongside `exponential-developer` and `xos`). It is the single source of truth for cross-family verification. `co-dialectic` (`judge-panel`) and `exponential-developer` (Stage-6 review) are intended consumers — they depend on `jury` optionally for cross-family checks rather than each embedding their own copy.

> Canonical source: `Exponential-OS/xos` monorepo → `plugins/cross/jury`. The `agent-marketplace` `engines/jury` copy is a derived vendored mirror, overwritten on each sync.

## Contents

- `skills/jury/scripts/jury_panel.ts` — the cascade-then-jury harness.
- `skills/jury/SKILL.md` — invocation + rubric contract.

## Follow-on (tracked separately)

`co-dialectic`'s `judge-panel/scripts/judge_panel.ts` is currently a near-duplicate of this harness (they drifted by ~10 lines). Consolidating so `co-dialectic` + `exponential-developer` **import** `jury` instead of embedding a copy (P19 layered-primitives) is a separate refactor.
