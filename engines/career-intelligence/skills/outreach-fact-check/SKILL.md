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

# Outreach Fact-Check — Career OS Skill

## What This Skill Does

Prevents biographical hallucinations from shipping in T4 (irreversible, external-facing)
artifacts — outreach emails, LinkedIn DMs, cover letters, applications, public posts,
any communication sent to a real human that makes a factual claim about Anand's career.

**Origin (2026-04-26 — [Recipient] near-miss):** An agent inherited a draft saying
"last 4 as Google L6" and built a send-ready Gmail compose URL from it. Canonical source
(`experience-history.md`) says: January 2019 – May 2025 = **6 years 5 months** at Google.
Multi-dim sweep then surfaced three more silent errors in the same draft class:
"50+ reports" (canonical: up to 16), "$200K floor" — canonical has NO compensation anchor
(verdict: unknown, not mismatch — the skill correctly returns unknown on this class because
there is no canonical figure to diff against), "99.99% uptime" attributed to wrong company.
All four would have reached real humans in a PANIC-mode warm-path. User caught pre-send.
This skill is the mechanical gate that prose verification failed to enforce.

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

> ⚠️ **FORWARD SPEC — implementation pending.** This section documents the
> intended Mode 2 behavior for the v0.27.0 ship. The `preflight.sh` script
> referenced in the wiring example below is **NOT YET SHIPPED in v0.26.0**.
> Until v0.27.0 ships, Mode 1 (on-demand verification) is the only functional
> mode. The agent MUST invoke the skill explicitly before T4 outreach. Mode 2
> closes that bypass-loophole; until then, the verifier remains advisory.

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
| `identity.md` | Personal brand statement, coaching identity ("AI-native EM coach"), values, mission, career arc, persona |
| `handles.md` | Social/professional handles — LinkedIn URL, GitHub, Substack, X/Twitter, thewhyman.com |

**Why `brain/identity/`, NOT `~/cyborg/`:** Instance-specific biographical content migrated
from `~/cyborg/` to `$CAREER_HOME/brain/identity/` per migration v3 (2026-04-26) and
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

**Key anchors (as of last canonical update):**
- Google: January 2019 – May 2025 = **6 years 5 months** (NOT "4 years", NOT "6 years",
  NOT "5 years" — exact phrase "6 years 5 months")
- Resilience AI: June 2025 – February 2026 = 9 months

**Example claims to catch:**
- "last 4 as Google L6" → MISMATCH: canonical is 6 years 5 months total at Google
- "6 years at Google" → LOW-confidence match (close, but omits the 5 months — flag)
- "joined Google in 2018" → MISMATCH: canonical start is January 2019

### 2. Title / Role Claims
**Pattern:** "as a [Title]", "[Level] [Role]", "Senior Director of", "L[N] [role]"

**Canonical source:** `experience-history.md` — `Level:` and `LinkedIn title:` fields

**Key anchors:**
- Google: **L6 AE Manager II** / LinkedIn title: "Senior Software Engineering Manager"
  (NOT "L6 SDM", NOT "Director of Engineering", NOT "Engineering Director")
- Resilience AI: Founder & Applied AI Product Engineering Lead

**Example claims to catch:**
- "last 4 as Google L6 SDM" → MISMATCH: title is AE Manager II, not SDM (SDM is Amazon)
- "Director of Engineering at Google" → MISMATCH: title was SWE Manager, not Director

### 3. Team Size / Scope Claims
**Pattern:** "led [N] engineers", "team of [N]", "managed [N] reports",
  "[N]+ direct reports", "org of [N]"

**Canonical source:** `experience-history.md` — scope/leadership sections

**Key anchors (Google):**
- "Managed up to **16** engineers and contractors" (line in § 4.3 Leadership section)
- "5-16 reports managed" (range per performance review notes in § 4.3)
- Pod model: 10 contractors (EPAM) embedded — not the same as 16 direct reports

**Example claims to catch:**
- "managed 50+ reports" → MISMATCH: canonical max is 16
- "led 20 engineers" → MISMATCH: canonical says "up to 16"
- "team of 4 managers" → INSUFFICIENT_EVIDENCE: not mentioned in canonical; flag

### 4. Compensation / Financial Claims
**Pattern:** "$[N]K base", "$[N]K RSUs", "total comp of $[N]", "earning $[N]",
  "floor of $[N]"

**Canonical source:** `experience-history.md` (when present); if absent → flag for human
  review; NEVER fabricate compensation data.

**Key rule:** If no compensation figure appears in canonical → verdict: `unknown`,
  confidence: LOW, remediation: "Remove specific dollar figure or confirm with Anand."

**Example claims to catch:**
- "$200K floor" → cross-reference canonical; if no explicit anchor → unknown / flag
- "$320K total comp" → verify exact figure exists in canonical or mark unknown

