<!-- product-vs-solution: example -->
# Changelog

## [0.54.0] — 2026-06-09 — cleanup: dead handlers, brand rename, schema fix (XOS-9)

### Removed — 19 dead handler.ts files (P4 / signal-pollution)
All 19 rules/*/handler.ts were dead code — nothing referenced them (HOW.py is the canonical tier). Deleted (~4500 lines).

### Fixed — campaign-engine producer/consumer schema mismatch
campaign-engine now writes the canonical machine-readable campaign.json to brand-amplification/campaigns/initiatives/<initiative>/campaigns/<campaign>/campaign.json — the exact nested path campaign-dashboard reads. Previously it wrote a flat master.md the dashboard never read.

### Changed — brand rename SDE/"Career OS" → Brand Amplification / BAE
Status-line headers, abbreviations, and gate namespace references updated from the pre-2026-05-17 "social-distribution-engine"/"SDE" branding to BAE. Preserved: the literal social-distribution-engine skill/dir identifiers, and legitimate cross-plugin references to career-intelligence (e.g. the social-content-readiness-check gate). De-hardcoded golden-hour's gate-position comment.

### Note
The full brain/→flat path migration (~25 files still using brain/-prefixed paths) is tracked as a separate ticket — out of scope here. Those gates are advisory-WARN; no behavior regression.

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
