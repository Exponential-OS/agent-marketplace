<!-- product-vs-solution: generic. Worked examples use a synthetic candidate.
     No real person, employer, compensation figure or private message appears in
     this file — it ships to customers. See XOS-359. -->

# Biographical Claim Pre-Check

**Status:** ground-zero-invariant · v1.1.0 · 2026-04-26 (genericized 2026-10-29)
**Slug:** `biographical-claim-precheck`
**Documentation only.** The handler is the rule.

## Why

Two T4 hallucination near-misses in one day, both shipped past prose-only
verification guidance:

1. **An outreach email to a warm contact** was drafted with a tenure figure, a
   direct-report count, a compensation floor and a reliability statistic that
   none of the candidate's canonical records supported. Every number was
   plausible. Every number was wrong. Caught by the candidate seconds before
   send.

2. **A referral forwarding packet** was drafted attributing the candidate to a
   product area they never worked in, and a job title they never held, at a real
   employer. Caught pre-send.

Both drafts carried roughly sixteen biographical claims; three to four in each
were unanchored to any canonical source. Prose guidance to "verify before
shipping" already existed and was ignored under attention load. The fix is not
another principle — it is a pre-write check in code that fires BEFORE the agent
presents the draft to a human.

**The generalizable failure:** an LLM drafting outreach will generate specific,
confident numbers to fill a persuasive slot. Specificity reads as authority, so
these claims survive self-review. They are only caught by mechanical comparison
against a canonical record.

## What

When any T4 outreach draft is about to land in front of a real human, run:

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/rules/biographical-claim-precheck/handler.ts" "$(jq -nc \
  --arg draft "/path/to/draft.md" \
  --arg canonical "$CAREER_HOME/brain/identity/experience-history.md" \
  '{draft_path:$draft, canonical_sources:[$canonical], stakes:"T4"}')"
```

The handler greps the draft for five claim-pattern classes:

| Pattern | Example | Why it's a failure surface |
|---|---|---|
| `tenure` | `"5 yr 7 mo"`, `"3 years at <Employer>"` | Tenure miscounts |
| `report_count` | `"9 engineers"`, `"40+ reports"` | Headcount inflation |
| `scale` | `"$10M budget"`, `"$150K floor"` | Figure misattribution across employers |
| `date_range` | `"Apr 2014 - Oct 2019"` | Date-arithmetic errors |
| `role_title` | `"Staff Engineer at <Employer>"` | Title fabrication |

For each match the handler extracts the distinctive **numeric token** plus the
**capitalized word token** and checks whether they CO-OCCUR in any canonical
source. Anchor found → claim verified. Anchor missing → BLOCK.

Heuristic, not perfect. Tuned for high recall (catch real hallucinations) with
intentional false positives (the agent confirms before send). Cost of a false
positive is a 30 second re-read; cost of a false negative is a credibility hit
that cannot be withdrawn.

## What-not

- ❌ NOT a vision check (use `co-dialectic:judge-panel` with the `visual-asset-review` rubric).
- ❌ NOT a rubric-based evaluation (use `co-dialectic:judge-panel` with the `hallucination` rubric).
- ❌ NOT a substitute for human review of T3+ artifacts — it is a pre-flight, not a ship gate.
- ❌ NOT a recipe for non-biographical claims. Pricing, benchmarks and prior-art claims have their own rules.

## Worked examples

Both examples use a synthetic candidate whose canonical record reads:
*Senior Engineering Manager at Northwind, April 2014 to October 2019 (5 years
7 months), managed up to 9 engineers and contractors.* These figures are
invented; they intentionally match no real record.

### Example 1 — draft that BLOCKs

Draft excerpt: `"recently exited a Northwind Senior Engineering Manager role
(last 3 yrs, 40+ reports, multi-cloud platform leadership)"`

- tenure pattern: `"3 yrs"` paired with `"Northwind"`. Canonical search finds no
  co-occurrence — the record says 5 years 7 months. **Unanchored.**
- report_count pattern: `"40 reports"`. Canonical says up to 9. **Unanchored.**

Verdict: `BLOCK`, `next_action: abort-and-recheck-canonical`.

### Example 2 — corrected draft that PASSes

Draft excerpt: `"Last role: Northwind Senior Engineering Manager, Apr 2014 -
Oct 2019 (5 yrs 7 mo). Managed up to 9 engineers and contractors."`

- tenure: `"5 yrs"` with `"Northwind"` co-occurs in canonical. **Anchored.**
- report_count: `"9 engineers"` co-occurs in canonical. **Anchored.**

Verdict: `PASS` on the substantive claims. A draft file that also contains a
before/after comparison table will raise expected false positives on the "before"
rows — those describe the rejected draft, not the outgoing message.

## How to verify

**Activation check**, from a fresh shell:

```bash
bun run "${CLAUDE_PLUGIN_ROOT}/rules/biographical-claim-precheck/handler.ts" \
  "$(jq -nc --arg draft "$CAREER_HOME/INPUT/outreach-draft.md" \
     '{draft_path:$draft, stakes:"T4"}')" | jq .
```

Expected: JSON carrying `verdict`, `claims_total`, `claims_anchored`,
`claims_unanchored[]`. Canonical defaults to
`$CAREER_HOME/brain/identity/experience-history.md` when the caller omits
`canonical_sources`.

**Audit check:**

```bash
bash "${CLAUDE_PLUGIN_ROOT}/rules/biographical-claim-precheck/AUDIT.sh" '{"window_hours":168,"min_tier":"T4"}' | jq .
```

Expected: `verdict`, `score`, `shipped`, `blocked`, `bypassed`. A `bypassed`
count above zero means a T4 draft reached `INPUT/` without the rule firing —
an immunity-cycle gap.

**Watch check:**

```bash
bash "${CLAUDE_PLUGIN_ROOT}/rules/biographical-claim-precheck/WATCH.sh" '{}' | jq .
```

Expected: cadence delta (default `keep`) and three experiment outcomes
(false-positive sampling, pattern coverage tally, pattern effectiveness).

## Anti-patterns

- ❌ Drafting outreach and presenting it to the user without running the handler first. Pre-empting that correction round-trip is the entire point.
- ❌ Treating a BLOCK as a false alarm and sending anyway. False positives cost 30 seconds; false negatives cost a relationship.
- ❌ Hard-coding a different canonical source per message — pass `canonical_sources` instead.
- ❌ Adding claim patterns inline rather than through the pattern-coverage experiment in `WATCH.sh`.
- ❌ Skipping the rule for "small" sends. One of the two originating incidents was a casual peer-to-peer DM.

## Related

- **EMERGENT SYSTEM IMMUNITY** — this rule is the pre-write leg of the T4 immunity cascade.
- **Independent verification** — a POST-write cross-family judge panel (see the
  `judge-panel` skill in co-dialectic) is the complement to this rule, which is
  the PRE-write check. That gate lives outside this plugin.
- **CONSTITUTION-AS-LIVING-CODE** — every rule ships as a directory with handler + AUDIT + WATCH.
- **OBJECTIVE-CODIFICATION** — prose "verify before ship" was ignored under load; the handler makes verification mechanical.
- **SIGNAL AMPLIFICATION** — a canonical-source anchor is signal; agent recall is noise.
