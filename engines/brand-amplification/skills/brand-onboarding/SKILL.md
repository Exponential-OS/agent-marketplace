---
name: brand-onboarding
description: >
  Week 1 onboarding wizard for new Brand Amplification Engine (BAE) users.
  Interviews the user across 3 areas (brand identity, platform handles,
  distribution topology), then generates the 4 required context files BAE
  needs to run. Cross-session memory baked in from day one — the user never
  re-explains who they are.
triggers:
  - onboard me to brand amplification
  - brand setup
  - brand onboarding
  - week 1 setup
  - set up my brand engine
  - new user setup
  - set up my distribution engine
  - i'm new to brand amplification
  - get me started with brand
---

# Brand Amplification Onboarding — Week 1 Setup

## Purpose

New BAE users need 4 files before the first campaign can run. This skill generates all four through a structured interview. Once complete, the user has cross-session memory baked in — brand voice, handles, channel directory, and distribution topology persist across every future session automatically.

## Output Format

Always start with:
```
━━━ Brand Amplification Engine · Onboarding ━━━
```

## The 4 Files This Skill Generates

### Brain API (brain-kernel >= 1.0.0)

All writes go through `brain.write(path, content, opts)`. All reads go through
`brain.read(path)`. Direct filesystem writes are FORBIDDEN — the kernel
enforces ACL and provenance on every operation.

| File | brain.write() path | What it does |
|---|---|---|
| `professional-brand.md` | `brand-amplification/identity/professional-brand.md` | Brand voice, tone, narrative pillars, IP firewall. Auto-loaded before every draft. |
| `handles.md` | `identity/handles.md` | All platform handles. Used by Gates 3, 6, and every distribution module. (primitive write — declared in writes_to_primitives) |
| `content-flywheel.md` | `brand-amplification/voice-strategies/content-flywheel.md` | Per-user distribution topology — which platform is honey pot, juice hub, spokes. |
| `social-channel-directory.md` | `brand-amplification/campaigns/social-channel-directory.md` | Channel quality ratings. Gate 2 reads this on every preflight to block banned channels. |

**Write call pattern (owned namespace):**
```
brain.write("brand-amplification/identity/professional-brand.md", content, {
  provenance: { who: "brand-amplification", why: "onboarding: brand identity initialized", source: "brand-onboarding" },
  engine_id: "brand-amplification"
})
```

**Write call pattern (primitive — handles.md):**
```
brain.write("identity/handles.md", content, {
  provenance: { who: "brand-amplification", why: "onboarding: handles initialized", source: "brand-onboarding" },
  engine_id: "brand-amplification"
})
```
ACL allows this because `writes_to_primitives: ["identity/handles.md"]` is declared in the engine manifest.

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
1. Workspace directories are created automatically by brain.write() — no manual mkdir needed.
   brain.write() calls mkdirSync(dirname(abs), { recursive: true }) internally.
   <!-- SPEC-DRIFT-DETECTED: old code used direct mkdir + CAREER_HOME; now brain-kernel handles path creation -->
2. Print: "Workspace created. Starting setup..."
3. **Persist the path** — add to shell profile so it survives sessions:
   ```bash
   echo 'export CAREER_HOME="<path>"' >> ~/.zshrc  # or ~/.bashrc if zsh not found
   export CAREER_HOME="<path>"
   ```
4. Proceed to Phase 1.

**Default path for new users:** `~/career-os` (do not use personal workspace paths as defaults).

---

### Phase 1 — Brand Interview (5 questions)

Ask the following questions ONE AT A TIME. Wait for each answer before asking the next. Do not batch.

**Q1:** "What's your full name and the brand name you use online? (e.g., 'Alex Chen / The Product Strategist')"

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
   - `$(ls -v ~/.claude/plugins/cache/xos/brand-amplification/*/skills/social-distribution-engine/onboarding-templates/*.template.md 2>/dev/null)`

2. Fill in all `{{PLACEHOLDER}}` tokens with the user's answers.

3. Write the 4 files via brain API:
   ```
   brain.write("brand-amplification/identity/professional-brand.md", ...)
   brain.write("identity/handles.md", ...)              ← primitive write (writes_to_primitives)
   brain.write("brand-amplification/voice-strategies/content-flywheel.md", ...)
   brain.write("brand-amplification/campaigns/social-channel-directory.md", ...)
   ```
   **If files already exist: ask before overwriting.** Check via `brain.read(path)` — non-null result = file exists.

4. Validate: confirm all 4 writes returned `ok: true`.

5. Run a quick smoke test — check that `brain.read("identity/handles.md")` returns content with at least one handle entry and `brain.read("brand-amplification/voice-strategies/content-flywheel.md")` has platform role assignments.

---

### Phase 5 — Completion Summary

Print this summary:

```
━━━ Brand Amplification · Onboarding Complete ━━━

Files created:
  ✅ brand-amplification/identity/professional-brand.md
  ✅ identity/handles.md  (primitive — shared with Career OS)
  ✅ brand-amplification/voice-strategies/content-flywheel.md
  ✅ brand-amplification/campaigns/social-channel-directory.md

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

brain.write() auto-commits every file via brain-kernel. Your 4 context files
are already versioned — no manual git commit needed.
```

---

## Privacy Note

The 4 files are local to the user's machine and `$CAREER_HOME` directory. They are never transmitted anywhere unless the user explicitly opts in to signal sharing (`share_outcomes: true` in content-flywheel.md). Signal sharing, when opted in, shares only bucketed performance outcomes — never content, handles, or personal details.

---

## Failure Modes

- **User skips a question:** Ask again with context ("This becomes your primary brand statement — it's what every future draft is anchored to. Even a rough version is better than leaving it blank.")
- **User doesn't know their subreddits yet:** Leave `social-channel-directory.md` with placeholder rows and note: "Update this before your first Reddit spoke post — Gate 2 will block unknown channels."
- **Files already exist:** Show a diff of what would change. Ask: "Overwrite, merge, or skip?" Never silently overwrite.
- **$CAREER_HOME not set:** Phase 0 handles this — ask for path and create directory before the interview starts. Default is `~/career-os` for new users. Never default to a personal workspace path.
