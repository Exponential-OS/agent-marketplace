<!-- product-vs-solution: example -->
# Changelog

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
