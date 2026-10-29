---
name: outreach-fact-check
description: >
  Verifies biographical claims in T4 outreach drafts against canonical identity
  files before ship. Returns structured match/mismatch/unknown verdicts with
  diff lines. Dispatched by co-dialectic v4.1 Protocol 8 when a T4 artifact
  contains a detected biographical claim. Say "verify claim: [text]" or let
  Protocol 8 invoke automatically on T4 + biographical-claim detection.
triggers:
  - verify claim
  - bio claim verify
  - check this claim
  - fact check outreach
  - verify bio
  - bio verifier
  - claim check
  - protocol 8 verify
---

# Outreach Fact-Check — Career Intelligence Skill

## What This Skill Does

Prevents biographical hallucinations from shipping in T4 (irreversible, external-facing)
artifacts — outreach emails, LinkedIn DMs, cover letters, applications, public posts,
any communication sent to a real human that makes a factual claim about the user's career.

**Origin (2026-04-26):** An agent inherited a draft that understated a tenure by
more than two years and built a send-ready compose URL from it. A multi-dimension
sweep then surfaced three further silent errors in the same draft: an inflated
direct-report count, a compensation floor with no canonical anchor at all, and a
reliability statistic attributed to the wrong employer. All four were on a path to
a real recipient on a warm introduction, and were caught by the user seconds before
send. Each error was individually plausible, which is exactly why self-review
missed them. This skill is the mechanical gate that prose verification failed to
enforce.

**Co-dialectic Protocol 8 dispatch target:** When Protocol 8 classifies an artifact as
T4 AND detects a biographical claim pattern → dispatches to this skill. The skill returns
a structured verdict; Protocol 8 blocks or passes ship accordingly.

---

## Two Modes of Operation

This skill operates in two complementary modes. Both share the same verification
engine; they differ in WHEN and HOW the verification fires.

### Mode 1 — On-Demand Verification (default)

The user or an agent invokes the skill explicitly with a claim. The skill returns a
structured verdict. The caller decides what to do with it.

- Trigger: `verify claim: <text>`, `fact check this`, `bio claim verify`, or Protocol 8
  dispatch on T3+ artifacts.
- Output: structured verdict (see Input/Output Contract below).
- Caller responsibility: read the verdict and act on it.

### Mode 2 — Pre-Send Check (PreToolUse hook on outgoing tools)

> ⚠️ **FORWARD SPEC — NOT IMPLEMENTED.** This section documents an intended
> Mode 2 design. The `preflight.sh` script in the wiring example below has
> never shipped, and the wiring is illustrative only — do not copy it into a
> settings file expecting it to run. Mode 1 (on-demand verification) is the
> only functional mode: the agent MUST invoke this skill explicitly before T4
> outreach. Until Mode 2 exists, the verifier remains advisory and the
> bypass-loophole it would close is still open.

When wired as a PreToolUse hook on outgoing-message tools (`mcp__claude_ai_Gmail__create_draft`,
LinkedIn DM tools, etc.), the skill runs automatically on every outgoing message body —
extracts biographical claims, runs verification, and BLOCKS the tool call if any claim
returns a `mismatch` verdict. This is the FAIL-HARD enforcement primitive that closes
the gap between "advisory verifier" and "verifier that actually fires under attention
load."

**Wiring** (in `~/.claude/settings.json`):

```json
"PreToolUse": [
  {
    "matcher": "mcp__claude_ai_Gmail__create_draft",
    "hooks": [
      {
        "type": "command",
        "command": "/path/to/career-os-plugin/skills/outreach-fact-check/preflight.sh"
      }
    ]
  }
]
```

**Behavior** (per verdict):

| Verdict | Action |
|---|---|
| `match` | ALLOW the tool call silently |
| `unknown` | ALLOW with surfaced soft warning (figure not in canonical — agent decides) |
| `insufficient_evidence` | ALLOW with surfaced soft warning (claim too vague to diff) |
| `mismatch` | **BLOCK** with the full diff + remediation in the block reason |

**Override** (per FAIL-HARD invariant — overrides are explicit, audited):

