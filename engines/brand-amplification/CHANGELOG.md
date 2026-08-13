<!-- product-vs-solution: example -->
# Changelog

## [0.59.0] — 2026-08-13 — Reddit pre-post viability (XOS-236)

### Added — offline Reddit viability gate
Added `reddit-prepost-viability`, a deterministic pre-draft and pre-post gate that blocks subreddits with prior removals, blocks targets outside the verified top-50 AI citation index, warns when copy reads as announcing rather than answering, blocks U+2014 em dashes, and warns on U+2013 en dashes. Every result reports all four gates and their inspectable evidence in one JSON object.

### Grounded — anonymous Reddit history fetch is unavailable
Verified on 2026-08-13 that both `www.reddit.com/user/thewhyman007/submitted.json` and `old.reddit.com/user/thewhyman007/submitted.json` return HTTP 403 anonymously. The gate makes no Reddit request; it reads supplied history or the workspace ledger and warns visibly when ledger or research evidence is missing.

## [0.58.0] — 2026-06-30 — DRAFT-safe daily quote cadence (XOS-161)

### Added — once-per-day quote draft surfacing
Added `scripts/daily-cadence.ts`, a deterministic DRAFT-only guard that reads the existing quote flywheel log, stops when a quote already has `drafted_at` on today's calendar day, and otherwise reuses the existing §1-only quote selector/draft run path.

### Added — quote flywheel daily playbook
Extended `quote-flywheel` with a "today's draft" daily mode plus human-gated optional wiring guidance for a once/day SessionStart hook or cron. No global hook is force-wired, and approval remains separate from publishing.

### Added — local-only daily telemetry
Added gated `quote_daily_surfaced` telemetry through the existing BrainTelemetryWriter pattern at `brand-amplification/telemetry/events.jsonl`. Telemetry remains local-only and disabled unless `XOS_98_TELEMETRY` is enabled.

## [0.57.0] — 2026-06-30 — draft-first screenshot cascade planner (XOS-157)

### Added — Substack to LinkedIn to spokes planner
Added `cascade-planner`, a DRAFT-first playbook for planning the screenshot cascade from a provided Substack source: LinkedIn uses the Substack screenshot and puts the Substack URL in the comment only, while X and configured spokes reuse the same screenshot and link one rung up to the LinkedIn post.

### Added — deterministic cascade plan helper
Added `scripts/cascade-plan.ts` to build the staged sequence, dependency order, link-target map, reusable screenshot reference, platform-native drafts, visual-review notes, and confidence ladder without network calls, posting transport, scheduling, or screenshot capture.

### Added — guardrail coverage
Added hermetic Bun tests for the LinkedIn-comment-to-Substack and spoke-to-LinkedIn link map, LinkedIn-before-spokes dependency ordering, one-screenshot reuse, DRAFT-only guardrails, and plain-text no-pipe rendering.

## [0.56.0] — 2026-06-30 — quote-a-day draft flywheel (XOS-153)

### Added — Naval quote-a-day flywheel
Added `quote-flywheel`, a DRAFT-first playbook that selects one §1-only quote from the cyborg quote deck, drafts a LinkedIn-native post, runs framing gates, and presents the copy for explicit approval. The MVP excludes harvest and screenshot cascades.

### Added — deterministic §1 selector, local log, and graduation helper
Added `scripts/quote-selector.ts` with configurable deck/log paths, least-recently-used rotation, 30-day default dedup, safe missing-deck skips, local JSONL draft/approval records, and a 10-approved-run graduation eligibility helper. The parser stops at the next safety-gate heading so §2 HOLD and §3 BORROWED quotes never enter the candidate set.

### Fixed — fail-closed quote deck safety boundary
Hardened the §1-only selector so drafts require a recognized §2 HOLD/patent boundary after §1, fail closed on headingless protected-section bleed, and block protected quote text across smart-quote and punctuation variants.

### Added — local-only quote telemetry
Added gated `quote_drafted` and `quote_approved` telemetry helpers that reuse the existing BAE local JSONL pattern through `brain.read()` + `brain.write()` only when `XOS_98_TELEMETRY` is enabled. No network transport or auto-post transport is introduced.

## [0.55.0] — 2026-06-28 — post-algorithm relevance reset (XOS-99)

### Added — Relevance Gate for campaign strategy
campaign-engine now gates campaigns on `relevance_score >= 70` before drafting/distribution, using the content-flywheel Post-Algorithm Reset rubric: topic-audience fit, audience specificity, and signal-over-vanity intent. Below-threshold campaigns return the largest gap plus a sharpening suggestion and do not advance.

### Added — local-only content strategy event
The Relevance Gate records `content_strategy_applied` JSONL only through `brain.write("brand-amplification/telemetry/events.jsonl", ...)`, and only when `XOS_98_TELEMETRY` is enabled. The telemetry namespace is declared in plugin metadata and brain-kernel bootstrap ACL.

### Changed — relevance over volume in the content flywheel
Added the March 2026 Post-Algorithm Reset section: fewer, sharper posts for named audiences beat volume, with engagement quality tracked as `DMs / likes`. Existing velocity guidance is preserved but reframed as a distribution input inside the right audience.

## [0.54.0] — 2026-06-09 — cleanup: dead handlers, brand rename, schema fix (XOS-9)

