---
name: social-distribution-engine
description: >
  The orchestrator for xOS content distribution. Coordinates platform-specific modules,
  enforces The Scraping Invariant (protecting human trust), and ensures campaign
  spokes are distributed according to the Kinetic Learning loop.
triggers:
  - distribute campaign
  - run social distribution
  - post campaign
  - trigger distribution
---

# Social Distribution Engine — Master Orchestrator

## Purpose

The Social Distribution Engine is the ultimate distribution and kinetic learning hub for xOS. It orchestrates content distribution across multiple platforms, adhering strictly to **The Scraping Invariant**: protecting human trust by recognizing that internet publishing is permanent. It prevents spam by parking low-confidence content and escalating to the human.

## Why SDE — What Vanilla Claude Cowork Cannot Do

Most users capture ~10% of Claude's capability by treating it as a chatbot. SDE closes that gap with machine-enforced structure:

| Capability | Claude Cowork | SDE |
|---|---|---|
| **Cross-session memory** | ❌ No memory between sessions | ✅ Git-versioned brain — brand voice, audience, handles, campaign history persist forever across every session |
| **Distribution enforcement** | ❌ Guidelines the user must remember | ✅ 9-gate preflight CI blocks distribution until all best practices are met |
| **Invisible signal CTAs** | ❌ Not checked | ✅ Gate 8 BLOCKs if missing bookmark ask, Instagram save prompt, DM-share prompt, mid-content Substack forward |
| **Timing optimization** | ❌ Not checked | ✅ Gate 9 warns when scheduled outside platform golden windows |
| **Platform-native routing** | ❌ User must remember rules | ✅ Estate model enforces hub-spoke routing, Post Hub tension, link-in-comment discipline |
| **Cross-session brand voice** | ❌ Re-explained each session | ✅ professional-brand.md auto-loaded — every draft starts on-voice |

**The cross-session memory gap specifically:** Claude Cowork lists "no cross-session memory" as its #1 limitation. SDE solves this at the infrastructure level — your brand voice, platform handles, campaign history, and audience context are git-versioned and auto-loaded at session start. You never re-explain who you are.

## Output Format

Always start your response with:
```
━━━ Career OS: Social Distribution Engine ━━━
```

## Capabilities

### 1. Dynamic Campaign Orchestration (The Flywheel Coordinator)
**Triggers:** "distribute campaign [name]", "post campaign"

When a campaign is ready for distribution, the Engine acts as a Master Coordinator:
1. **Load User Configuration:** Read the user's specific distribution configuration (e.g., `brain/social-distribution-engine/content-flywheel.md`) to understand *their* unique topology.
   - Which platform is configured as their **Honey Pot** (source of truth/conversion)?
   - Which platform acts as **The Juice** (primary engagement hub)?
   - Which platforms are **The Spokes** (traffic drivers)?
2. **Read Campaign Context:** Locate the campaign master file to understand the assets and copy.
3. **Evaluate Invariants:** Check if confidence is > 80% and if assets are reviewed. If not, **PARK IT** and escalate.
4. **Execute the Customized Flywheel:** 
   - Dynamically prompt the correct platform modules based on the user's defined roles.
   - *Example:* If the user's Honey Pot is Substack and Juice is LinkedIn, trigger `substack-distribution-module` first, then `linkedin-distribution-module`. If another user uses YouTube as the Honey Pot and X as the Juice, adapt the orchestration order accordingly.
   - **The Vortex:** Instruct the selected spoke modules to execute cross-linking and comment cascades to amplify the signal based on the user's specific platform mix.
   - **Squeezing Old Oranges (Amplification Sweep):** Invoke the `flywheel-amplification-module` to cross-link the new campaign backward into the last 3 historical campaigns, bumping old hubs and spokes with new comments to reactivate the algorithm.
5. **Update Ledger:** Maintain the campaign tracking ledger to record execution status.

### 2. Safeguarding Human Trust (Scraping Invariant)
Before distributing to *any* channel, check the Global Channel Value Directory (`brain/social-distribution-engine/social-channel-directory.md`) via the Analytics Engine.
- If a channel is marked ⚠️ BANNED or Low ROI, **skip it**.
- If a post's quality is questionable or seems promotional for strict channels, escalate to the user before publishing.

## Step 0 — Context Pre-Flight (MANDATORY before any content generation)

**Origin:** 2026-05-05 — users cold-open with content requests (e.g., "write a LinkedIn post about my AI Fund panel") without prior session context load. The agent drafts without brand voice, IP firewall, or campaign context. The draft is generic at best, violates IP constraints at worst.

**Rule:** Before writing a single word of content, confirm the following files are loaded this session. If any are missing, read them silently NOW:

| File | What it provides | Fallback if missing |
|---|---|---|
| `brain/identity/professional-brand.md` | Brand voice, tone, positioning, narrative pillars | Emit `⚠️ brand context missing — draft may be off-voice` and proceed |
| `brain/identity/handles.md` | Active platform handles, CTA destinations | Proceed, but omit handle-specific CTAs |
| `$(ls -v ~/.claude/plugins/cache/xos/career-os/*/skills/social-distribution-engine/content-flywheel.md 2>/dev/null \| tail -1)` IP Firewall section | Terms that must NEVER appear in published content | **BLOCK** — cannot draft without IP firewall loaded |
| Campaign master file (if distributing existing campaign) | Assets, platform copy, surface coverage matrix | Required for distribution mode; not required for fresh-draft mode |

**Context load is silent** — do not narrate "loading brand context…" to the user. Just load, then draft.

**Litmus test:** "Before I wrote the first word, did I read professional-brand.md AND the IP Firewall? If no — stop, load them, restart."

---

## Campaign Pre-Flight Gate (MANDATORY — runs BEFORE Per-Content Gates)

**Run once per campaign before distributing any component.**
Exit 0 = ALL PASS. Exit 1 = BLOCK (fix and re-run). Exit 2 = WARN (review before distributing).

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/career-os/*/skills/social-distribution-engine/validate-campaign-preflight.py 2>/dev/null | tail -1)" \
  /path/to/campaign.json
```

This meta-harness runs 9 gates in sequence:
- **Planning:** campaign-schema-validator, channel-status-check, surface-coverage-check
- **Content:** content-url-resolution-check (blocks on unresolved `[TOKEN]` placeholders)
- **Pre-Dist:** flywheel-sequence-guard (Estate publish order), visual-asset-review-check, golden-hour-scheduling-check (advisory — warns if scheduled_at timestamps fall outside platform golden windows: LinkedIn 07:30–09:00/11:30–13:00/17:00–18:30, X 08:00–10:00/12:00–13:00/17:00–18:00, Instagram 06:00–09:00/11:00–13:00/19:00–21:00, Substack 06:00–10:00; default timezone America/Los_Angeles)
- **Semantic:** campaign-estate-quality-check (LLM judge — Estate model packaging: hub-spoke routing, Post Hub hook discipline, Article Substack CTA, platform-native copy, comment cascade strategy)
- **Semantic:** flywheel-cta-quality-check (LLM judge — CTA strength + platform-appropriateness: Substack share specificity + mid-content forward, Article CTA placement, Post Hub tension, X link-in-reply/bookmark ask/profile-click hook, Reddit link-in-comment, Instagram bio-link/save prompt/DM-share prompt, Facebook share ask, comment cascade 2+ topic-specific keywords)

**Must PASS before proceeding to per-content gates below.**

---

## Pre-Publication Gate (MANDATORY)

**Every piece of content must pass both gates before `status: ready` or any publish action.**
Skipping either gate is a Ground Zero violation (Irreversible-Action Invariant — LinkedIn cannot un-send, Substack newsletters reach all subscribers).

### Gate 1 — Structural (post_validator.py)

Checks character limits, markdown bleed, pipe characters, HTML, URL suppression, promo language.

```bash
python3 "$(dirname "$0")/post_validator.py" \
  --platform linkedin_post \
  --text "<post body>"
```

Exit 0 = PASS. Exit 1 = FAIL (hard block — revise before Gate 2). Exit 2 = WARN (review then proceed).

### Gate 2 — Semantic (social-content-readiness-check)

Runs three parallel LLM judges (tone/authenticity, IP/patent firewall, narrative clarity) plus metadata completeness. Uses OAuth CLIs — no API key required (claude → gemini → codex fallback chain).

```bash
python3 "$(ls -v ~/.claude/plugins/cache/xos/career-os/*/rules/social-content-readiness-check/HOW.py 2>/dev/null | tail -1)" \
  '{"text":"<post body>","platform":"linkedin","title":"<campaign title>","metadata":{"audience":"<target audience>","surface_coverage_matrix":"<path or description>"}}'
```

Exit 0 = PASS → ship. Exit 1 = BLOCK → revise and re-run both gates. Exit 2 = WARN → surface to human for approval before ship.

**Gate sequence:** Gate 1 must PASS before running Gate 2. A Gate 1 FAIL is not forwarded to Gate 2.

**CI / no-key environments:** Set `SKIP_LLM_JUDGES=1` to bypass the LLM panel (Gate 2 returns WARN, not BLOCK). Gate 1 always runs. Human review is required before ship when running in CI mode. To enable LLM judges in CI, set `ANTHROPIC_API_KEY` as a GitHub Actions secret and omit `SKIP_LLM_JUDGES`.

**Gemini auth:** `~/.gemini/settings.json` must have a valid auth type. If gemini times out, it is skipped and the ip_safety judge falls back to `claude`. To fix: set `GEMINI_API_KEY` in `~/.claude/settings.json` env section or run `gemini auth login` to switch to OAuth.

## Execution Flow
1. **Pre-flight:** Run Gate 1 (structural) → Gate 2 (semantic) on each content piece. Block on failures.
2. **Act:** Trigger Platform Modules.
3. **Observe:** Modules execute using current algorithmic rules.
4. **Measure:** Hand off to the Distribution Analytics Engine after a window to collect data.
5. **Learn:** Use updated insights for the next campaign.