If the agent receives a BLOCK and the user explicitly authorizes the claim in the
next turn (e.g., "yes, that figure is correct, override and send"), the agent MAY
bypass the block ONCE for this specific claim+recipient combination. The override
is logged to `~/.career-os-state/fact-check-overrides.log` with timestamp + claim +
recipient + canonical-diff for audit. Standing override does NOT exist; every
override is single-use, single-claim, single-recipient.

**Why fold the pre-send check INTO this skill** (rather than ship as a separate
hook): single source of truth. The verification logic lives in one place; both
modes consume it. Adding a second skill or a separate hook script duplicates the
claim-extraction logic and risks drift between "what the verifier returns" and
"what the hook blocks on." One skill, two surfaces. Sister to Constitution
OBJECTIVE-CODIFICATION + variance-is-evil — no second instance to disagree.

---

## Input / Output Contract

### Input

```json
{
  "claim": "<verbatim claim text — must be exact, not paraphrase>",
  "claim_class": "<optional — one of the 10 classes below; if omitted, skill auto-detects>",
  "artifact_type": "<optional — email | linkedin_dm | cover_letter | post | other>",
  "recipient": "<optional — real human name if T4 warm-path>",
  "context_excerpt": "<optional — surrounding sentences from the artifact for disambiguation>"
}
```

### Output (Verdict)

```json
{
  "claim": "<verbatim claim — copied from input>",
  "claim_class": "tenure|title|scope|compensation|recognition|education|speaking|identity|metric|comparative",
  "verdict": "match|mismatch|unknown|insufficient_evidence",
  "canonical_source": "<tilde-prefixed canonical path — e.g. $CAREER_HOME/brain/identity/experience-history.md. The field returns the tilde form (portable across machines, matches how brain files reference each other). Consumers expand ~ at read time.>",
  "canonical_excerpt": "<the specific line(s) from canonical that govern this claim>",
  "diff": "<for mismatch: short rationale — what the claim says vs what canonical says>",
  "confidence": "HIGH|MEDIUM|LOW",
  "remediation": "<for mismatch: specific rewrite suggestion using canonical language>",
  "blast_radius_note": "<for mismatch: other artifact paths/classes presumed to carry same error — empty string or null when not applicable>"
}
```

**Verdict semantics:**
- `match` — claim is consistent with canonical; ship allowed.
- `mismatch` — claim contradicts canonical; BLOCK ship; remediation provided.
- `unknown` — claim class detected but no canonical entry covers it (e.g., a project detail
  not in any identity file); flag for human review; do not auto-block.
- `insufficient_evidence` — claim is too vague to diff (e.g., "many years") without more
  context; flag and request disambiguation from the drafting agent.

**Field requirements by verdict:**
- `blast_radius_note` — **required** (non-empty) for `mismatch` verdicts; the field must name
  other artifact paths or claim classes in the same blast radius that should be audited before
  resuming. Set to `null` or empty string `""` for `match`, `unknown`, and
  `insufficient_evidence` verdicts.

---

## Canonical Source Paths

All sources live in `$CAREER_HOME/brain/identity/` (migrated from `brain/`
per migration v4, 2026-04-27). Career-os plugin skills access these directly — no symlinks.

| File | Canonical For |
|------|--------------|
| `experience-history.md` | Employment dates, titles, levels (L5/L6/etc.), team size, direct reports, scope, compensation ranges (when present), ROI figures, specific achievements per role |
| `awards-education-speaking.md` | Degrees, certifications, hackathon wins, awards with citations, speaking engagements with event names + dates |
| `identity.md` | Personal brand statement, coaching identity, values, mission, career arc, persona |
| `handles.md` | Social/professional handles — LinkedIn URL, GitHub, Substack, X/Twitter, personal site |

**Why `brain/identity/`, NOT a shared config path:** Instance-specific biographical content lives at
`$CAREER_HOME/brain/identity/` per migration v3 (2026-04-26) and
confirmed by migration v4 (2026-04-27). Future xTeamOS / xFamilyOS verifiers will read
from THEIR instance's `brain/identity/` — same pattern, different path.

**Fallback when file unavailable:** return `verdict: unknown` with `confidence: LOW` and
note `"canonical_source": "UNAVAILABLE — {reason}"`. Never fabricate canonical content.

---