### Removed — 19 dead handler.ts files (P4 / signal-pollution)
All 19 rules/*/handler.ts were dead code — nothing referenced them (HOW.py is the canonical tier). Deleted (~4500 lines).

### Fixed — campaign-engine producer/consumer schema mismatch
campaign-engine now writes the canonical machine-readable campaign.json to brand-amplification/campaigns/initiatives/<initiative>/campaigns/<campaign>/campaign.json — the exact nested path campaign-dashboard reads. Previously it wrote a flat master.md the dashboard never read.

### Changed — brand rename SDE/"Career OS" → Brand Amplification / BAE
Status-line headers, abbreviations, and gate namespace references updated from the pre-2026-05-17 "social-distribution-engine"/"SDE" branding to BAE. Preserved: the literal social-distribution-engine skill/dir identifiers, and legitimate cross-plugin references to career-intelligence (e.g. the social-content-readiness-check gate). De-hardcoded golden-hour's gate-position comment.

### Note
The full flat workspace path migration (~25 files still using legacy-prefixed paths) is tracked as a separate ticket — out of scope here. Those gates are advisory-WARN; no behavior regression.

<!-- Note: 0.48.0–0.51.0 entries were not recorded at ship time (XOS-9). See git log for those commits. -->

## [0.53.0] — 2026-06-09 — gate coverage for IG/Threads/FB + fix post-publish tracker path (XOS-8)

### Fixed — Instagram / Threads / Facebook had ZERO gate coverage
Wired the `social-content-readiness-check` publish gate (tone/IP-firewall/clarity LLM judges) into instagram/threads/facebook distribution modules, mirroring the social-distribution-engine pattern. Gate lives in career-intelligence (cross-plugin call). Closes a CAMPAIGN-COMPLETENESS hole — these surfaces previously published with no structural validation.

### Fixed — post-publish campaign tracker silently dropped every URL (XOS-8)
hooks/scripts/postpublish-campaign-tracker.py had a CAMPAIGN_TRACKER path that appended a bogus "aiprojects/career-os-plugin/..." segment to the plugin root → resolved to a nonexistent path → every LinkedIn/Reddit post-publish URL-track silently dropped (fail-open exit 0). Now plugin-root-relative ($CLAUDE_PLUGIN_ROOT, else derived from script location).

## [0.52.0] — 2026-06-09 — fix stale post-extract gate globs (XOS-7, CRITICAL)

### Fixed — every per-content gate was silently skipping (campaigns shipped UNVALIDATED)
After the v0.47.0 extract from career-intelligence, BAE skills still globbed
`~/.claude/plugins/cache/xos/career-intelligence/*/...` for gates and scripts that had
MOVED into this plugin (`brand-amplification/*`). `ls -v … | tail -1` returned empty →
`python3 ""` / empty `GATE=` → the gate **silently skipped**, while the skills claimed
9–10 gates fire (CAMPAIGN-COMPLETENESS violation class). Net effect: campaigns shipped
with ZERO structural gate validation.

Repointed all stale globs `career-intelligence` → `brand-amplification` across
social-distribution-engine, linkedin-distribution-module, linkedin-groups-distribution-module,
substack-distribution-module, distribution-analytics-engine, campaign-dashboard,
brand-onboarding. Verified every fixed `ls -v … | tail -1` resolves to a real file in the
installed cache (13 gates/scripts).

**Two refs intentionally preserved / specially handled:**
- `social-content-readiness-check` (social-distribution-engine SKILL.md) stays at
  `career-intelligence` — that gate legitimately lives there (cross-plugin call). Verified
  it still resolves.
- hijack-playbook was a double-error (wrong plugin AND wrong subdir) → corrected to
  `brand-amplification/*/skills/social-distribution-engine/hijack-playbook.md`.

### Note
CHANGELOG has a gap (0.48–0.51 entries missing — tracked under XOS-9). This 0.52.0 ship
also carries the previously-unshipped 0.51.0 (brain-kernel API migration + BAE rename),
since marketplace/cache were still at 0.50.0.

## [0.47.0] — 2026-05-17 — initial extract from career-intelligence-engine v0.61.0

### Provenance
Extracted to honor the xOS-vs-xHumanOS platform split per the WIP design doc at `WIP/xOS-platform/social-distribution-product/NEXT_SESSION_HANDOFF.md`. Plugin now lives at its proper xOS scope; xTeamOS + xFamilyOS can reuse it once they ship.

### Contents at extract time
- 14 skills (master + planner + dashboard + analytics + amplification + 7 platform modules + sde-onboarding temp)
- 20 rules (9 preflight gates + 5 platform publish gates + 6 supporting gates)
- 9-gate preflight CI flow intact (campaign-schema → channel-status → surface-coverage → content-url → flywheel-sequence → visual-asset → golden-hour → estate-quality → cta-quality)
- Initiative → Campaign → Spoke hierarchy (initiative.schema.json + initiative.template.json + campaign-dashboard)

### Removed from career-intelligence-engine v0.62.0
All 14 skills + 20 rules removed from the career plugin. Mission-control routing still works via skill-name reference; the social-distribution plugin must be installed alongside career-intelligence for those routes to resolve. Both plugins share `$CAREER_HOME` env.

### Known follow-ups (v0.48.0+)
- `sde-onboarding` → rename to `persona-onboarding`, output JSON instead of MD, add Co-Dialectic persona roster as Phase 0. Then extract to brand-intelligence plugin (still bundled here for now).
- LinkedIn Groups discovery + spoke (task #23 in AGENT_STATUS).
- v1 crowdsourced signal aggregation + ghost job detection (task #29).
