---
name: sde-onboarding
description: >
  Week 1 onboarding wizard for new SDE users. Interviews the user across 3 areas
  (brand identity, platform handles, distribution topology), then generates the 4
  required context files that the SDE needs to run. Cross-session memory baked in
  from day one — the user never re-explains who they are.
triggers:
  - onboard me to SDE
  - sde setup
  - sde onboarding
  - week 1 setup
  - set up my sde
  - new user setup
  - set up my distribution engine
  - i'm new to sde
  - get me started with sde
---

# SDE Onboarding — Week 1 Setup

## Purpose

New SDE users need 4 files before the first campaign can run. This skill generates all four through a structured interview. Once complete, the user has cross-session memory baked in — brand voice, handles, channel directory, and distribution topology persist across every future session automatically.

## Output Format

Always start with:
```
━━━ Career OS: SDE Onboarding ━━━
```

## The 4 Files This Skill Generates

| File | Path | What it does |
|---|---|---|
| `professional-brand.md` | `brain/identity/professional-brand.md` | Brand voice, tone, narrative pillars, IP firewall. Auto-loaded before every draft. |
| `handles.md` | `brain/identity/handles.md` | All platform handles. Used by Gates 3, 6, and every distribution module. |
| `content-flywheel.md` | `brain/social-distribution-engine/content-flywheel.md` | Per-user distribution topology — which platform is honey pot, juice hub, spokes. |
| `social-channel-directory.md` | `brain/social-distribution-engine/social-channel-directory.md` | Channel quality ratings. Gate 2 reads this on every preflight to block banned channels. |

## Execution Flow

### Phase 0 — Workspace Setup (runs FIRST, before any questions)

Before asking anything else, establish `$CAREER_HOME`:

```bash
# Check if CAREER_HOME is already set
echo "${CAREER_HOME:-not set}"
```

**If already set:** confirm the path exists and is writable. Print: "Using `$CAREER_HOME` as your workspace." Then proceed to Phase 1.

**If not set:** ask ONE question before starting the interview:

> "Where should your SDE workspace live? This is the folder that stores your brand context, campaigns, and session memory.
>
> Default: `~/career-os` (press Enter to accept, or type a different path)
>
> Recommended: a private folder you git-commit regularly — your brand context and campaigns are valuable artifacts."

After they answer (or press Enter for default):
1. Create the directory structure:
   ```bash
   mkdir -p "$CAREER_HOME/brain/identity"
   mkdir -p "$CAREER_HOME/brain/social-distribution-engine"
   ```
2. Print: "Workspace created at `$CAREER_HOME`. Starting setup..."
3. **Persist the path** — add to shell profile so it survives sessions:
   ```bash
   echo 'export CAREER_HOME="<path>"' >> ~/.zshrc  # or ~/.bashrc if zsh not found
   export CAREER_HOME="<path>"
   ```
4. Proceed to Phase 1.

