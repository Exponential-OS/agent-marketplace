# Intro-Strength Score + Badge in Pipeline-View
status: design
slug: xos-85-intro-strength-badge
ticket: XOS-85
repo: ~/aiprojects/career-intelligence-engine

## What
Per-company intro-strength **score + badge** ("N warm intros · Strong") surfaced in `pipeline-view`, so the most-winnable companies rise to the top of attention without a separate query. Builds on XOS-82 (`warmPathsToCompany`) + XOS-83 (`surface-intros.ts`, both on main).

## Why (NSM)
Directs user attention to highest-probability wins → raises conversion per unit of attention spent on the pipeline. The visible surface of the Warm-Network moat.

## Scope
- **In:**
  - `src/network/surface-intros.ts` — export `scoreIntroStrength(paths: readonly WarmPath[]): { path_count; score; strength_label: StrengthLabel | "cold"; badge: string }`. Weights: very_strong=95, strong=80, moderate=55, weak=25. `score = min(100, topLabelPoints + min(10, (path_count - 1) * 5))`. Label from score: ≥90 "Very Strong", ≥70 "Strong", ≥45 "Moderate", >0 "Weak", 0 "cold"/"Cold". Badge: `"N warm intro(s) · Label"` (singular/plural; "Cold" when 0). Prepend the badge as the first line of `warm_path_display`.
  - `scripts/pipeline-view.py` — add `extract_intro_badge(warm_path_str)` (returns the badge = first line of the display string) and render it at the 3 existing warm-path render points (active card ~160-161, applied table Warm Path col ~192-203, queue Warm col ~238-242), respecting current truncation widths. Omit the `Intro:` line on active cards when 0/Cold.
  - Bun tests in `tests/`.
- **Out:**
  - `intro_badge_clicked` telemetry — DROPPED: a CLI text view can't track clicks (honest note). Any future interactive UI gates it behind XOS-98 via the existing local sink pattern.
  - match-tracker schema change — none; badge embeds in the existing `warm_path` field's display string.
  - New scorer file — extend `surface-intros.ts` (it already owns this presentation layer).

## Acceptance criteria
- [ ] `scoreIntroStrength` returns correct score/label/badge per the weight+bonus formula; 0 paths → score 0, "cold", badge "Cold".
- [ ] Badge prepended to `warm_path_display`; `pipeline-view` renders it at all 3 points; no badge line on Cold active cards.
- [ ] Reuses existing `StrengthLabel` semantics; no schema change; no new graph logic.
- [ ] `bun test` green; pipeline-view.py runs without error.

## Test plan (Bun)
- [ ] 1 strong path → score 80, badge "1 warm intro · Strong".
- [ ] 5 paths, best very_strong → score min(100, 95+min(10,20))=100, badge "5 warm intros · Very Strong".
- [ ] 0 paths → score 0, "cold", badge "Cold".
- [ ] very_strong + weak → 95 + min(10,5)=100, "Very Strong".
- [ ] moderate + weak → 55 + 5 = 60 → "Moderate", badge "2 warm intros · Moderate".

## Rollback
Additive — a scorer fn in `surface-intros.ts` + a Python render helper. No existing-runtime behavior change beyond an extra display line. Revert the branch to undo.
