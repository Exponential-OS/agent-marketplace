<!-- product-vs-solution: example — file's purpose intrinsically references Anand as the user/subject (worked example); generic equivalent infeasible without renaming. -->

# Biographical Claim Pre-Check

**Status:** ground-zero-invariant · v1.0.0 · 2026-04-26
**Slug:** `biographical-claim-precheck`
**Documentation only.** The scripts are the rule.

## Why

Two T4 hallucination near-misses on 2026-04-26 — both shipped past the EMERGENT SYSTEM IMMUNITY invariant prose:

1. **Matt Kleinman email** drafted with `"4 yr Google"` / `"50+ reports"` / `"$200K floor"` / `"99.99% uptime Google"`. Canonical (`brain/identity/experience-history.md` §4.3) says **6 yr 5 mo**, **5–16 reports**, **$250K floor (Schwab)**, **99.99% Schwab not Google**. User caught pre-send: *"how can you make a silly mistake like 4 yr google experience when I have 6yrs. can i even trust you."*

2. **Amanesh Goyal Roblox Safety AI fwd-packet** drafted with `"ML serving platform on Speech / Search"` / `"Director / Head of Trust Platform at Schwab"` / `"consumer-scale ML serving + safety/trust adjacency"`. Canonical: Google L6 was **construction platform** (GDC + REWS, $40B capital portfolio, NOT Speech/Search ML); Schwab title was **Technical Director** leading **Pivotal Cloud Foundry** (NOT "Trust Platform"). User caught pre-send: *"the whole message is a hallucination, google - ml of search, schwab trust platfrom???? are you kidding me?"*

Both drafts contained ~16 biographical claims; ~3-4 each were unanchored. The EMERGENT SYSTEM IMMUNITY invariant prose existed and was ignored under attention load. The fix isn't another principle — it's the pre-write hook in code that fires BEFORE the agent presents the draft to the user.

## What

When any T4 outreach draft is about to land in front of a real human, run:

```bash
bash ~/cyborg/rules/biographical-claim-precheck/HOW.sh '{
  "draft_path": "/path/to/draft.md",
  "canonical_sources": ["~/anand-career-os/brain/identity/experience-history.md"],
  "stakes": "T4"
}'
```

HOW.sh greps the draft for five claim-pattern classes:

| Pattern | Example | Why it's a failure surface |
|---|---|---|
| `tenure` | `"6 yr 5 mo"`, `"4 years at Google"` | Tenure miscounts (Matt incident) |
| `report_count` | `"16 engineers"`, `"50+ reports"` | Headcount inflation (Matt incident) |
| `scale` | `"$40B portfolio"`, `"$250K floor"` | $-figure misattribution (Matt incident) |
| `date_range` | `"Jan 2019 – May 2025"` | Date-arithmetic errors |
| `role_title` | `"L6 SEM at Google"`, `"Director at Schwab"` | Title fabrication (Amanesh incident) |

For each match, the script extracts the distinctive **numeric token** + **capitalized word token** and checks whether they CO-OCCUR in any canonical source. Anchor found → claim verified. Anchor missing → BLOCK.

Heuristic, not perfect. Designed for high recall (catch real hallucinations) with intentional false-positives (agent confirms before send). Cost of a false positive = 30 sec re-read; cost of a false negative = career-credibility hit.

## What-not