## 10 Claim Classes

### 1. Tenure Claims
**Pattern:** "X years at [Company]", "from [year] to [year]", "since [year]",
  "[N]-year stint", "joined in [year]", "left in [year]"

**Canonical source:** `experience-history.md` — `Period:` field per role section

**Where the anchor lives:** every `Period:` line in the user's
`experience-history.md`. Compute the span from the canonical start and end dates;
never accept a tenure figure stated in the draft as its own evidence.

**Match rule:** the drafted span must equal the canonical span to the month.

A draft that rounds a partial year DOWN is a `mismatch`, not a low-confidence
`match`. This matters mechanically, not pedantically: the verdict table above
ALLOWs `match` silently and keys on the verdict alone, never on confidence — so
anything emitted as `match` ships unseen no matter how low its confidence. Any
claim that should reach a human must carry `mismatch` or `unknown`.

**Example claims to catch** (synthetic candidate: Northwind, Apr 2014 to Oct 2019;
these figures are invented and match no real record):
- "last 3 years at Northwind" → MISMATCH: canonical span is 5 years 7 months
- "5 years at Northwind" → MISMATCH: understates 5 years 7 months. Emit mismatch,
  not a low-confidence match, or it ships silently.
- "joined Northwind in 2013" → MISMATCH: canonical start is April 2014

### 2. Title / Role Claims
**Pattern:** "as a [Title]", "[Level] [Role]", "Senior Director of", "L[N] [role]"

**Canonical source:** `experience-history.md` — `Level:` and `LinkedIn title:` fields

**Where the anchor lives:** the `Level:` and `LinkedIn title:` fields per role in
the user's `experience-history.md`.

**Match rule:** internal level ladders differ between employers, and a title that
is ordinary at one company can imply a different scope at another. Treat any
title not present verbatim in canonical as a MISMATCH, including a seniority
upgrade that merely sounds equivalent.

**Example claims to catch** (canonical: `Senior Engineering Manager`, Northwind):
- "Director of Engineering at Northwind" → MISMATCH: canonical title is Senior
  Engineering Manager; director implies a layer the record does not support
- "Principal SDM at Northwind" → MISMATCH: SDM belongs to a different employer's
  ladder and appears nowhere in canonical
- "Engineering lead at Northwind" → MISMATCH: paraphrase, not the canonical title

### 3. Team Size / Scope Claims
**Pattern:** "led [N] engineers", "team of [N]", "managed [N] reports",
  "[N]+ direct reports", "org of [N]"

**Canonical source:** `experience-history.md` — scope/leadership sections

**Where the anchor lives:** the scope and leadership sections per role in the
user's `experience-history.md`.

**Match rule:** use the canonical maximum, and keep the distinction the canonical
record makes between direct reports, embedded contractors and total org size. A
draft that merges those into one larger number is a MISMATCH even when the total
is arithmetically correct.

