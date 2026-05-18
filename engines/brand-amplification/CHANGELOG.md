<!-- product-vs-solution: example -->
# Changelog

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
