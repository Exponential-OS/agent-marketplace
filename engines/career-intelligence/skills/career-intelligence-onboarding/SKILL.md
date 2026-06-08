---
name: career-intelligence-onboarding
description: >
  Week 1 onboarding wizard for new Career Intelligence users. Interviews the user
  across 3 areas (work history, skills, job search preferences), then generates the
  2 required context files that Career Intelligence needs to run. The outreach-composer,
  outreach-fact-check, resume-engine, and job-match-scorer skills all load these files
  automatically — the user never re-explains their background.
triggers:
  - onboard me to career intelligence
  - career setup
  - career onboarding
  - set up my career
  - career intelligence setup
  - set up job search
  - i'm new to career intelligence
  - get me started with career intelligence
  - career intelligence week 1
---

# Career Intelligence Onboarding — Week 1 Setup

## Purpose

New Career Intelligence users need 2 files before job search, outreach, and resume skills can run accurately. This skill generates both through a structured interview. Once complete, the user's experience history and job search preferences persist across every future session — no re-explaining background on every outreach draft.

## Output Format

Always start with:
```
━━━ Career Intelligence: Onboarding ━━━
```

## The 2 Files This Skill Generates

All writes go through `brain.write()` with `engine_id: "career-intelligence"`.
`identity/experience-history.md` is an xOS primitive — permitted via
`writes_to_primitives` declaration.

| File | brain.write() path | What it does |
|---|---|---|
| `experience-history.md` | `identity/experience-history.md` | Work history, key achievements, skills, education. Loaded by outreach-fact-check before every outreach draft to prevent fabricated claims. |
| `job-search-config.md` | `career-intelligence/projects/job-search-config.md` | Target roles, companies, location, salary, and non-negotiables. Loaded by job-match-scorer and mission-control. |

## Execution Flow

### Phase 0 — Workspace Setup (runs FIRST)

Check `$CAREER_HOME`. If not set or directory doesn't exist:

> "Where should your Career Intelligence workspace live? This is where your experience history, job pipeline, and session memory will be stored.
>
> Default: `~/career-os` (press Enter to accept, or type a different path)"

After they answer:
1. Create: `mkdir -p "$CAREER_HOME/identity" "$CAREER_HOME/network/people" "$CAREER_HOME/career-intelligence"`
2. Persist: `echo 'export CAREER_HOME="<path>"' >> ~/.zshrc && export CAREER_HOME="<path>"`
3. Print: "Workspace ready at `$CAREER_HOME`. Let's capture your background."

If already set: confirm directory is writable and proceed.

---

### Phase 1 — Work History (4 questions, ONE AT A TIME)

**Q1:** "What is your current or most recent job title and company? (e.g., 'Senior Product Manager at Stripe')"

**Q2:** "Walk me through your last 3 roles — for each: title, company, and the ONE achievement you're most proud of. (Don't worry about perfect wording — rough is fine, we'll refine it.)"

**Q3:** "What are your top 5–7 technical or functional skills? (e.g., 'Python, product strategy, LLM systems, stakeholder management')"

**Q4:** "Highest education: degree, field, institution, year? Any other credentials worth noting (certifications, notable programs, executive education)?"

---

### Phase 2 — Job Search Preferences (4 questions, ONE AT A TIME)

**Q5:** "What type of role are you targeting next? Give me: title/level, function, and type of company (startup, growth, enterprise, specific industry)."

**Q6:** "Location and work style preference? (e.g., 'SF Bay Area, hybrid 2x/week' or 'remote-first, any US timezone')"

**Q7:** "Target compensation range? Total comp including base + equity if relevant. (This stays local — used only for job-match scoring, never shared.)"

**Q8:** "What are your hard NON-NEGOTIABLES? Things that would make you immediately reject a role. (e.g., 'no contract roles, no defense/weapons, must have equity, visa sponsorship required')"

---

### Phase 3 — File Generation

After all 8 answers:

1. Read the 2 template files:
   ```
   $(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/skills/career-intelligence-onboarding/onboarding-templates/*.template.md 2>/dev/null)
   ```

2. Fill in all `{{PLACEHOLDER}}` tokens with the user's answers. For multi-role work history (Q2): expand the template's role blocks to cover all roles mentioned.

3. Write the 2 files via brain.write():
   ```
   brain.write("identity/experience-history.md", content, {
     provenance: { who: "career-intelligence", why: "onboarding: experience history", source: "career-intelligence-onboarding" },
     engine_id: "career-intelligence"
   })
   brain.write("career-intelligence/projects/job-search-config.md", content, {
     provenance: { who: "career-intelligence", why: "onboarding: job search config", source: "career-intelligence-onboarding" },
     engine_id: "career-intelligence"
   })
   ```
   **If files already exist (brain.exists() returns true): show what would change. Ask: "Overwrite, merge, or skip?"**

4. Validate: confirm both files exist and are non-empty.

5. Smoke test: confirm `experience-history.md` has at least one role entry and `job-search-config.md` has a `target_roles` field.

---

### Phase 4 — Completion Summary

Print this summary:

```
━━━ Career Intelligence Onboarding Complete ━━━

Files created:
  ✅ brain/identity/experience-history.md
  ✅ career-intelligence/projects/job-search/job-search-config.md

Cross-session memory: ACTIVE
  → Your background is now loaded into every outreach draft automatically.
  → outreach-fact-check will verify claims against your real history before sending.
  → job-match-scorer will score roles against your preferences — no re-explaining each time.

What's next:
  → "show me my job pipeline" — see your current applications
  → "score this job: [paste JD]" — instant fit analysis against your preferences
  → "write outreach to [name] at [company]" — grounded in your real background

One optional step: git commit your context files so they're versioned:
  git -C $CAREER_HOME add brain/identity/experience-history.md career-intelligence/projects/job-search/job-search-config.md
  git -C $CAREER_HOME commit -m "feat(career): Week 1 onboarding — experience history + job search config"
```

---

## Integration with SDE Onboarding

Career Intelligence Onboarding and SDE Onboarding are independent but complementary:

- **SDE Onboarding** (`"onboard me to SDE"`) → generates brand + handles + flywheel + channel directory. Covers distribution.
- **Career Intelligence Onboarding** (this skill) → generates experience history + job search config. Covers job search + outreach.

Both can be run in any order. Running both gives the full xHumanOS experience.

For users who are founders or operators (not actively job-searching): SDE Onboarding alone is sufficient for Week 1.

---

## Failure Modes

- **User skips a question:** Ask again with context ("This becomes the ground truth for every outreach email — even a rough version catches fabrication errors before your emails go out.")
- **User has many roles (>5):** Ask them to prioritize the 3 most relevant to their target. Others can be added later by editing the file directly.
- **User declines to share salary:** Leave `target_compensation` as `"not specified"` — job-match-scorer skips compensation scoring.
- **Files already exist:** Show a diff preview. Ask: "Overwrite, merge, or skip?" Never silently overwrite.