**Example claims to catch** (canonical: "managed up to 9 engineers and
contractors"):
- "managed 40+ reports" → MISMATCH: canonical maximum is 9
- "managed 9 direct reports" → INSUFFICIENT_EVIDENCE: canonical gives a combined
  headcount of employees and contractors and never states how it splits, so the
  direct-report count is not established either way. Do not infer it.
- "managed 3 team leads" → INSUFFICIENT_EVIDENCE: no management layer in canonical

### 4. Compensation / Financial Claims
**Pattern:** "$[N]K base", "$[N]K RSUs", "total comp of $[N]", "earning $[N]",
  "floor of $[N]"

**Canonical source:** `experience-history.md` (when present); if absent → flag for human
  review; NEVER fabricate compensation data.

**Key rule:** If no compensation figure appears in canonical → verdict: `unknown`,
  confidence: LOW, remediation: "Remove specific dollar figure or confirm with the user."

**Example claims to catch:**
- Any dollar figure with no matching figure in canonical → `unknown`, flag for the user
- A figure that is close to but not identical with canonical → `mismatch`, never round

### 5. Recognition / Award Claims
**Pattern:** "[N] hackathon wins", "[Award name] winner", "received [Award]",
  "[Prize] from [Company]"

**Canonical source:** `experience-history.md` (recognition entries per role) +
  `awards-education-speaking.md`

**Where the anchor lives:** the user's `awards-education-speaking.md`, plus award
mentions inside role sections of `experience-history.md`.

**Match rule:** count only entries the canonical record states as a win. A
finalist placing, a shortlist, or a well-received project with no stated prize
does not increment a win count. Award names must match verbatim.

**Example claims to catch:**
- An aggregate win count higher than the canonical entries support → MISMATCH
- A finalist entry counted as a win → MISMATCH
- An award name paraphrased rather than quoted → MISMATCH

### 6. Education Claims
**Pattern:** "MBA from [school]", "MS in [field] from [school]", "[school] [degree]",
  "graduated from [school] in [year]"

**Canonical source:** `awards-education-speaking.md`

**Where the anchor lives:** the user's `awards-education-speaking.md`.

**Match rule:** school, degree type, program variant and year must each match
canonical independently. A correct school with the wrong program variant is still
a MISMATCH.

**Example claims to catch:**
- Any institution not present in canonical → MISMATCH
- Correct school, wrong degree or program variant → MISMATCH
- A graduation year not stated in canonical → INSUFFICIENT_EVIDENCE

### 7. Speaking / Publication Claims
**Pattern:** "spoke at [Event]", "keynote at [Conference]", "published in [Publication]",
  "presented at [Venue]"

**Canonical source:** `awards-education-speaking.md` + `experience-history.md`
  (speaking engagements within role sections)

**Where the anchor lives:** the user's `awards-education-speaking.md`, plus
speaking entries inside role sections of `experience-history.md`.

**Match rule:** the venue, the year and the speaking role must all anchor. Panel
participation is not a keynote; an accepted talk is not a published paper.

**Example claims to catch:**
- A venue with no canonical entry → UNKNOWN, flag
- A canonical panel appearance drafted as a keynote → MISMATCH
- A publication with no canonical entry → UNKNOWN

### 8. Identity / Brand Claims
**Pattern:** personal brand name, coaching identity label, online persona descriptor,
  handle references

**Canonical source:** `identity.md` (brand statement, coaching identity) +
  `handles.md` (handle correctness)

**Where the anchor lives:** the brand statement and positioning line in the user's
`identity.md`, and the per-platform handle entries in `handles.md`.

**Match rule:** handles must match character for character, including case and
platform. A positioning descriptor must appear in canonical as written; a
paraphrase that sounds equivalent is a `mismatch`, because the brand line is the
claim. A platform with no handle entry is `unknown`, not an invitation to guess.

**Example claims to catch:**
- Draft writes `@jordan_reyes` where canonical records `@jordanreyes` → MISMATCH
- Draft cites a handle on a platform absent from `handles.md` → UNKNOWN
- Draft paraphrases the canonical positioning line into a different claim → MISMATCH

### 9. Uptime / Metric Claims
**Pattern:** "[N]% uptime", "[N]x performance improvement", "$[N]M savings",
  "[N]% efficiency gain"

**Canonical source:** `experience-history.md` — ROI and metric sections per role

**Key rule:** Metric claims MUST name the system and company.
  If claim doesn't anchor to a specific system → `insufficient_evidence`.
  If anchored but company is wrong → `mismatch`.

**Where the anchor lives:** the ROI and metric lines inside each role section of
the user's `experience-history.md`.

**Match rule:** a metric must anchor to the same system AND the same employer as
canonical. Carrying a real figure across to the wrong employer is the most common
version of this error and reads as entirely plausible, so check the company on
every metric even when the number verifies.

**Example claims to catch:**
- A reliability or savings figure with no canonical anchor → UNKNOWN
- A real canonical figure attributed to the wrong employer → MISMATCH
- A metric stated without naming its system → INSUFFICIENT_EVIDENCE

### 10. Comparative Claims
**Pattern:** "more [X] than [Y]", "one of the top [N]", "first [descriptor]",
  "best [superlative]"

**Canonical source:** Comparative claims only pass if the underlying components each
  verify independently against canonical. If either component lacks a canonical anchor
  → `insufficient_evidence`.

**Example claims to catch:**
- "more AI experience than most EMs" → INSUFFICIENT_EVIDENCE: no canonical anchor
- A superlative stated verbatim in canonical, e.g. "first such event at the company"
  → HIGH match, but ONLY for the exact scope canonical states. A draft that widens
  it (adding a product area, a market, or an industry the canonical phrase never
  claimed) is a MISMATCH, not a match.

---

## Dispatch from Protocol 8 (co-dialectic v4.1)

**NOTE: Protocol 8 and co-dialectic v4.1 are forward specs — not yet shipped. Until v4.1
ships, this skill must be invoked manually on every T4 artifact containing biographical
claims. Manual trigger: "verify claim: [text]".**

When co-dialectic classifies an artifact as **T4 (irreversible, external-facing)**
AND the Protocol 8 biographical-claim detector fires, Protocol 8:

1. Extracts each claim segment from the artifact text.
2. For each claim: constructs a `outreach-fact-check` input JSON (see Input contract above).
3. Invokes this skill by name via the plugin skill-dispatch mechanism:

```bash
# Example invocation from outreach-composer or Protocol 8 dispatch
# Protocol 8 invokes the career-intelligence:outreach-fact-check SKILL by name.
# A skill identifier is not a shell executable. The block below shows the JSON
# payload the skill receives, built with jq; it is not a runnable command line.
# The pre-check rule (rules/biographical-claim-precheck/handler.ts) is a
# separate, coarser gate: it greps the draft for unanchored claim patterns and
# BLOCKs T4 ship. It does not replace this skill's per-claim verdicts.
# payload passed to career-intelligence:outreach-fact-check
jq -n -c \
  --arg claim "5 years at Northwind as a senior engineering manager" \
  --arg artifact_type "email" \
  --arg recipient "[Recipient]" \
  '{claim:$claim, artifact_type:$artifact_type, recipient:$recipient}'

# Enforcement gate (separate concern — enforces that dispatch is mandatory):
# biographical-claim-precheck/HOW.py blocks T4 ship if this skill
# has not been invoked for the artifact. Run it AFTER outreach-fact-check, not instead of it.
```

4. Collects all verdicts. If ANY verdict is `mismatch`:
   - Protocol 8 returns `BLOCK` to the parent agent.
   - Parent agent fixes the mismatch using the `remediation` field.
   - Re-runs the verifier on the corrected claim.
   - Only proceeds to ship when all verdicts are `match` or `unknown` (with human review
     flag on any `unknown`).

5. Parent agent includes in its response to the user:
   `Outreach fact-check: PASS — N claims verified (M match, K flagged for review)`

### T4 explicit-confirm requirement (non-negotiable)
This skill BLOCKS biological claim mismatches. It does NOT override Protocol 8's
T4 explicit-confirm requirement — that gate is at the Protocol 8 level, not here.
Even if ALL claims verify as `match`, Protocol 8 still requires explicit human
confirmation before the artifact ships (outreach to a real human = irreversible T4).
This skill gates the ACCURACY of the artifact; Protocol 8 gates the SHIP decision.

---

## Anti-Patterns

**What this skill must NOT do:**

- ❌ **Never auto-rewrite the claim.** Return the diff + remediation. The drafting agent
  rewrites; this skill only verifies. Autonomously modifying the artifact would corrupt
  the original drafting agent's context and bypass the human's final review.

- ❌ **Never ship the artifact.** This skill is a verification gate, not a distribution
  layer. Returning `verdict: match` is NOT a ship signal — it signals "accurate"; the
  parent agent and Protocol 8 decide whether to ship.

- ❌ **Never override Protocol 8's T4 explicit-confirm requirement.** A fully-passing
  verification does not grant ship permission. The human must still approve T4 artifacts.

- ❌ **Never fabricate canonical content.** If the canonical file is unavailable or the
  claim has no canonical anchor → return `unknown` or `insufficient_evidence`, never
  invent a "canonical excerpt" that sounds plausible.

- ❌ **Never lower the tier based on confidence.** "This looks right, so I'll soft-verify."
  A T4 artifact runs full verification regardless of how confident the drafting agent felt.
  Confidence is explicitly not a tier-lowering signal (EMERGENT SYSTEM IMMUNITY invariant).

- ❌ **Never single-slot fix.** If a claim mismatch is found in artifact A, the same
  claim class is presumed present in every artifact B/C/D in the same blast radius
  (e.g., every outreach draft with the same biographical claim). Audit all before resuming.
  Report the blast-radius scope in the verdict for the drafting agent to act on.

- ❌ **Never treat sub-agent output as pre-verified.** If the draft was authored by another
  agent, ALL biographical claims start as UNVERIFIED regardless of what the authoring agent
  said. The [Recipient] near-miss was exactly this: agent inherited a draft authored hours
  earlier by a sibling agent and built a send-ready URL from it without re-verifying.

---

## Composition with Protocol 8

```
co-dialectic v4.1 Protocol 8
│
├── Artifact classification: T4 (irreversible, external-facing)
├── Bio-claim detection: ✓ (claims extracted from artifact text)
│
└── [for each claim] → outreach-fact-check
       │
       ├── Read canonical: $CAREER_HOME/brain/identity/experience-history.md
       ├── Read canonical: $CAREER_HOME/brain/identity/awards-education-speaking.md
       ├── Read canonical: $CAREER_HOME/brain/identity/identity.md
       ├── Read canonical: $CAREER_HOME/brain/identity/handles.md
       │
       └── Return: { verdict, canonical_excerpt, diff, remediation }
              │
              ├── ALL match → Protocol 8: bio-gate PASS → proceed to T4 confirm
              └── ANY mismatch → Protocol 8: BLOCK → drafting agent fixes → re-verify
```

---

## Future-Proof Shape — xOS Verifier Family

This skill establishes the pattern for the xOS canonical-claim verifier family.
Future incarnations follow the same architecture, different canonical paths:

| Product | Skill name | Canonical sources |
|---------|-----------|-------------------|
| xHumanOS (this instance) | `career-intelligence:outreach-fact-check` (this skill) | `$CAREER_HOME/brain/identity/` |
| xTeamOS | `team-claim-verifier` | `~/[team-instance]/brain/identity/` |
| xFamilyOS | `family-claim-verifier` | `~/[family-instance]/brain/identity/` |
| xCommunityOS | `community-claim-verifier` | `~/[community-instance]/brain/identity/` |

Co-dialectic Protocol 8 stays the universal dispatcher — it calls whichever verifier
is registered for the active xOS instance. The verifier skill is instance-specific;
the dispatch protocol is universal.

---

## Multi-Agent Safety (P15)

This skill reads canonical files; it does NOT write to them. Read paths are safe for
concurrent multi-agent access. If a canonical file changes between reads in a multi-step
verification pass, re-read before finalizing the verdict — never use a cached read from
more than one tool invocation ago.

**Canonical files are read-only from this skill's perspective.** Any correction to
canonical content (e.g., updating a date or scope figure) must go through the appropriate
data-entry path (session-logger, organize, or direct human edit) — never through this
verification skill.

---

## Output Format

Always start the response with:
```
━━━ Career Intelligence: Outreach Fact-Check ━━━
```

For multi-claim verification (e.g., dispatched from Protocol 8 with N claims):
```
━━━ Outreach Fact-Check Report ━━━

Claims verified: N
  ✅ Match:               K
  ❌ Mismatch (BLOCK):    M
  ⚠️  Unknown (flag):      J
  ❓ Insufficient evidence: L

[Verdict block for each claim — see JSON schema above]

Blast-radius note: [if any mismatch found, list other artifact files likely to carry
the same claim class and recommend audit before resuming]

Recommendation: [PASS — proceed to T4 confirm] or [BLOCK — fix claims before ship]
```

---

## Dependencies

- `experience-history.md` at `$CAREER_HOME/brain/identity/` (required — primary canonical)
- `awards-education-speaking.md` at same path (required for classes 5, 6, 7)
- `identity.md` at same path (required for class 8)
- `handles.md` at same path (required for class 8)
- co-dialectic Protocol 8 (dispatcher — optional; skill also usable standalone)
- `$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/rules/biographical-claim-precheck/HOW.py 2>/dev/null | tail -1)` (enforcement primitive per
  CONSTITUTION-AS-LIVING-CODE invariant — rule directory ships with HOW.py +
  AUDIT.sh + WATCH.sh)