**Default path for new users:** `~/career-os` (NOT `~/anand-career-os` — that is Anand Vallamsetla's personal workspace).

---

### Phase 1 — Brand Interview (5 questions)

Ask the following questions ONE AT A TIME. Wait for each answer before asking the next. Do not batch.

**Q1:** "What's your full name and the brand name you use online? (e.g., 'Anand Vallamsetla / The Why Man')"

**Q2:** "In 2-3 sentences: what do you do, who do you do it for, and what makes you different? This becomes your primary brand statement."

**Q3:** "What are your 3 core content pillars — the themes every piece of content connects back to?"

**Q4:** "Describe your voice in 3 words. Then: what are you NOT? (e.g., 'not a tutorial writer, not a hype merchant')"

**Q5:** "Any terms or framings that must NEVER appear in your published content? (IP firewall — could be competitor names, internal jargon, personal details, or positioning you've deliberately avoided)"

### Phase 2 — Handles Interview (1 question, multiple parts)

**Q6:** "List your handles for each platform you're active on. For each, tell me its role in your flywheel (primary hub, conversion, or spoke):
- LinkedIn: 
- Substack / newsletter:
- X / Twitter:
- Instagram:
- Reddit:
- Facebook:
- Website / other:"

### Phase 3 — Distribution Topology (3 questions)

**Q7:** "Which platform is your HONEY POT — the owned soil where you convert followers into permanent subscribers? (Usually Substack / newsletter / email list)"

**Q8:** "Which platform is your JUICE HUB — your primary engagement engine where social proof compounds? (Usually LinkedIn for B2B professionals)"

**Q9:** "What subreddits, Facebook groups, or community channels are safe for you to post in? Any channels that are banned or low-ROI for your audience?"

---

### Phase 4 — File Generation

After all 9 answers are collected:

1. Read the 4 template files from the plugin bundle:
   - `$(ls -v ~/.claude/plugins/cache/xos/career-intelligence/*/skills/social-distribution-engine/onboarding-templates/*.template.md 2>/dev/null)`

2. Fill in all `{{PLACEHOLDER}}` tokens with the user's answers.

3. Write the 4 files to the user's `$CAREER_HOME/brain/` directory:
   ```
   brain/identity/professional-brand.md
   brain/identity/handles.md
   brain/social-distribution-engine/content-flywheel.md
   brain/social-distribution-engine/social-channel-directory.md
   ```
   **If files already exist: ask before overwriting.** Existing files may have evolved content that should be preserved.

4. Validate: confirm all 4 files exist and are non-empty.

5. Run a quick smoke test — check that `brain/identity/handles.md` has at least one handle entry and `brain/social-distribution-engine/content-flywheel.md` has platform role assignments.

---

### Phase 5 — Completion Summary

Print this summary:

```
━━━ SDE Onboarding Complete ━━━

Files created:
  ✅ brain/identity/professional-brand.md
  ✅ brain/identity/handles.md
  ✅ brain/social-distribution-engine/content-flywheel.md
  ✅ brain/social-distribution-engine/social-channel-directory.md

Cross-session memory: ACTIVE
  → Your brand voice, handles, and distribution topology are now git-versioned.
  → Every future SDE session loads these automatically — you never re-explain who you are.

What Claude Cowork can't do that you now have:
  → Cross-session memory (their #1 stated limitation — solved)
  → 9-gate preflight CI on every campaign
  → Invisible signal CTA enforcement (bookmark, save, DM-share, profile-click)
  → Golden hour scheduling validation

Week 2 — Your First Campaign:
  1. Run: "create campaign [your topic]" to start the campaign engine
  2. The 9-gate preflight CI will validate everything before distribution
  3. Your context files are already loaded — no setup needed

One optional step now: git commit your 4 new files so they're versioned:
  git -C $CAREER_HOME init  # only if not already a git repo
  git -C $CAREER_HOME add brain/identity/professional-brand.md brain/identity/handles.md brain/social-distribution-engine/content-flywheel.md brain/social-distribution-engine/social-channel-directory.md
  git -C $CAREER_HOME commit -m "feat(sde): Week 1 onboarding — context files initialized"
```

---

## Privacy Note

The 4 files are local to the user's machine and `$CAREER_HOME` directory. They are never transmitted anywhere unless the user explicitly opts in to signal sharing (`share_outcomes: true` in content-flywheel.md). Signal sharing, when opted in, shares only bucketed performance outcomes — never content, handles, or personal details.

---

## Failure Modes

- **User skips a question:** Ask again with context ("This becomes your primary brand statement — it's what every future draft is anchored to. Even a rough version is better than leaving it blank.")
- **User doesn't know their subreddits yet:** Leave `social-channel-directory.md` with placeholder rows and note: "Update this before your first Reddit spoke post — Gate 2 will block unknown channels."
- **Files already exist:** Show a diff of what would change. Ask: "Overwrite, merge, or skip?" Never silently overwrite.
- **$CAREER_HOME not set:** Phase 0 handles this — ask for path and create directory before the interview starts. Default is `~/career-os` for new users. Never default to `~/anand-career-os` (that is Anand Vallamsetla's personal workspace, not a template path).