### 5. Recognition / Award Claims
**Pattern:** "[N] hackathon wins", "[Award name] winner", "received [Award]",
  "[Prize] from [Company]"

**Canonical source:** `experience-history.md` (hackathon details in § 4.3) +
  `awards-education-speaking.md`

**Key anchors:**
- GCP Customer Empathy Award — from Thomas Kurian (CEO, Google Cloud) — Aug 12, 2024
- iSCaaS+ 2023 SCOT Hackathon: blockchain team 2nd prize (Product Excellence Award);
  AI team finalist (Op & Eng Excellence Award)
- NOT a hackathon: gPals (gHacks24) — category-defining prototype but no stated prize

**Example claims to catch:**
- "10 hackathon wins" → MISMATCH: verify exact count from canonical; do not round up
- "won the Google Innovation Award" → verify exact award name against canonical

### 6. Education Claims
**Pattern:** "MBA from [school]", "MS in [field] from [school]", "Berkeley [degree]",
  "graduated from [school] in [year]"

**Canonical source:** `awards-education-speaking.md`

**Key anchors (from canonical):**
- UC Berkeley Haas — EMBA program (verify exact graduation year from canonical)
- Cross-check school name, degree type, year claimed

**Example claims to catch:**
- "Harvard MBA" → MISMATCH: Berkeley Haas
- "BS in Computer Science from Stanford" → verify against canonical

### 7. Speaking / Publication Claims
**Pattern:** "spoke at [Event]", "keynote at [Conference]", "published in [Publication]",
  "presented at [Venue]"

**Canonical source:** `awards-education-speaking.md` + `experience-history.md`
  (speaking engagements within role sections)

**Key anchors:**
- HealthTech Summit 2026 — AIify.io — San Francisco — Jan 14-16, 2026 — keynote speaker
  (talk: "Intelligence Systems for Health, Performance, and Resilience")

**Example claims to catch:**
- "keynote at CES 2026" → MISMATCH or UNKNOWN: not in canonical
- "published in HBR" → verify against canonical; no such entry → unknown

### 8. Identity / Brand Claims
**Pattern:** "thewhyman", "AI-native EM coach", "co-intelligence architect",
  handle references

**Canonical source:** `identity.md` (brand statement, coaching identity) +
  `handles.md` (handle correctness)

**Example claims to catch:**
- Wrong handle (e.g., @thewhymann) → diff against `handles.md`
- "career OS founder" vs actual positioning in `identity.md`

### 9. Uptime / Metric Claims
**Pattern:** "[N]% uptime", "[N]x performance improvement", "$[N]M savings",
  "[N]% efficiency gain"

**Canonical source:** `experience-history.md` — ROI and metric sections per role

**Key rule:** Metric claims MUST name the system and company.
  If claim doesn't anchor to a specific system → `insufficient_evidence`.
  If anchored but company is wrong → `mismatch`.

**Key anchors (Google):**
- P6/Spring Tide: 400% performance improvement, $6.3M/yr savings
- iSCaaS+ hackathon: 51,840,000% efficiency gain (supply chain recall)
- $500M+ ROI across 6 GDC engineering tracks
- $51M ROI: DC Security/VM over 5 years; $31M savings: PLM-IMS for MRP over 5 years

**Example claims to catch:**
- "99.99% uptime at Google" → verify in canonical; if not present → unknown; if attributed
  to wrong company → mismatch

### 10. Comparative Claims
**Pattern:** "more [X] than [Y]", "one of the top [N]", "first [descriptor]",
  "best [superlative]"

**Canonical source:** Comparative claims only pass if the underlying components each
  verify independently against canonical. If either component lacks a canonical anchor
  → `insufficient_evidence`.

**Example claims to catch:**
- "more AI experience than most EMs" → INSUFFICIENT_EVIDENCE: no canonical anchor
- "first GCP supply chain hackathon" → HIGH match — exact phrase in canonical:
  "First-ever GCP supply chain hackathon in Google's history" (§ 4.3)

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
# Protocol 8 calls the career-os:outreach-fact-check skill directly by name.
# The HOW.sh below is the cyborg-side enforcement primitive that MANDATES this dispatch —
# it does NOT perform verification itself; it calls THIS skill.
career-os:outreach-fact-check "$(jq -n -c \
  --arg claim "6 years at Google as L6 SDM" \
  --arg artifact_type "email" \
  --arg recipient "[Recipient]" \
  '{claim:$claim, artifact_type:$artifact_type, recipient:$recipient}')"

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
| xHumanOS (Anand) | `career-os:outreach-fact-check` (this skill) | `$CAREER_HOME/brain/identity/` |
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
━━━ Career OS: Outreach Fact-Check ━━━
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