- ❌ NOT a vision check (use `co-dialectic:judge-panel` with `visual-asset-review` rubric).
- ❌ NOT a rubric-based ML evaluation (use `co-dialectic:judge-panel` with `hallucination` rubric).
- ❌ NOT a substitute for human review of T3+ artifacts (it's a pre-flight, not a ship gate).
- ❌ NOT a recipe for non-biographical claims (other claim classes — pricing, benchmarks, prior-art — have their own rules in the Phase 6 backlog).

## Worked examples

### Example 1 — Matt v1 draft (would have BLOCKed)

Input draft excerpt: `"recently exited from a Google L6 Senior Engineering Manager role (last 4 yrs as L6, 50+ reports, multi-cloud platform leadership)"`.

HOW.sh greps:
- tenure pattern: `"4 yrs"` paired with capitalized word `"Google"`. Canonical search: `grep "Google.*4\b"` → no anchor (canonical says 6 yr 5 mo). **Unanchored.**
- report_count pattern: `"50 reports"`. Canonical search: `grep "50.*report"` → no anchor (canonical says 5–16). **Unanchored.**

Verdict: BLOCK. `next_action: abort-and-recheck-canonical`.

### Example 2 — Matt v2 draft (PASSes the substantive claims)

After canonical-trace correction: `"Last role: Google L6 Senior Engineering Manager, Jan 2019 – May 2025 (6 yrs 5 mo). Managed up to 16 engineers and contractors..."`.

HOW.sh greps:
- tenure: `"6 yrs"` paired with `"Google"`. Canonical: `Period: January 2019 -- May 2025 (6 years 5 months)` line 174. **Anchored.**
- report_count: `"16 engineers"`. Canonical: `Managed up to 16 engineers and contractors` line 190. **Anchored.**

Verdict: PASS for the substantive content (false positives on the v1→v2 comparison table at the bottom of the file are expected — those describe the OLD draft, not the outgoing email).

## How to verify

**Activation check:** From a fresh shell:

```bash
bash ~/cyborg/rules/biographical-claim-precheck/HOW.sh '{
  "draft_path": "~/anand-career-os/INPUT/matt-kleinman-email-2026-04-26.md",
  "stakes": "T4"
}' | jq .
```

Expected: JSON output with `verdict`, `claims_total`, `claims_anchored`, `claims_unanchored[]`. Default canonical = `~/anand-career-os/brain/identity/experience-history.md` (defaulted when caller omits `canonical_sources`).

**Audit check:**

```bash
bash ~/cyborg/rules/biographical-claim-precheck/AUDIT.sh '{"window_hours":168,"min_tier":"T4"}' | jq .
```

Expected: `verdict`, `score`, `shipped`, `blocked`, `bypassed`. `bypassed` > 0 means a T4 draft landed in `INPUT/` since the rule last fired — that's an immunity-cycle gap.

**Watch check:**

```bash
bash ~/cyborg/rules/biographical-claim-precheck/WATCH.sh '{}' | jq .
```

Expected: cadence delta (default `keep`), three experiment outcomes (false-positive sampling, pattern coverage tally, pattern effectiveness re v1.0 origin incidents).

## Anti-patterns

- ❌ Drafting outreach + presenting to user without running HOW.sh first — the entire point of this rule is to pre-empt the user-correction round-trip.
- ❌ Treating a BLOCK as a false alarm and shipping anyway — false positives are 30 sec; false negatives end careers.
- ❌ Hard-coding a different canonical source per outreach — use `canonical_sources` in context; default routes to `experience-history.md`.
- ❌ Adding new claim patterns inline instead of via the pattern-extension review (which lives in WATCH.sh experiment 2: pattern coverage).
- ❌ Bypassing the rule for "small" T4 sends (DMs, casual emails) — Amanesh DM was casual peer-to-peer and still produced a credibility-killing hallucination.

## Related

- **EMERGENT SYSTEM IMMUNITY** (Ground Zero meta-invariant) — this rule is the pre-write leg of the T4 immunity cascade.
- **Independent Verification Gate** (`rules/independent-verification-gate/`) — IVG is the POST-write check (cross-family judge panel); this rule is the PRE-write check.
- **CONSTITUTION-AS-LIVING-CODE** — every rule lives as a directory with HOW + AUDIT + WATCH; this rule is the second exemplar.
- **OBJECTIVE-CODIFICATION (CODE OVER RULE)** — prose "verify before ship" was ignored under attention load; this script makes the verification mechanical.
- **SIGNAL AMPLIFICATION** — canonical-source anchor = signal; agent recall = noise.
