# Cover Letter as a First-Class Standalone Skill
status: design
slug: xos-103-cover-letter-skill
ticket: XOS-103
repo: ~/aiprojects/career-intelligence-engine

## What
Extract cover-letter generation (today buried in `resume-engine` + the apply flow) into a first-class standalone skill, invokable any time for ANY application — including ones not tracked in xOS.

## Why (NSM)
Removes friction at the application step → users complete more applications per session → more pipeline throughput / wins per unit of attention.

## Scope
- **In:**
  - New `skills/cover-letter/SKILL.md` — clean frontmatter (name, description, triggers: "write a cover letter for", "cover letter for", "cover letter"). Generates a cover letter from {company, role, JD} + the user's identity, for any application (tracked or untracked — accept explicit inputs, don't require a pipeline row). Writes to the existing output location (`Resumes & Cover Letters/` — match resume-engine's convention).
  - **Reuse, don't duplicate:** factor the cover-letter generation logic out of `resume-engine` so both the standalone skill AND the apply/resume flow call the SAME logic (extract a shared instruction block / helper; resume-engine references the new skill rather than carrying its own copy).
  - **Biographical grounding (invariant):** must read identity from `experience-history.md` (+ people files where relevant) — NO fabricated career claims (this plugin enforces named-person/biographical grounding). State the grounding step explicitly in the skill.
  - **Local event:** `cover_letter_generated` `{standalone: true|false, company, role, ts}` appended to the local events JSONL, gated behind `XOS_98_TELEMETRY` (default off), no phone-home.
  - Accessible from session start (registered like other skills; mission-control routes "cover letter" to it).
- **Out:**
  - PostHog / outbound telemetry (XOS-98-gated).
  - Re-implementing generation logic in two places (the whole point is one source).
  - Resume customization (stays in resume-engine; this is cover-letter-only).

## Acceptance criteria
- [ ] `skills/cover-letter/SKILL.md` exists, triggers on natural phrases, generates a cover letter for an arbitrary {company, role, JD} without requiring a tracked pipeline row.
- [ ] Generation logic is shared with resume-engine (no duplicated copy); resume-engine's cover-letter path now routes to the shared logic / new skill.
- [ ] Skill reads identity from `experience-history.md`; no fabricated biographical claims.
- [ ] `cover_letter_generated` event local-only + XOS_98_TELEMETRY-gated; no network call.
- [ ] Existing suite green (`tests/run-all.sh`); skill validation passes; no unrelated changes.

## Test plan
- [ ] Skill resolves + smoke-generates for an untracked {company, role} input.
- [ ] resume-engine cover-letter path still works (reuses shared logic, no regression).
- [ ] `run-all.sh` green (canonical-path / skill / mission-control suites).

## Rollback
Additive new skill + a refactor that points resume-engine at shared logic. Revert the branch to undo; resume-engine's original cover-letter path is preserved in git history.
