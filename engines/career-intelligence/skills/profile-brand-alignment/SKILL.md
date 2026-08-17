---
name: profile-brand-alignment
description: >
  Scores how well the user's LinkedIn profile narrative aligns with their brand
  voice, content themes, and Context Engine positioning. Use when the user asks
  for profile-brand alignment, LinkedIn/profile coherence, brand voice fit,
  content theme consistency, or gaps where the profile undercuts their public
  brand. Advisory scoring only; does not rewrite the profile.
triggers:
  - profile brand alignment
  - profile-brand alignment
  - linkedin brand alignment
  - profile coherence
  - brand voice fit
  - content theme alignment
  - profile undermines brand
---

# Profile Brand Alignment - Career Intelligence Skill

## Purpose

Score whether the user's LinkedIn profile says the same thing their brand voice
and content themes are saying. Surface contradictions, missing proof, and
positioning drift that could reduce inbound trust.

This skill is advisory only. It scores, flags gaps, and gives a prioritized fix
list. Do not rewrite the profile, generate replacement copy, publish, open a
browser, scrape LinkedIn, or call any network service. If the user wants new
profile copy, route that to the separate profile rewrite workflow.

## Output Format

Always start with:

```text
Career Intelligence: Profile Brand Alignment
```

Output plain text only. Do not use markdown tables or pipe characters.

Include:
- Overall alignment score.
- Per-section scores.
- Prioritized fixes, worst first.
- A short note that this is advisory scoring only.

## Inputs

Gather local/profile context in this order:

1. Use profile sections supplied by the user in chat.
2. If missing, read conventional local profile files when available:
   - `identity/linkedin-profile.md`
   - `identity/profile.md`
   - `identity/experience-history.md`
   - `identity/skills-matrix.md`
3. Extract at least these sections when available:
   - `headline`
   - `summary`
   - `experience`
4. If no usable profile sections are available, ask the user for their current
   headline, summary/about text, and representative experience bullets.

Gather brand voice and themes in this order:

1. First try:
   ```ts
   await brain.read("brand-amplification/voice-strategies/content-flywheel.md")
   ```
2. If that file is missing or unreadable, try local identity brand files:
   - `identity/brand-voice.md`
   - `identity/content-themes.md`
   - `identity/brand.md`
   - `identity/positioning.md`
3. If brand config is still missing, continue scoring against generic
   professional-brand coherence and add a high-priority gap that the brand voice
   config is missing. Do not crash.

Use only local user-provided or brain-readable data. Do not retrieve LinkedIn,
social posts, websites, or remote files.

## Semantic Rubric

The LLM performs the semantic judgment. For each profile section, assign a
0-100 score and gap strings using this rubric:

- Voice consistency, 25 points: Does the profile sound like the user's stated
  brand voice, or does it read like a different operating identity?
- Theme overlap, 25 points: Does the section reinforce recurring content
  themes, IP lanes, and public expertise areas?
- Narrative coherence, 25 points: Does the section make the same career promise
  as the brand content, with a clear through-line from role to proof to point of
  view?
- Contradiction detection, 25 points: Does the section contradict, narrow, or
  undermine the brand? Examples: the profile positions the user as a generic
  engineering manager while content positions them as an AI systems thinker; or
  experience bullets emphasize execution only while posts emphasize strategy.

Scoring guidance:
- 90-100: Strong alignment; only minor polish gaps.
- 75-89: Mostly aligned; one or two missing proof points or theme gaps.
- 50-74: Mixed alignment; inbound may see a different story than the content.
- 25-49: Weak alignment; visible contradiction or major missing narrative.
- 0-24: Actively undermines the brand voice or content themes.

Gap strings should be specific enough to act on, but do not include unnecessary
private details. Do not produce rewritten profile copy.

## Helper Contract

After semantic scoring, pass only section scores to the deterministic helper.
The helper aggregates, ranks, formats, and emits PII-free telemetry. It must not
do semantic judgment.

Expected input shape:

```ts
const sectionScores = [
  { section: "headline", score: 40, gaps: ["headline says EM while brand says AI systems thinker"] },
  { section: "summary", score: 85, gaps: [] },
  { section: "experience", score: 70, gaps: ["experience lacks proof for recurring AI systems theme"] },
];
```

Call the helper:

```ts
import {
  aggregateAlignment,
  emitProfileBrandAlignmentScored,
  formatAlignmentReport,
} from "$CLAUDE_PLUGIN_ROOT/src/pipeline/profile-brand-alignment";

const result = aggregateAlignment(sectionScores);
console.log(formatAlignmentReport(result));
emitProfileBrandAlignmentScored(result);
```

Or write the scores to a local JSON file and run:

```bash
bun "$CLAUDE_PLUGIN_ROOT/src/pipeline/profile-brand-alignment.ts" --scores /path/to/section-scores.json
```

The formatted report is paste-safe plain text and has no pipe characters.

## Telemetry

When a score is produced, emit:

```ts
emitProfileBrandAlignmentScored(result);
```

The event is `profile_brand_alignment_scored`. It is local-only, gated by
`XOS_98_TELEMETRY`, and writes through the existing local JSONL telemetry path.
Payload is PII-free: overall score bucket, section count, gap count, timestamp.
Do not include profile text, brand text, names, companies, roles, section names,
post text, or gap text in telemetry.

## Safety Rules

- Advisory/scoring only; never rewrite the profile.
- Local only; no browser, scraping, external APIs, or network.
- Keep profile text and brand text out of telemetry.
- Tolerate missing brand config with a clear gap and generic coherence scoring.
- Use brand voice and Context Engine wording.
- Do not use markdown tables or pipe characters in the final report.
