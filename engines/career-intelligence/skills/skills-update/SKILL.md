---
name: skills-update
description: >
  Real-time skills matrix updates. Adds, modifies, or marks stale any skill in
  the user's skills-matrix.md. Activates when the user mentions learning a
  technology, disputes a gap flagged by the job-match-scorer, or asks to update their
  skills profile. On gap closure, offers to re-score affected pipeline roles.
  Owns all writes to: identity/skills-matrix.md (xOS primitive) via brain.write().
triggers:
  - su
  # Explicit update
  - add to my skills
  - update my skills
  - update my skills matrix
  - mark as proficient
  - I'm now proficient in
  - I learned
  - I've been working with
  - I've been doing a lot of
  - I built something with
  - I shipped
  - add proficiency in
  - remove from my skills
  - that skill is stale
  - rescan my skills
  # Implicit gap dispute
  - that's not actually a gap
  - I do know
  - I have experience with
---

# Skills Update — Career OS Skill

## Purpose

Adds, modifies, or marks stale any skill in the user's `skills-matrix.md`.
Handles both individual real-time updates and bulk rescan. On gap closure,
offers to re-score affected pipeline roles via the job-match-scorer.

Separated from `organize` because organize handles bulk one-time scanning;
skills-update handles the ongoing, real-time maintenance of the skills matrix.

## Output Format

Always start your response with:
```
━━━ Career OS: Skills Update ━━━
```

## How to Invoke

- "I learned Rust" — add a new skill to the matrix
- "add Python to my skills" — explicit add
- "mark Go as proficient" — update proficiency level
- "that's not actually a gap" — dispute a job-match-scorer-flagged gap
- "rescan my skills" — bulk GitHub repo rescan
- "remove React from my skills" / "React is stale" — mark as stale

---

## DATA ARCHITECTURE

### Brain API (brain-kernel >= 1.0.0)

`identity/skills-matrix.md` is an xOS primitive. This skill writes it via
`brain.write()` with `engine_id: "career-intelligence"` — permitted because
`identity/skills-matrix.md` is in this engine's `writes_to_primitives` declaration.

### Inputs (what the skill reads)

| Source | brain.read() path | What It Provides |
|--------|------------------|------------------|
| Skills matrix | `brain.read("identity/skills-matrix.md")` | Current skills state |
| Match Tracker | `brain.read("career-intelligence/match-tracker.json")` | Active pipeline roles with gap flags |
| Pipeline | `brain.read("career-intelligence/pipeline.json")` | Companies to check for gap closure impact |

### Outputs (what the skill writes)

| Output | brain.write() path | What It Contains |
|--------|-------------------|------------------|
| Skills matrix (updated) | `identity/skills-matrix.md` | New/modified skill rows |
| Handoff entry | `NEXT_SESSION_HANDOFF.md` | Note on significant changes (especially gap closures) |
| Console output | — | Re-score offer for affected pipeline roles |

**Write call pattern (primitive write):**
```
brain.write("identity/skills-matrix.md", content, {
  provenance: { who: "career-intelligence", why: "skill updated by user", source: "skills-update" },
  engine_id: "career-intelligence"
})
```

---

## PROFICIENCY & LEARNABILITY SCALES

### Proficiency
- **Expert** — deep production experience, can mentor others
- **Proficient** — solid working knowledge, production use
- **Familiar** — have used it, could ramp quickly
- **Learning** — actively acquiring, not yet production-ready
- **Gap** — no meaningful experience
- **Stale** — previously known, no longer current

### Learnability
- **Fast** — closes in <1 month (adjacent skill, strong foundation)
- **Medium** — 1-3 months (new domain area)
- **Slow** — 3+ months (structural, requires domain depth)
- **N/A** — already proficient or above

---

## BEHAVIOR: Add a Skill

1. Identify the correct category (Languages & Frameworks, Platforms & Infra, Domain, Leadership)
2. Propose the row: skill name, proficiency, last used, evidence, learnable
3. **Show the proposed addition for confirmation** — never write without approval
4. Write on approval — append to the correct table section
5. Update `Last updated` date in the file header

---

## BEHAVIOR: Update Proficiency

1. Find the existing row in skills-matrix.md
2. Show current vs. proposed value
3. Update on confirmation
4. If proficiency improves from Gap/Familiar to Proficient/Expert:
   - Check if job-match-scorer has flagged this as a gap for any active pipeline roles
   - Surface: "You just improved [X] — this closes a gap at [Company]. Want me to re-score?"

---

## BEHAVIOR: Mark Stale / Remove

1. Don't delete — mark as `Last Used: {date} (stale)` and `Proficiency: Stale`
2. Stale skills still matter for historical context but are de-weighted in scoring
3. Confirm before marking stale

---

## BEHAVIOR: Bulk Rescan

When triggered by "rescan my skills":

1. Re-read GitHub repos via available tools
2. Diff against current matrix
3. Show: new skills detected, proficiency changes, stale candidates
4. **Confirm before writing** — present the full diff
5. Update matrix on approval

---

## BEHAVIOR: Gap Dispute

When the user disputes a job-match-scorer-flagged gap ("that's not actually a gap", "I do know [X]"):

1. Find the skill in the matrix
2. If it exists at Gap/Familiar level → offer to update proficiency
3. If it doesn't exist → offer to add it
4. After update, offer to re-score the affected role

---

## SCORER INTEGRATION (P14 Self-Evolution)

The job-match-scorer reads `skills-matrix.md` for:
1. **Gap detection** — is a required JD skill at Proficient or above?
2. **Learnability** — if a gap, how fast can it be closed?

When skills-update runs, check active pipeline roles in `job-pipeline-match-tracker.json`:
> "You just added [X] — this closes a gap at [Company]. Want me to re-score that role?"

This closes the self-evolution loop: skill improves → score improves → pipeline updates.

---

## INTEGRATION POINTS

| Skill | Relationship |
|-------|-------------|
| `job-match-scorer` | Primary consumer — skills-update feeds job-match-scorer accuracy. Gap closure triggers re-score offer. |
| `resume-engine` | Uses skills matrix to select which technologies to highlight per track. |
| `organize` | Bulk skills scan is a one-time operation; skills-update handles real-time changes. |
| `interview-prep` | May surface skills gaps when mapping stories to JD requirements. |
| `mission-control` | Memory health section could surface "skills matrix last updated X days ago". |

---

## MULTI-AGENT SAFETY (P15)

1. `brain.read("identity/skills-matrix.md")` immediately before any write (kernel pull ensures latest)
2. Surgical edits — append rows or update specific cells, never rewrite tables
3. Update `Last updated` date on every write
4. Log significant changes to `NEXT_SESSION_HANDOFF.md` (especially gap closures)

---

## EDGE CASES

- **Duplicate skill**: warn "X already exists at [level] — want to update proficiency instead?"
- **skills-matrix.md doesn't exist**: write via `brain.write("identity/skills-matrix.md", ...)` with header structure and category sections
- **No active pipeline roles**: gap closure re-score offer is skipped gracefully
- **User disputes but evidence is ambiguous**: ask for evidence ("What project did you use X on?") before updating
- **Bulk rescan with no GitHub access**: surface the limitation, offer manual add instead
