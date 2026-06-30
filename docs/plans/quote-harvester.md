# Quote Harvester — Auto-harvest quotable insights → running brand-quotes deck

status: design
slug: quote-harvester
ticket: XOS-140
repo: ~/aiprojects/agent-marketplace

## What

A coordination-engine Stop hook that scans the session transcript at session end,
extracts quotable aphorisms (universal wisdom, architecture-revealing, borrowed),
routes each to the correct safety-gated section of the running deck
(`~/anand-career-os/WIP/branding-product/cyborg-quotes.md`), and appends
date + provenance. Idempotent (no duplicate lines). Fail-safe (never blocks
session end).

## Why

Every dialectic session produces quotable insights that feed the content-flywheel
(P16). Today a human has to ask for them to be collected. A Stop hook makes
harvesting automatic for all agents — Claude, Gemini, Codex — without relying on
memory or prose that a cold-start agent won't load.

## Scope

In:
- coordination-engine Stop hook (`hooks/quote-harvester.ts`)
- Updated `hooks/hooks.json` to wire the Stop event
- LLM-based quote extraction + safety routing (§1 universal / §2 architecture-HOLD / §3 borrowed)
- Idempotency via hash-based deduplication against existing deck content
- Fail-safe: any failure exits 0, never blocks session end
- Updated coordination engine CHANGELOG (0.5.0)

Out:
- Modifications to co-dialectic plugin (collision risk with XOS-148/149/150)
- Constitution stub (tracked in ticket description — deferred; the hook is
  the structural codification; the Constitution stub is documentation that
  syncs separately via sync.sh)
- Cross-family agent install into Gemini/Codex configs (that is the sync.sh
  job; out of scope for this PR)

## Acceptance criteria

- [ ] Stop hook fires at session end, reads transcript via `transcript_path`
      from the payload (same mechanism as career-os capture-response.sh and
      codi peer-parity-nudge.ts — confirmed in Stage 1)
- [ ] Extracts quotable lines using LLM judge (agy/claude-haiku)
- [ ] Routes each quote: universal wisdom → §1, architecture/xOS-revealing → §2
      (HOLD), borrowed/attributed → §3; default-to-§2 when uncertain
- [ ] Plain-text paste-safe output (no markdown inside quotes)
- [ ] Date + provenance tag on each new entry
- [ ] Idempotent: lines already in the deck are not re-added
- [ ] Fail-safe: any exception → exits 0, session end never blocked
- [ ] Test suite: mock transcript with mixed quote types → verify correct
      section routing esp. architecture → §2 HOLD, idempotency, fail-safe

## Test plan

- [ ] Unit test: `runQuoteHarvester(mockTranscript, mockDeckContent)` with:
  - Universal wisdom line → appears in §1
  - Architecture-revealing line (mentions "xOS", "cyborg", "the swarm") → §2
  - Borrowed/attributed line → §3
  - Line already in deck → not duplicated
  - Corrupt transcript / no transcript → exits 0 (fail-safe)
- [ ] Integration smoke: run hook against a real small session transcript
      and verify deck append

## Rollback

Delete `hooks/quote-harvester.ts`, revert `hooks/hooks.json` to remove the
Stop entry, revert CHANGELOG. No data loss — the deck file is append-only;
existing lines unaffected.
