<!-- product-vs-solution: example -->
<!-- this file is the historical changelog. Entries reference the original author/user as provenance, not runtime data. -->
# Changelog

## [0.71.0] — 2026-06-08 — claim-grounding gate + off-rubric risk scan (XOS-34, XOS-35)

### Fixed — resume-engine could fabricate metrics and self-attest "PASS" (XOS-34, HIGH)
The XOS-11 eval loop found resume-engine UNDERPERFORMED the no-skill baseline on
canonical grounding (76% vs 94%). Two compounding defects:
- The quantification gate ("every bullet needs a metric") pressured the model into
  inventing figures (`60% overhead`, `$1.1M savings`, a 4→5 promotion inflation),
  and JD-bleed planted the employer's `50M events/sec` into the candidate's bio.
- The **self-attested** canonical-claim gate printed "PASS — no fabrication" over
  those very fabrications in 3 separate runs. A self-attested LLM gate is not a gate.

Fix: resume-engine SKILL.md now runs `biographical-claim-precheck` against the FINAL
rendered draft and reads its **exit code** (no self-attestation); canonical sources =
experience-history + skills-matrix + stories, **never the JD**. Quantification gate
reworded so a true unquantified bullet beats an invented metric.

### Fixed — biographical-claim-precheck couldn't see the fabrications (HOW.py + handler.ts, in parity)
The gate previously only matched `$`-prefixed scale and `engineer`-suffixed counts, so
`%`, bare scale (`50M`/`180k`/`1M TPS`), and `N+` counts slipped through. Now:
- value-normalized token set (`1M`=`1,000,000`; `2.3k`=`2,300`); every numeric token
  in a claim must anchor (was first-number-only); lookbehind excludes letter-glued
  identifiers (`P99`/`H100`) and never splits a multi-digit number; unit must be glued
  and not begin a word (`7 months` ≠ `7M`); `N+ years` career-totals exempt;
  case-insensitive scale.

### Added — job-match-scorer Off-Rubric Risk Scan (XOS-35)
After the 6-category score and before the decision: scan for employment gaps,
over-qualification, title-scope mismatch, and hard-constraint conflicts the rubric
never sees. New match-tracker field `off_rubric_risks`. A 95% rubric score can still
die at recruiter screen.

### Tests
- `tests/test_biographical_claim_precheck.py` (pytest, 8) + `tests/biographical-claim-precheck.test.ts` (bun, 9).
- Verified against XOS-11 eval outputs: clean baselines PASS, all fabricating drafts BLOCK; HOW.py ≡ handler.ts.

## [0.70.0] — 2026-06-08 — v0.66 flat-path sweep completion + flags-gate safety (XOS-26)

### Fixed — the core career-OS data-path incoherence (C-1 + H-1 + M-1 + H-3)
The v0.66 migration moved job-search data to `career-intelligence/projects/job-search/`
(stripped `brain/`, kept the subpath) but skill/script references were left split
across THREE names. Verified ground truth (2026-06-08): live data is
`career-intelligence/projects/job-search/{job-pipeline.json 10KB, job-pipeline-match-tracker.json 113KB}`;
13/16 refs + the company-flags.json precedent all point there. The flat
`career-intelligence/{pipeline,match-tracker}.json` writer paths were phantom —
**the scorer was writing scores to a file nothing reads (C-1)**.

- Swept 19 skills/scripts to canonical `career-intelligence/projects/job-search/`
  (zero data migration — everything now points at the existing live files)
- C-1: job-match-scorer write/read → canonical (scores now land where dashboard/sync read)
- H-1: 15 legacy `brain/projects/job-search/` readers repointed
- M-1: apply-tracker dual-write unified
- H-3: company-flags-filter FAIL-HARD on missing flags file + flat path (was silent pass-all → do_not_apply leak)
- **New CI guard (Suite 1b):** grep-zero gate blocks any future flat/`brain/` path reference
- Verified: hermetic CI green (hooks 17 baseline, outreach-dedup, mission-control 57/0) + Suite 1b clean

## [0.69.0] — 2026-06-07 — init-repo scoped commit + CI gate repair (XOS-28 + XOS-33)

### Fixed — CI deploy gate was red+bypassed for two releases (XOS-33)
`tests/run-all.sh` never actually gated: `set -e` aborted it at Suite 1 the
moment `test-hooks.sh` returned nonzero (which it does on ANY failure), so it
crashed silently instead of applying the baseline — v0.67 and v0.68 both shipped
past a "green" gate that wasn't running. Compounding it, the failure counter used
`grep -c FAIL` (counted assertion-detail lines: 138 for ~68 real fails). Fixes:
(a) `|| true` on the test-hooks capture so the baseline check runs; (b) count the
authoritative `=== Results: N failed ===` line; (c) the v0.67 workspace-identity
gate silently no-op'd init-repo/capture in throwaway test dirs — added a
`ws_mark` helper dropping the `.career-os-workspace` sentinel in each test
workspace, restoring 51 spuriously-failing tests (68→17). Baseline set to the
honest 17 (5 genuine findings → XOS-30/31; 12 deeper harness-debt → XOS-33
follow-on), ratcheting down as each lands. The gate now enforces — an 18th
failure trips it.



### Fixed — the third sister script finally gets the v0.66 isolation fix
`hooks/scripts/init-repo.sh` SessionStart commit was UNSCOPED — `git commit -m
"session-start: …"` with no `-- <paths>` pathspec, then push. Any files a
concurrent agent left staged got swept into the session-start commit and pushed
— the same multi-agent index-sweep data-loss class that ate a deliberate commit
on 2026-06-04. v0.66.0 fixed this in the two sister scripts (capture-prompt.sh,
capture-response.sh) but missed init-repo.sh — and v0.67 back-ported only the
workspace-identity gate, not the scoped commit. Now builds a COMMIT_PATHS
pathspec of existing paths and runs `git commit … -- "${COMMIT_PATHS[@]}"`,
mirroring the sisters. Verified: cross-family judge clean (no path coupling),
test suite parity 140/68.

NOTE: the flags-gate FAIL-HARD + flat-path safety fixes (XOS-26/27, also
verified) are NOT in this release — a cross-family judge proved they're coupled
to the C-1 match-tracker rename and must ship coherently with the full v0.66
flat-path sweep. They live on branch feat/v0.69.0-review-fixes pending XOS-26.

## [0.68.0] — 2026-06-04 — Session-logger improvements (Task #67)

### Root cause fix: capture-response.sh was capturing ZERO responses
Claude Code's Stop-hook payload stopped carrying inline response text (shape is
`{stop_hook_active, session_id, transcript_path, hook_event_name}`). The Python
parser only checked `response`/`message.content`/`content` keys — none present →
`RESPONSE_TEXT` was always empty → exit-before-ledger-write. Verified: 30 prompt
commits / 0 response commits across all of 2026-06-04 before fix.

Fix: parser now reads `transcript_path` (a JSONL file Claude Code provides in the
Stop payload), finds the last non-sidechain assistant message, extracts its text.
Falls back to a glob-search by `session_id` if `transcript_path` is absent.

### Root cause fix: zombie plugin double-fired every hook
A stale v0.29.0 copy of the plugin in the workspace's `.claude/skills/career-os-plugin/`
directory (with a `.claude-plugin/plugin.json`) was being loaded by Claude Code
~v2.1.15x as a live second plugin source. Result: every UserPromptSubmit and Stop
event fired BOTH the v0.67.0 HOOK_PATHS-scoped hook AND the v0.29.0 UNSCOPED hook.
The v0.29.0 hook used `git commit` without `-- <paths>`, sweeping the entire staged
index. This is why agent-deliberate commits (like `status: Mercury...`) were
silently overwritten by session-log commits — the zombie hook re-committed the index.
The zombie has been deleted from the workspace (2026-06-04).

### Changes
- `capture-response.sh`: transcript_path JSONL parser (reads last main-chain
  assistant message; skips sidechain/subagent entries)
- `capture-prompt.sh` + `capture-response.sh`: `co-dialectic/` added to
  HOOK_PATHS (brain-kernel codi state auto-committed; silences unit-of-work noise)
- Both hooks: commit messages now include file count + path preview
  (`session-log: prompt 2026-06-04 11:21 — 2 files (brain/sessions/ledger/...,WIP/...)`)
- Both hooks: `[DEBUG]` forensic line written to git-errors.log on every fire
  (branch + pre_hook_staged + hook_paths count)
- Both hooks: skip commit + push when HOOK_PATHS has zero staged changes (eliminates
  empty-commit error noise in git-errors.log)
- New migration scripts: `v0.66.0-to-v0.67.0.sh` + `v0.67.0-to-v0.68.0.sh`
  (gap-filling; no schema changes)

### Tests added
- `[V1]` commit message includes file count + path preview
- `[V2]` no commit on empty Stop payload
- `[V3]` transcript_path parsing — full round-trip
- `[V4]` co-dialectic/ committed when present
- `[V5]` DEBUG line appears in git-errors.log
- `[V6]` sidechain assistant messages NOT captured (main-chain only)

## [0.62.0] — 2026-05-17 — SPLIT: social-distribution extracted to its own xOS plugin

### The architectural split
career-intelligence was bundling social-distribution as a sub-skill since v0.30+. That violated the xOS-vs-xHumanOS platform boundary documented in WIP/xOS-platform/social-distribution-product/. Social-distribution is xOS-shared (used by xHumanOS for individual brand + xTeamOS for team brand + xFamilyOS for family brand). Career-intelligence is xHumanOS-only.

This release executes the split. The two plugins now ship independently and share $CAREER_HOME env.

### Removed (moved to social-distribution@xos)
- 14 skills: social-distribution-engine, campaign-engine, campaign-dashboard, distribution-analytics-engine, flywheel-amplification-module, 7 platform modules (linkedin, linkedin-groups, substack, x, reddit, facebook, instagram, threads), sde-onboarding (temp — will move to brand-intelligence@xos later)
- 20 rules: 9 preflight gates (campaign-schema-validator, channel-status-check, surface-coverage-check, content-url-resolution-check, flywheel-sequence-guard, visual-asset-review-check, golden-hour-scheduling-check, campaign-estate-quality-check, flywheel-cta-quality-check) + 5 publish gates (substack, linkedin-article, linkedin-post-on-article, x-cta-resolution, comment-hijack) + 6 supporting (campaign-preflight, campaign-asset-matrix-gate, image-brand-completeness-gate, image-overflow-detection-gate, linkedin-groups-dedup, analytics-sync-watch)
- 2 hook scripts: postpublish-campaign-tracker.py, preflight-linkedin-mcp-prefer.py
- 2 hook registry entries (PreToolUse + PostToolUse) — social-distribution plugin re-registers them via its own hooks.json

### Retained in career-intelligence@xos
- 23 skills (job search, pipeline, outreach, resume, network, story, interview, mission-control, etc.)
- 8 rules (biographical-claim-precheck, company-flags-filter, content-format-check, linkedin-mention-gate, outreach-people-file-commit, social-content-readiness-check, warm-contact-outreach-dedup, campaign-asset-matrix-gate)
- SessionStart hook (init-repo + audit-people-schema)

### Customer install impact
Existing customers must install BOTH plugins to keep their current behavior:
  claude plugin install career-intelligence@xos
  claude plugin install social-distribution@xos

mission-control routing references the social-distribution skill names (campaigns, new-initiative, new-campaign, measure, campaign-engine). If only career-intelligence is installed, those routes will WARN but not fail.

## [0.61.0] — 2026-05-17 — product-vs-solution sweep — Anand-personal data removed

Goal of this release: career-intelligence is a PRODUCT that ships to customers; Anand's personal data must not leak into runtime code. Customer-specific data (brand-spec, identity, handles, content-flywheel, brand-patterns, hijack-playbook) lives in the customer's `$CAREER_HOME/brain/`. The plugin reads from there.

### Removed (Anand-personal contamination)
- **`skills/social-distribution-engine/brand-spec.json` deleted from plugin.** Replaced by `brand-spec.template.json` (placeholders for onboarding to fill in). Anand's actual brand-spec moved to `~/anand-career-os/brain/social-distribution-engine/brand-spec.json`.
- **`validate-campaign-preflight.py` + `signal-collector.py`**: `CAREER_HOME=~/anand-career-os` fallback removed. Both now fail-hard with remediation if env var unset.
- **`outreach-fact-check/example-verdict-*.json` (4 files)**: hardcoded `~/anand-career-os/...` canonical_source paths → `$CAREER_HOME/...` literal; subject names → "Jane Smith"; sample claims → generic ("5 years at Acme Corp").
- **`pipeline-view/SKILL.md`**: removed `~/anand-career-os` default-path doc; now requires `$CAREER_HOME` set.
- **`linkedin-article-publish-gate/check.py` + `handler.ts`**: hardcoded `thewhyman.blog` pattern → `HONEY_POT_DOMAIN` loaded at runtime from `$CAREER_HOME/brain/social-distribution-engine/brand-spec.json` (falls back to `substack.com`).
- **`scripts/pipeline-view.py` + `pipeline-query.py`**: argparse default for `--career-home` now reads env var (no Anand fallback).
- **15 rule scripts** (analytics-sync-watch, biographical-claim-precheck, channel-status-check, content-url-resolution-check, image-brand-completeness-gate, linkedin-groups-dedup, outreach-people-file-commit, surface-coverage-check, warm-contact-outreach-dedup, others): `CAREER_HOME` fallbacks removed; fail-hard pattern applied uniformly.
- **Plugin filesystem**: session ledgers (`brain/sessions/ledger/*.md` + nested) moved out of the plugin dir to `~/anand-career-os/brain/sessions/ledger/`. The plugin no longer carries any user transcripts on disk.

### Genericized (no longer Anand-specific)
- **`skills/social-distribution-engine/content-flywheel.md`** — Anand's hub/honey-pot platform names → `{{HUB_PLATFORM}}` / `your-honey-pot.com` placeholders. Reads customer config from `$CAREER_HOME/brain/social-distribution-engine/`.
- **`skills/social-distribution-engine/brand-patterns.md`** — Track 3 targets (AI Fund, A16Z), Track 1 targets (Anthropic, Scale), biographical anchors, velocity numbers all removed. Anand's specifics moved to `~/anand-career-os/brain/social-distribution-engine/brand-patterns.md`.
- **`skills/social-distribution-engine/hijack-playbook.md`** — live URL `x.com/thewhyman/status/...` removed; replaced with generic placeholder. Anand's hijack log moved to `~/anand-career-os/brain/social-distribution-engine/hijack-examples.md`.
- **`skills/social-distribution-engine/platforms.json`** — `#TheWhyMan` hashtag → `{{PERSONAL_BRAND_HASHTAG}}` placeholder; "Anand's ICP" → "your ICP".
- **`skills/sde-onboarding/SKILL.md`** — Q1 example "Anand Vallamsetla / The Why Man" → "Alex Chen / The Product Strategist".
- **`skills/outreach-fact-check/SKILL.md`** — "Anand's career" subject → "the user's career"; xHumanOS attribution updated.
- **`skills/network-intelligence/SKILL.md`** — YAML example values genericized.

### Added (new product surfaces)
- **`skills/campaign-dashboard/`** — NEW. Social-distribution home screen for SDE customers. Shows INITIATIVES → CAMPAIGNS → SPOKES with status rollups and stale-campaign alerts. Routes writes to `campaign-engine`/`social-distribution-engine`/`distribution-analytics-engine`. Read-only by design.
- **`skills/social-distribution-engine/campaign-schema/initiative.schema.json`** — NEW. Defines INITIATIVE as the parent of campaigns: strategic theme + audience + outcome goals + time horizon + member campaigns + KPI rollup.
- **`skills/social-distribution-engine/campaign-schema/initiative.template.json`** — NEW. Skeleton with `{{PLACEHOLDERS}}` for onboarding flow to fill in.
- **`campaign.schema.json`** — added `meta.initiative_id` field (replaces deprecated `series`/`series_part`).
- **`mission-control/SKILL.md`** — added SOCIAL DISTRIBUTION dashboard section + 5 new routing entries (campaigns, new-initiative, new-campaign, measure, campaign-engine).

### Exempted (provenance / authorship — acceptable Anand references)
Added `product-vs-solution: example` markers (preserves Anand-as-origin commentary without triggering BLOCK):
- `CHANGELOG.md` — historical changelog (37 provenance entries)
- `CLAUDE.md` — project rules (11 provenance refs)
- `docs/MEMORY-ACCESS.md` — memory spec (39 provenance refs)
- `migrations/*.sh` (34 files) — one-time historical migration scripts
- `migrations/_archive/ci-local-dolt-2026-04-25.sh` — archived dev script
- `rules/biographical-claim-precheck/README.md` — rule purpose intrinsically references Anand as worked-example user
- `rules/flywheel-cta-quality-check/PROMPT.md` — semantic gate prompt
- `tests/test_outreach_dedup.py` — test fixture with synthetic personal data
- `skills/job-search-scheduler/scan-prompt-v11.md` — prompt template
- 3 rule manifests (biographical-claim-precheck, channel-status-check, surface-coverage-check) — origin field references Anand-incident provenance
- `.claude-plugin/plugin.json` — author attribution is legitimate (Anand authored the plugin)

### Verification
- Product-vs-solution gate scan: **360 BLOCK hits before → 0 BLOCK hits after** (3 WARN-only remain — all in comment-only contexts).
- Test suites: 57/57 mission-control PASS, 16/16 outreach-dedup PASS.


All notable changes to the Career OS plugin are recorded here. This plugin
follows [Semantic Versioning](https://semver.org/) — MAJOR.MINOR.PATCH.

## [0.61.0] — 2026-05-17 — product-vs-solution sweep — Anand-personal data removed

Goal of this release: career-intelligence is a PRODUCT that ships to customers; Anand's personal data must not leak into runtime code. Customer-specific data (brand-spec, identity, handles, content-flywheel, brand-patterns, hijack-playbook) lives in the customer's `$CAREER_HOME/brain/`. The plugin reads from there.

### Removed (Anand-personal contamination)
- **`skills/social-distribution-engine/brand-spec.json` deleted from plugin.** Replaced by `brand-spec.template.json` (placeholders for onboarding to fill in). Anand's actual brand-spec moved to `~/anand-career-os/brain/social-distribution-engine/brand-spec.json`.
- **`validate-campaign-preflight.py` + `signal-collector.py`**: `CAREER_HOME=~/anand-career-os` fallback removed. Both now fail-hard with remediation if env var unset.
- **`outreach-fact-check/example-verdict-*.json` (4 files)**: hardcoded `~/anand-career-os/...` canonical_source paths → `$CAREER_HOME/...` literal; subject names → "Jane Smith"; sample claims → generic ("5 years at Acme Corp").
- **`pipeline-view/SKILL.md`**: removed `~/anand-career-os` default-path doc; now requires `$CAREER_HOME` set.
- **`linkedin-article-publish-gate/check.py` + `handler.ts`**: hardcoded `thewhyman.blog` pattern → `HONEY_POT_DOMAIN` loaded at runtime from `$CAREER_HOME/brain/social-distribution-engine/brand-spec.json` (falls back to `substack.com`).
- **`scripts/pipeline-view.py` + `pipeline-query.py`**: argparse default for `--career-home` now reads env var (no Anand fallback).
- **15 rule scripts** (analytics-sync-watch, biographical-claim-precheck, channel-status-check, content-url-resolution-check, image-brand-completeness-gate, linkedin-groups-dedup, outreach-people-file-commit, surface-coverage-check, warm-contact-outreach-dedup, others): `CAREER_HOME` fallbacks removed; fail-hard pattern applied uniformly.
- **Plugin filesystem**: session ledgers (`brain/sessions/ledger/*.md` + nested) moved out of the plugin dir to `~/anand-career-os/brain/sessions/ledger/`. The plugin no longer carries any user transcripts on disk.

### Genericized (no longer Anand-specific)
- **`skills/social-distribution-engine/content-flywheel.md`** — Anand's hub/honey-pot platform names → `{{HUB_PLATFORM}}` / `your-honey-pot.com` placeholders. Reads customer config from `$CAREER_HOME/brain/social-distribution-engine/`.
- **`skills/social-distribution-engine/brand-patterns.md`** — Track 3 targets (AI Fund, A16Z), Track 1 targets (Anthropic, Scale), biographical anchors, velocity numbers all removed. Anand's specifics moved to `~/anand-career-os/brain/social-distribution-engine/brand-patterns.md`.
- **`skills/social-distribution-engine/hijack-playbook.md`** — live URL `x.com/thewhyman/status/...` removed; replaced with generic placeholder. Anand's hijack log moved to `~/anand-career-os/brain/social-distribution-engine/hijack-examples.md`.
- **`skills/social-distribution-engine/platforms.json`** — `#TheWhyMan` hashtag → `{{PERSONAL_BRAND_HASHTAG}}` placeholder; "Anand's ICP" → "your ICP".
- **`skills/sde-onboarding/SKILL.md`** — Q1 example "Anand Vallamsetla / The Why Man" → "Alex Chen / The Product Strategist".
- **`skills/outreach-fact-check/SKILL.md`** — "Anand's career" subject → "the user's career"; xHumanOS attribution updated.
- **`skills/network-intelligence/SKILL.md`** — YAML example values genericized.

### Added (new product surfaces)
- **`skills/campaign-dashboard/`** — NEW. Social-distribution home screen for SDE customers. Shows INITIATIVES → CAMPAIGNS → SPOKES with status rollups and stale-campaign alerts. Routes writes to `campaign-engine`/`social-distribution-engine`/`distribution-analytics-engine`. Read-only by design.
- **`skills/social-distribution-engine/campaign-schema/initiative.schema.json`** — NEW. Defines INITIATIVE as the parent of campaigns: strategic theme + audience + outcome goals + time horizon + member campaigns + KPI rollup.
- **`skills/social-distribution-engine/campaign-schema/initiative.template.json`** — NEW. Skeleton with `{{PLACEHOLDERS}}` for onboarding flow to fill in.
- **`campaign.schema.json`** — added `meta.initiative_id` field (replaces deprecated `series`/`series_part`).
- **`mission-control/SKILL.md`** — added SOCIAL DISTRIBUTION dashboard section + 5 new routing entries (campaigns, new-initiative, new-campaign, measure, campaign-engine).

### Exempted (provenance / authorship — acceptable Anand references)
Added `product-vs-solution: example` markers (preserves Anand-as-origin commentary without triggering BLOCK):
- `CHANGELOG.md` — historical changelog (37 provenance entries)
- `CLAUDE.md` — project rules (11 provenance refs)
- `docs/MEMORY-ACCESS.md` — memory spec (39 provenance refs)
- `migrations/*.sh` (34 files) — one-time historical migration scripts
- `migrations/_archive/ci-local-dolt-2026-04-25.sh` — archived dev script
- `rules/biographical-claim-precheck/README.md` — rule purpose intrinsically references Anand as worked-example user
- `rules/flywheel-cta-quality-check/PROMPT.md` — semantic gate prompt
- `tests/test_outreach_dedup.py` — test fixture with synthetic personal data
- `skills/job-search-scheduler/scan-prompt-v11.md` — prompt template
- 3 rule manifests (biographical-claim-precheck, channel-status-check, surface-coverage-check) — origin field references Anand-incident provenance
- `.claude-plugin/plugin.json` — author attribution is legitimate (Anand authored the plugin)

### Verification
- Product-vs-solution gate scan: **360 BLOCK hits before → 0 BLOCK hits after** (3 WARN-only remain — all in comment-only contexts).
- Test suites: 57/57 mission-control PASS, 16/16 outreach-dedup PASS.

## [0.60.0] — 2026-05-17 — privacy hardening + product-vs-solution gate wiring

### Removed (privacy)
- 9 session-ledger files removed from git tracking (`brain/sessions/ledger/2026-05-04..14.md` + `.github/workflows/brain/...`). Were force-added before `.gitignore` covered `brain/sessions/`. These contain real user conversation transcripts — should never have been in version control. Files remain on local disk (gitignored).

### Wired (gate)
- Cyborg's new `product-vs-solution-gate` (Ground Zero invariant) fires on every commit to this repo. It scans staged files for Anand-personal data (names, emails, phone, hardcoded paths) and BLOCKs runtime contamination. Comments referencing Anand as origin/example are WARN, not BLOCK.

### Known contamination (punch-list for v0.61+)
Per scan run by `product-vs-solution-gate` on this repo (305 files scanned, 70 BLOCK files found):

P0 — runtime code (customer hits these):
- `skills/social-distribution-engine/brand-spec.json` (15 hits): personal_name, social_handle baked in. Must move to `$CAREER_HOME/brain/identity/brand-spec.json`, plugin reads via env var.
- `skills/social-distribution-engine/validate-campaign-preflight.py` + `signal-collector.py`: `CAREER_HOME` defaults to `~/anand-career-os` — remove the personal fallback, require env var.
- `skills/outreach-fact-check/example-verdict-*.json` (4 files): hardcoded canonical_source path. Parameterize.
- `skills/pipeline-view/SKILL.md`: documents `$CAREER_HOME` default as `~/anand-career-os` — say "must be set" instead.

P1 — onboarding (first customer touch):
- `skills/sde-onboarding/SKILL.md`: Q1 example uses "Anand Vallamsetla / The Why Man" — replace with generic.
- `skills/outreach-fact-check/SKILL.md`: prose uses "Anand" as the implied user throughout — replace with "the user".

P2 — strategy docs (Anand-personal but live in product):
- `skills/social-distribution-engine/content-flywheel.md` (76 hits)
- `skills/social-distribution-engine/brand-patterns.md` (14 hits)
- `skills/social-distribution-engine/hijack-playbook.md` (5 hits)
These are Anand's content strategy. Decision needed: (a) extract templates + ship product-only, OR (b) mark as `<!-- product-vs-solution: example -->` if the worked-example framing is acceptable to ship.

P3 — docs:
- `CHANGELOG.md` (37 hits), `CLAUDE.md` (11 hits), `docs/MEMORY-ACCESS.md` (39 hits): mention Anand in worked examples. Acceptable but mark with exemption.

### Mission control + initiative hierarchy (product gaps, not contamination)
- `mission-control` quick-actions has no SDE/campaign entry — social-distribution customers have no natural entry point.
- No INITIATIVE → CAMPAIGN hierarchy (everything is flat). Per user 2026-05-17: "is mission control the central for both career intelligence or is there something else for social intelligence to show campaigns (initiatives — that contain multiple campaigns?) and their status?" — design decision pending.

## [0.59.0] — 2026-05-16 — absorb cyborg product-generic hooks into the plugin

### Added
- `hooks/scripts/audit-people-schema.py` — SessionStart hook, validates required schema fields on recently-active contacts.
- `hooks.json` — registers `audit-people-schema.py`, `preflight-linkedin-mcp-prefer.py` (PreToolUse on chrome-devtools-mcp), and `postpublish-campaign-tracker.py` (PostToolUse on LinkedIn/Reddit publishers) via `${CLAUDE_PLUGIN_ROOT}`.

### Changed
- These three hooks previously lived in `~/cyborg/scripts/` and were wired via `~/.claude/settings.json` absolute paths. They are product-generic (LinkedIn URL routing, campaign-tracker schema, people-file schema audit) — they belong with the product plugin that ships to customers, not in Anand's personal cyborg infrastructure.

### Cyborg cleanup (separate commit in cyborg repo)
- `~/cyborg/scripts/audit-people-schema.py` — removed
- `~/cyborg/scripts/preflight-linkedin-mcp-prefer.py` — removed (was a duplicate)
- `~/cyborg/scripts/postpublish-campaign-tracker.py` — removed (was a duplicate)
- `~/.claude/settings.json` — 3 hook entries removed (plugin owns them now)

## [0.58.0] — 2026-05-15 — gate harness fixes: cover_image, attribution, hashtags, is_reshare

### Fixed
- `substack-publish-gate`: `cover_image` absent on email send now BLOCKs (was unchecked); `tags` missing/fewer than 2 now BLOCKs (was WARN-only exit 2, silently passed). Root cause: WARN exit code treated as proceed by skill invocation spec.
- `linkedin-article-publish-gate`: added `cover_image` BLOCK (Gate 1); added `source_attribution` BLOCK (Gate 3) — checks first 800 chars for "adaptation of" / "originally published" / source URL; added `hashtags` BLOCK (Gate 4) — minimum 3 required, detected from content or explicit field; fixed Gate 2 (backlink_check) early-exit bug — previously exited 2 (WARN) before reaching cta_check and quality gates; accumulated WARNs now returned only after all BLOCKs clear.
- `linkedin-post-on-article-gate`: added `is_reshare` BLOCK as Gate 0 — hub posts must be reshares of the LinkedIn Article (Repost flow), not standalone UGC posts. Previously gate checked body formatting but never verified post type.

## [0.57.0] — 2026-05-15 — P4 three-layer architecture: all 26 Invariant rules migrated to TypeScript+Bun

### Added
- `rules/*/handler.ts` (5 new): biographical-claim-precheck, flywheel-cta-quality-check, campaign-estate-quality-check, golden-hour-scheduling-check, social-content-readiness-check — completing the full 26-rule TypeScript+Bun migration
- All 26 Invariant layer rules now have handler.ts alongside HOW.py; no new HOW.py files created
- social-content-readiness-check handler: 3 parallel LLM judges (tone/ip_safety/narrative via claude/gemini/codex) + Gate 1 format check + Gate 3 metadata; panel rule enforced (0 BLOCK + ≤1 WARN)
- golden-hour-scheduling-check handler: platform golden windows + bad-day checks via Intl.DateTimeFormat (no zoneinfo dependency); WARN-only gate
- biographical-claim-precheck handler: regex claim extraction (tenure/role/scale/date_range/report_count) + canonical source anchor verification

### CI
- 57/0 passing, 1 at baseline (pre-existing)

---

## [0.56.0] — 2026-05-15 — SDE harness complete: per-content publish gates documented + substack metadata gate

### Added
- `SKILL.md`: Per-Content Publish Gates section — all 4 publish gates (substack-publish-gate, linkedin-article-publish-gate, linkedin-post-on-article-gate, x-cta-resolution-gate) documented with invoke commands, input contracts, and gate summaries
- `substack-publish-gate/check.py`: Gate 4 metadata check — WARNs on missing `section` and missing/insufficient `tags` during email sends; quality LLM judge promoted to Gate 5
- `substack-publish-gate/manifest.json`: Updated gate list to include metadata gate

### Fixed
- `SKILL.md` Pre-Dist gate list corrected to include `image-brand-completeness-gate` (was in harness but missing from description)
- Execution Flow updated to 7 steps (was 5 — missing Per-Content Gate step and per-component approval requirement)

---

## [0.55.0] — 2026-05-14 — Knowledge layer integration: WHY-relative context in outreach

### Added

- **Step 0.5 in outreach-composer**: calls `python3 $CAREER_HOME/brain/assembler.py "<contact>"` after dedup PASS, before channel selection. Loads WHY-relative context bundle — active goal alignment, typed edges, ranked related nodes — so message angle is calibrated to *why this contact matters right now*.
- **Assembler input** added to DATA ARCHITECTURE table in outreach-composer/SKILL.md.
- Graceful degradation: if `brain/assembler.py` not found, step skips silently. Assembler is enrichment, not a hard dependency.

## [0.54.0] — 2026-05-14 — Complete README rewrite + smart first-run + pre-flight checks

### Added

- **Complete README rewrite**: Step-by-step CAREER_HOME setup, first-time install path, all skills with trigger phrases and what they do, common workflows (job search, resume, outreach, stories), directory structure, config reference, troubleshooting FAQ. Designed for new users who have never used the plugin.
- **`mission-control` smart first-run routing**: Fresh installs now get a welcome screen that detects missing `experience-history.md` + `professional-brand.md`, asks job-seeker vs founder/operator, and routes directly to the correct onboarding wizard. Partial-onboarding detection: if one engine is set up but not the other, shows a banner with the missing setup step.
- **`outreach-composer` context pre-flight**: Checks `experience-history.md` exists before any outreach draft. Missing file → BLOCK with "run onboarding first" message instead of hallucinating biographical content.
- **`resume-engine` context pre-flight**: Checks `experience-history.md` exists. Missing → BLOCK.
- **`social-distribution-engine` Draft Handoff Gate**: Auto-selects hashtags before handing LinkedIn copy to user; runs Gate 1 (post_validator.py) inline; minimum 3 hashtags enforced.
- **`resume-engine` trigger**: Added `generate my base resume from experience history` to frontmatter triggers list.

### Fixed

- **`outreach-composer` bash→python3 bug**: `bash "$(ls -v...HOW.py)"` invoked a Python script with bash. Fixed to `python3 "$GATE"` with FAIL-HARD empty-path check.
- **brain/ session data excluded from plugin repo**: Session-logger hook was writing session data to `skills/social-distribution-engine/brain/sessions/` inside the plugin repo. Added `skills/*/brain/` and `brain/sessions/` to `.gitignore` and removed tracked files.

---

## [0.53.0] — 2026-05-14 — Gate FAIL-HARD + first-time setup guides + depersonalization

### Fixed

- **FAIL-HARD gate-not-found**: `substack-publish-gate` and `social-content-readiness-check` invocations now BLOCK with an explicit error + reinstall instruction if the gate script path resolves to empty. Previously `python3 ""` exited non-zero but with a confusing "no such file ''" message. Now: `{"verdict":"BLOCK","reason":"...","remediation":"claude plugin update career-intelligence@xos --scope user"}`.
- **Hardcoded "Anand Vallamsetla"** in job-search-scheduler scan report template replaced with dynamic lookup from `brain/identity/experience-history.md → who:` frontmatter.
- **scan-prompt-v11.md depersonalized**: All "Anand's targeting / Anand's capability profile" → "the candidate's targeting / the candidate's capability profile". Resume tracks no longer hardcoded to Engineering Leader/Exec/Innovator — derived from config file, then `Resumes & Cover Letters/` filenames, then experience-history.md fallback.
- **scan-prompt-v11.md ABORT gate**: If `brain/config/job-search.md` doesn't exist, prompt now ABORTs with actionable error instead of attempting a blank-config scan.

### Added

- **`job-search-scheduler` FIRST-TIME SETUP section**: Step-by-step guide covering career-intelligence-onboarding prerequisite, config expansion, resume track setup, and 6 AM cron setup via Claude Code scheduled tasks.
- **`resume-engine` FIRST-TIME SETUP section**: Explains how tracks derive from `Resumes & Cover Letters/` filenames, how to generate an initial base resume from experience-history.md, and how skills-matrix + stories are populated.
- **`mission-control` smart first-run routing**: Fresh installs now get a welcome screen that asks job-seeker vs founder/operator and routes directly to the correct onboarding wizard (`career-intelligence-onboarding` or `sde-onboarding`) instead of an ad-hoc question sequence. Partial-onboarding detection: if one engine is set up but not the other, shows a banner with the missing setup step.
- **Updated README.md**: Complete rewrite with step-by-step setup, skill catalog, stories explanation, resume building guide, LinkedIn profile section, and "what if I skip setup?" FAQ.

---

## [0.52.0] — 2026-05-14 — Career Intelligence onboarding skill

### Added

- **`career-intelligence-onboarding` skill** — Week 1 setup wizard for Career Intelligence. 8-question interview across work history (last 3 roles + key achievements, skills, education) and job search preferences (target roles/levels/company types, location, compensation, hard non-negotiables). Generates 2 context files: `brain/identity/experience-history.md` (loaded by outreach-fact-check for biographical claim verification) and `brain/projects/job-search/job-search-config.md` (loaded by job-match-scorer and mission-control). Includes Phase 0 CAREER_HOME setup, file-exists guard, and smoke test.
- **`experience-history.template.md`** — Generic template with `{{PLACEHOLDER}}` tokens for all user-specific content.
- **`job-search-config.template.md`** — Generic template with scoring weights, tier definitions, and pipeline settings.
- **Integration note in skill:** Career Intelligence Onboarding and SDE Onboarding are independent. For founder/operator beta users (not job-searching), SDE Onboarding alone is sufficient for Week 1.

Trigger: `"onboard me to career intelligence"` / `"career setup"` / `"set up job search"`

---

## [0.51.1] — 2026-05-14 — sde-onboarding Phase 0 for external beta users

### Fixed

- **sde-onboarding CAREER_HOME for external users** — skill previously defaulted to `~/anand-career-os` (Anand's personal workspace) when `$CAREER_HOME` was not set, which would fail on any other machine. Added Phase 0 that asks for workspace path before the interview, defaults to `~/career-os`, creates the directory structure, and persists `$CAREER_HOME` to shell profile. External beta users (Rahul, Jonas) can now complete onboarding end-to-end on a fresh machine.
- **sde-onboarding completion git command** — fixed `cd && git add` antipattern to `git -C $CAREER_HOME ...` pattern.

---

## [0.51.0] — 2026-05-14 — Fix gate script paths (career-os → career-intelligence)

### Fixed

- **Publishing gate scripts silently failing** — 12 SKILL.md and rule files referenced `plugins/cache/xos/career-os/` which no longer exists (plugin was renamed to `career-intelligence` in v0.38.0). Every gate script that used `ls -v .../career-os/*/rules/.../HOW.py` resolved to empty string, causing `python3 ""` to fail. This blocked Substack publish gate, LinkedIn dedup, outreach dedup, campaign preflight, and all SDE distribution gates.
  - Files fixed: `substack-distribution-module`, `linkedin-distribution-module`, `linkedin-groups-distribution-module`, `social-distribution-engine`, `browser-submit`, `distribution-analytics-engine`, `outreach-composer`, `resume-engine`, `mission-control`, `sde-onboarding`, `outreach-fact-check`, `rules/campaign-preflight`

---

## [0.50.0] — 2026-05-12 — CAREER_HOME Migration Complete (SKILL.md layer)

### Changed

- **All SKILL.md files migrated** — `$CAREER_OS_HOME` → `$CAREER_HOME`, `$CAREER_OS_GITHUB_REPO` → `$CAREER_GITHUB_REPO` across 19 skill/dev/rule files. v0.48.0 migrated the Python scripts; v0.50.0 completes the migration in the Markdown layer that agents load at runtime.
  - Files updated: `skills/apply-tracker`, `skills/browser-submit`, `skills/campaign-engine`, `skills/cruise-control`, `skills/interviewer-research`, `skills/job-search-scheduler`, `skills/mission-control`, `skills/network-intelligence`, `skills/outreach-composer`, `skills/outreach-fact-check`, `skills/pipeline-sync`, `skills/resume-engine`, `skills/sde-onboarding`, `dev/build-feature`, `dev/ci`, `dev/spec-feature`, `dev/guard.sh`, `rules/biographical-claim-precheck/AUDIT.sh`, `rules/campaign-preflight/AUDIT.sh`
- Python backward-compat fallbacks (`CAREER_HOME` → `CAREER_OS_HOME` → default) remain in place. Old env var names still work. Remove in v1.0.0.

### CI
- Suite 1 (hooks): 197 pass, 12 fail — within baseline of 13 ✓
- Suite 2 (outreach-dedup): 16/16 ✓
- Suite 3 (mission-control): 57/57 ✓

---

## [0.49.0] — 2026-05-10 — LinkedIn Groups + Crowdsourced Signal v1.0

### Added

- **skills/linkedin-groups-distribution-module/SKILL.md** — Full LinkedIn Groups discovery + spoke distribution skill. Phase 1: reads content_pillars from professional-brand.md, searches LinkedIn via chrome-devtools MCP (port 9222), scores groups 0–100 (member count, activity, topic relevance, spam risk), presents top 10 for user approval, writes to social-channel-directory.md. Phase 2: channel type `linkedin_group` with 7-day cooldown, 150-word max, discussion-framing rules, max 3 groups/campaign, groups-post-log.jsonl append, Day+1 comment monitoring reminder.
- **rules/linkedin-groups-dedup/HOW.py** — 7-day cooldown gate. Reads `groups-post-log.jsonl`, BLOCKs with last_posted + next_available date if posted within cooldown. Exit 0=PASS, 1=BLOCK.
- **rules/linkedin-groups-dedup/AUDIT.py** — Audit report: block rate, passes, total group posts, posts-per-group breakdown over configurable window.
- **rules/linkedin-groups-dedup/WATCH.py** — Fire-rate observer. Emits keep/strengthen/kill verdict; detects zero-fire with active log (possible bypass), high block rate, normal operation.
- **rules/linkedin-groups-dedup/manifest.json** — Rule manifest.
- **skills/social-distribution-engine/signal-collector.py** — Phase v1.0 crowdsourced signal collection (local only). Maps campaign analytics to bucketed signal schema, appends to `brain/social-distribution-engine/signals/local-signals.jsonl`. No network calls. Invoked by distribution-analytics-engine after analytics collection. Collects: platform, post_type, content_category, hour, day_of_week, engagement_rate_bucket, impression_count_bucket, comment_rate_bucket, etc.

### Changed

- **skills/distribution-analytics-engine/SKILL.md** — Added Capability 4: Signal Collection. Documents signal-collector.py invocation with exact bash command, exit codes, privacy guarantees, and invocation rule (only when campaign.analytics is populated).
- **skills/linkedin-distribution-module/SKILL.md** — Group Management section updated to reference linkedin-groups-distribution-module skill + dedup gate invocation.
- **skills/social-distribution-engine/onboarding-templates/social-channel-directory.template.md** — Added LinkedIn Groups section with `linkedin_group` channel type example row and discovery instructions.
- **skills/social-distribution-engine/onboarding-templates/content-flywheel.template.md** — Expanded Signal Sharing section with full `signal_sharing:` YAML config block (enabled, device_id, last_sync), opt-out instructions, and explicit sync command requirement.

---

## [0.48.0] — 2026-05-10 — CAREER_HOME Env Var Migration

### Changed

- **CAREER_HOME migration** — all Python scripts, Markdown docs, and shell scripts updated from `CAREER_OS_HOME` / `CAREER_OS_SPECS` / `CAREER_OS_ENGINE` / `CAREER_OS_GITHUB_REPO` to new shorter names. Backward-compat fallback in all Python files: `os.environ.get("CAREER_HOME", os.environ.get("CAREER_OS_HOME", default))`. Old var names continue to work until v0.50.0. Compat shims remain in `~/.zshrc`.
  - Files updated: `validate-campaign-preflight.py`, `biographical-claim-precheck/HOW.py`, `warm-contact-outreach-dedup/HOW.py`, `analytics-sync-watch/AUDIT.py`, `analytics-sync-watch/WATCH.py`, `channel-status-check/HOW.py`, `surface-coverage-check/HOW.py`, `scripts/pipeline-query.py`, `tests/test_outreach_dedup.py`

---

## [0.47.0] — 2026-05-09 — SDE Onboarding Skill + Cross-Session Memory Claim

### Added

- **skills/sde-onboarding/SKILL.md** — Week 1 onboarding wizard. Interviews new users across 3 phases (brand identity, handles, distribution topology — 9 questions total), generates all 4 required context files (`professional-brand.md`, `handles.md`, `content-flywheel.md`, `social-channel-directory.md`), validates files, and prints a completion summary with Week 2 preview. Triggers: "onboard me to SDE", "sde setup", "week 1 setup", "set up my distribution engine", "i'm new to sde". Failure modes handled: skipped questions, files already exist (asks before overwriting), unknown `$CAREER_HOME`.
- **skills/social-distribution-engine/onboarding-templates/** — 4 template stubs used by the onboarding skill. Single source of truth for new user file structure:
  - `professional-brand.template.md`
  - `handles.template.md`
  - `content-flywheel.template.md`
  - `social-channel-directory.template.md`

### Changed

- **skills/social-distribution-engine/SKILL.md** — Added "Why SDE — What Vanilla Claude Cowork Cannot Do" section. Directly addresses Cowork's #1 stated limitation (no cross-session memory) with the SDE's git-versioned brain solution. Includes capability comparison table (memory, enforcement, invisible signal CTAs, timing, routing, brand voice).

---

## [0.46.0] — 2026-05-07 — Golden Hour Scheduling Gate (Gate 9)

### Added

- **rules/golden-hour-scheduling-check/** — Structural Gate 9 in the pre-flight CI. Advisory gate (all findings are WARNs — wrong timing degrades performance, does not invalidate the campaign). Checks `scheduled_at` ISO 8601 timestamps on each component against platform-specific golden-hour windows:
  - LinkedIn article/post: Mon–Thu 07:30–09:00, 11:30–13:00, 17:00–18:30 (60-min golden hour)
  - X/Twitter: Mon–Thu 08:00–10:00, 12:00–13:00, 17:00–18:00 (30-min golden hour)
  - Instagram: any day 06:00–09:00, 11:00–13:00, 19:00–21:00 (30-min golden hour)
  - Substack: Tue–Thu 06:00–10:00 (60-min golden hour)
  - Reddit: Mon–Fri 06:00–08:00, 12:00–14:00
  - Facebook: Mon–Thu 09:00–13:00
  - WARNs on bad days (Fri–Sun for LinkedIn/Substack), outside-window times, and same-platform posts <2h apart
  - WARNs when no `scheduled_at` found (gate cannot validate; campaign may be live-posted)
  - Timezone from `meta.timezone` (default: `America/Los_Angeles`)
  - `AUDIT.py` + `WATCH.py` + `manifest.json`

### Changed

- **skills/social-distribution-engine/validate-campaign-preflight.py** — Gate 9 wired in as third `Pre-Dist` phase gate. Docstring updated from "8 gates" to "9 gates".
- **skills/social-distribution-engine/SKILL.md** — Campaign Pre-Flight Gate section updated to document Gate 9 and golden windows per platform.

---

## [0.45.0] — 2026-05-07 — Gate 8 Invisible Platform Signal CTAs

### Changed

- **rules/flywheel-cta-quality-check/PROMPT.md** — Added "Platform Invisible Signals" section elevating the highest-algorithmic-weight CTAs to BLOCK status (previously undetected):
  - X/Twitter: **BLOCK** if no explicit bookmark ask (bookmark weight 10x vs like 1x); **WARN** if no profile-visit hook at thread end (profile-click weight 12x)
  - Instagram: **BLOCK** if no save prompt (`#1` ranking signal on Instagram); **BLOCK** if no DM-share prompt (`#1` invisible distribution signal — hidden from creators)
  - Substack: **BLOCK** if share CTA only in footer — must appear mid-content after first major insight where forward intent is highest
  - Comment Cascade: **BLOCK** if comment has a link but no 2+ topic-specific keywords from the post subject matter (LinkedIn NLP Depth Score penalizes generic comments; generic comments with links actively hurt algorithmic reach)
  - Judge task updated to explicitly call out invisible signal CTAs as the highest-miss, highest-weight class

---

## [0.44.1] — 2026-05-07 — Preflight Worst-Status Bug Fix

### Fixed

- **skills/social-distribution-engine/validate-campaign-preflight.py** — Worst-status tracking now uses severity ordering (`block > warn > pass`) instead of exit-code numeric ordering. Previously, `EXIT_MAP` had `block=1` and `warn=2`, so a warn (2) numerically dominated a block (1) — campaigns with BLOCK gates were reporting overall PASS/WARN and exiting 0. Fixed by tracking `worst_status` via a separate `SEVERITY` dict and computing `worst_exit` from it at the end.

---

## [0.44.0] — 2026-05-07 — CTA Quality Semantic Gate (Gate 8)

### Added

- **rules/flywheel-cta-quality-check/** — Semantic LLM judge (Gate 8 in pre-flight) evaluating CTA strength and platform-appropriateness across every flywheel component. Enforces the CTA conversion chain: Substack → LinkedIn Article → LinkedIn Post Hub → Spokes → Comment Cascade. Uses OAuth CLI (`claude → gemini → codex`, no API key). Honors `SKIP_LLM_JUDGES=1`. Exit 0=PASS, 1=BLOCK, 2=WARN.
  - `PROMPT.md` — per-platform CTA rules: Substack (specific share CTA — who/why/what), LinkedIn Article (Substack CTA at header AND footer), LinkedIn Post Hub (hook only, unresolved tension — BLOCK if summarizes), X (link in reply not body), Reddit (link in comment not body), Instagram (bio-link reference required), Facebook (specific share ask), Comment Cascade (backward-link copy must reference old content's topic)
  - `HOW.py` — same pattern as Gate 7: collects campaign.json + content files, pipes to CLI judge, 180s timeout
  - `AUDIT.py` + `WATCH.py` + `manifest.json`

### Changed

- **skills/social-distribution-engine/validate-campaign-preflight.py** — Gate 8 wired in as second `Semantic` phase gate. Docstring updated from "7 gates" to "8 gates".
- **skills/social-distribution-engine/SKILL.md** — Campaign Pre-Flight Gate section updated to document Gate 8.

---

## [0.43.1] — 2026-05-07 — Gate Bug Fixes

### Fixed

- **rules/channel-status-check/HOW.py** — `lstrip("r/")` → `removeprefix("r/")` in both `parse_channel_directory` and the spoke-checking loop. `lstrip` strips individual chars from a set, so `r/reinforcementlearning` would produce `einforementlearning`. `removeprefix` strips the exact prefix string.
- **rules/flywheel-sequence-guard/HOW.py** — dep dedup in "check all" mode now uses id-based first-seen dict throughout, instead of dict equality comparison (which failed silently because different helper functions produce source/hub deps with different `reason` strings). Deps are now unique and first-reason-seen wins.
- **rules/campaign-estate-quality-check/PROMPT.md** — Added two clarifications: (1) do NOT re-flag unresolved `[TOKEN]` placeholders (structural gate handles this — evaluate routing INTENT from the template label instead); (2) do NOT re-flag flywheel sequence order from status fields (flywheel-sequence-guard handles this).

---

## [0.43.0] — 2026-05-07 — Estate Model Semantic Gate (Gate 7)

### Added

- **rules/campaign-estate-quality-check/** — Semantic LLM judge (Gate 7 in pre-flight) that evaluates the entire campaign package against the SDE Estate Model thesis. Uses OAuth CLI (`claude → gemini → codex` fallback, no API key). Catches violations invisible to structural gates: X thread routing to Article SEO Hub instead of Post Hub, Post Hub summarizing instead of hooking, Article missing Substack CTA, platform-non-native copy, weak Estate narrative flow. Exit 0=PASS, 1=BLOCK, 2=WARN. Honors `SKIP_LLM_JUDGES=1` for CI. Origin: April 22-23 reviews were per-content checks; no gate evaluated the whole campaign as a unit against the Estate thesis.
  - `PROMPT.md` — judge prompt encoding all Estate model rules (publish order, hub-spoke routing, Post Hub hook discipline, Article SEO Hub requirements, platform-native copy per platform, comment cascade quality)
  - `HOW.py` — collects campaign.json + all content files, builds consolidated package, pipes to CLI judge
  - `AUDIT.py` + `WATCH.py` + `manifest.json`

### Changed

- **skills/social-distribution-engine/validate-campaign-preflight.py** — Gate 7 wired in as new `Semantic` phase. Added per-gate timeout support (semantic gates run at 180s; structural gates at 30s).
- **skills/social-distribution-engine/SKILL.md** — Campaign Pre-Flight Gate section updated to document Gate 7.

### Fixed

- **validate-campaign-preflight.py** — Hardcoded 30s timeout replaced with per-gate configurable timeout. Semantic gates (LLM CLI calls) were timing out at 30s.

---

## [0.42.0] — 2026-05-07 — Objective Codification Harness: SDE Gate Stack + CareerOS AUDIT/WATCH

### Added — SDE Rules (Phase 1-5 Campaign Lifecycle Gates)

- **rules/content-url-resolution-check/** — Blocks distribution if any content file contains
  unresolved `[TOKEN]` placeholders (e.g., `[PART-3-URL]`). HOW.py + AUDIT.py + WATCH.py + manifest.json.

- **rules/flywheel-sequence-guard/** — Enforces Estate Model publish order: Substack → LinkedIn Article
  → LinkedIn Post Hub → External Spokes. Blocks any out-of-order distribution attempt.
  HOW.py + AUDIT.py + WATCH.py + manifest.json.

- **rules/channel-status-check/** — Reads `brain/social-distribution-engine/social-channel-directory.md`
  and blocks distribution to BANNED subreddits/communities (e.g., r/LocalLLaMA, r/ClaudeAI).
  WARNs on Low ROI channels. Instance-portable via CAREER_HOME. HOW.py + AUDIT.py + WATCH.py + manifest.json.

- **rules/campaign-schema-validator/** — Structural gate: validates required campaign.json fields
  (meta, source, hub, spokes, assets, review) and verifies all content_file/asset file refs exist on disk.
  Machine-actionable (JSON + exit codes) for CI. HOW.py + AUDIT.py + WATCH.py + manifest.json.

- **rules/surface-coverage-check/** — Enforces CAMPAIGN-COMPLETENESS invariant: derives canonical
  distribution surfaces from `brain/identity/handles.md`, blocks silent omissions. Allows documented
  skips via `meta.skip_surfaces`. HOW.py + AUDIT.py + WATCH.py + manifest.json.

- **rules/visual-asset-review-check/** — Enforces VISUAL-ASSET REVIEW invariant: blocks distribution
  if any image-bearing component exists but `review.assets_reviewed=false`.
  HOW.py + AUDIT.py + WATCH.py + manifest.json.

- **rules/analytics-sync-watch/** — Phase 5 (post-distribution) gate: WARNs when published campaigns
  have no analytics data after 7+ days. Also surfaces campaign.json schema gap (no `analytics` section).
  HOW.py + AUDIT.py + WATCH.py + manifest.json.

- **skills/social-distribution-engine/validate-campaign-preflight.py** — Meta-harness CI entry point.
  Runs all 6 Phase 1-3 gates in order, produces consolidated report (human-readable + JSON summary).
  Exits 0=ALL PASS, 1=BLOCK, 2=WARN. Referenced in SDE SKILL.md as mandatory pre-flight gate.

### Added — CareerOS Rules (AUDIT + WATCH)

- **rules/company-flags-filter/AUDIT.py + WATCH.py + manifest.json** — Compliance audit
  (bypass detection) + evolution scanner (block rate monitoring) for existing HOW.py gate.

- **rules/outreach-people-file-commit/AUDIT.py + WATCH.py + manifest.json** — Compliance audit
  (uncommitted-write detection) + evolution scanner (session_death_risk, caller_gap signals).

### Technical

- All 7 new rules follow the canonical HOW/AUDIT/WATCH/manifest pattern from warm-contact-outreach-dedup.
- All rules tested against Article 03 campaign (`03-cross-context-review-2026-04-28`) — correct BLOCK
  signals on: unresolved [PART-3-URL] tokens, banned channels (r/LocalLLaMA, r/ClaudeAI), dependency
  chain (all pending), assets_reviewed=false. Schema and surface coverage PASS.
- validate-campaign-preflight.py tested end-to-end: 4 BLOCK gates, 2 PASS gates, correct exit 1.

## [0.41.0] — 2026-05-07 — SDE Rename: distribution-engine → social-distribution-engine

### Changed

- **skills/social-distribution-engine/content-flywheel.md, brand-patterns.md, hijack-playbook.md**
  — renamed from `distribution-engine/` to `skills/social-distribution-engine/`. `distribution-engine/` deleted.

- **rules/campaign-preflight/HOW.sh** — `_PLUGIN_BASE` path updated to
  `skills/social-distribution-engine/content-flywheel.md`.

- **4 SKILL.md files** (social-distribution-engine, linkedin-distribution-module,
  reddit-distribution-module, distribution-analytics-engine) — `brain/distribution/` refs updated
  to `brain/social-distribution-engine/`.

### Added

- **rules/content-format-check/** — graduated from cyborg staging into plugin (canonical).

### Removed (graduated from cyborg staging)

- cyborg/rules/: campaign-preflight, comment-hijack-gate, content-format-check,
  social-content-readiness-check, substack-publish-gate — plugin is now canonical.
- cyborg/distribution-engine/ transitional copy deleted.
- Signal-pollution invariant satisfied: SDE rules run only from plugin.

---

## [0.40.0] — 2026-05-07 — Distribution Engine Full Migration (Self-Contained Plugin)

### Added

- **rules/biographical-claim-precheck/** — copied from cyborg; enforces biographical claim
  verification before T4 outreach/resume artifacts ship. HOW.py + AUDIT.sh + WATCH.sh.

- **rules/comment-hijack-gate/, substack-publish-gate/, social-content-readiness-check/,
  linkedin-mention-gate/, campaign-preflight/** — all five distribution-engine rules now bundled
  in plugin. Plugin is fully self-contained — no ~/cyborg/ dependency at install time.

- **skills/browser-submit/browser-submit-probe.js** — Playwright probe script for ATS browser
  automation bundled in plugin (was previously ~/cyborg/infrastructure/scripts/).

- **skills/social-distribution-engine/detect.py** — hijack target scoring script bundled.

- **distribution-engine/content-flywheel.md, brand-patterns.md, hijack-playbook.md** — full
  distribution-engine playbook bundled.

### Changed

- All `~/cyborg/...` path references in SKILL.mds replaced with plugin-relative glob resolution:
  `$(ls -v ~/.claude/plugins/cache/xos/career-os/*/rules/<slug>/HOW.py 2>/dev/null | tail -1)`
  Affected: substack-distribution-module, linkedin-distribution-module, social-distribution-engine,
  mission-control, outreach-composer, resume-engine, outreach-fact-check, browser-submit.

- **skills/browser-submit/SKILL.md** — dispatch log path moved from
  `~/cyborg/infrastructure/scripts/dispatch-log.jsonl` to `$CAREER_HOME/brain/logs/`.

## [0.39.0] — 2026-05-07 — Distribution Engine Gate Wiring

### Changed

- **skills/substack-distribution-module/SKILL.md** — added mandatory `Pre-Publish Gate` section
  that calls `~/cyborg/rules/substack-publish-gate/HOW.py` before any publish action. Four gates:
  `resend_block` (inviolable — no override), `email_send_gate` (human confirmation required per-turn),
  `completeness` (word_count ≥ 300 + hook + cta), `quality` (LLM judge on post_excerpt). Origin:
  2026-04-23 agent republished Substack to fix wrong cover → second email to all subscribers.

- **skills/linkedin-distribution-module/SKILL.md** — added `Comment Hijack Gates` section with two
  mandatory gates for hijack-style comments: Gate A calls `~/cyborg/distribution-engine/detect.py`
  for target scoring (HIJACK/MONITOR/SKIP) before writing the comment; Gate B calls
  `~/cyborg/rules/comment-hijack-gate/HOW.py` for comment quality + dedup + freshness + LLM
  standalone_value judge before posting.

### Dependencies (cyborg rules — must be present on agent's machine)

- `~/cyborg/rules/substack-publish-gate/` — built 2026-05-07
- `~/cyborg/rules/comment-hijack-gate/` — built 2026-05-07
- `~/cyborg/distribution-engine/detect.py` — built 2026-05-07

## [0.38.0] — 2026-05-05 — JSON Pipeline Migration Complete

### Changed
- **All 14 SKILL.md files** — updated references from `job-pipeline.md` to `job-pipeline.json` (pipeline SSOT fully migrated to JSON)
- **apply-dashboard SKILL.md** — removed stale `--pipeline-path` flag from pipeline-query.py invocation (script never accepted this arg)
- **mission-control Quick Actions** — reordered: Status section (applied/rejected/interview) surfaces first
- **tests/test-hooks.sh** — updated SKILL.md assertion to check for `job-pipeline.json` reference (mirrors the migration)

### Added
- **scripts/pipeline-view.py** — on-demand formatted pipeline view from JSON sources (stage-grouped, warm-path aware)

### Removed
- **scripts/match-tracker-migrate.py** — one-time MD batch table standardization script (migration complete)
- **scripts/migrate-tracker-to-json.py** — one-time MD→JSON tracker conversion (migration complete, archive preserved)
- **scripts/migrate-people-to-json.py** — one-time people migration script (191 files migrated, complete)

## [0.37.0] — 2026-05-05 — Hashtag Selection Protocol + Priority-Ordered Banks

### Added

- **skills/social-distribution-engine/platforms.json v1.1.0** — `_hashtag_selection_protocol`
  block with priority slot-fill order (brand → campaign-specific → niche → highway) and 5-step
  detector protocol (live audit, freshness rule, dead-road threshold). Replaces ad-hoc hashtag
  selection with a machine-readable spec agents follow at campaign ship time.
- **`_hashtag_banks`** — priority-ordered tag banks for `linkedin_post`, `x_post`, and
  `instagram_caption`. Each bank has brand/niche/highway sub-tiers with priority scores.
  `#TheWhyCyborg` is P1 brand tag (universal thesis tag for all Cyborg campaigns) on LinkedIn and X.
  LinkedIn: 5-slot max; brand=[TheWhyCyborg P1, TheWhyMan P2, CyborgWay P3, xHumanOS P4];
  niche=[PersonalAgents P1, AgenticAI P2, AIInfra P3, FutureOfWork P4, ClawCamp P5*,
  AIInfraSummit P6*]; highway=[AILeadership P1, GenAI P2, ArtificialIntelligence P3,
  TechLeadership P4]. Campaign-specific tags (*) carry a `campaign` slug field.

## [0.36.0] — 2026-05-05 — Relationship Origin Detection + LinkedIn message grounding

### Added

- **skills/network-intelligence/SKILL.md** — `how do I know [Name]` trigger added. Full
  Relationship Origin Scan behavior: fetches LinkedIn contact_info (connection date), experience
  timeline, and message history in parallel; cross-references with `brain/identity/experience-history.md`
  to find employer overlap; classifies relationship tier; populates `relationship_origin`,
  `conversation_history`, and `cohort` frontmatter fields on people files.
- **Cohort Detection** — `cohort scan for [Company]` behavior: groups all connections sharing a
  relationship origin (same company ±18 months) into a named cohort. One shared opener warms the
  entire cluster simultaneously.
- **People file schema v0.30.0** — documents `relationship_origin`, `cohort`, and
  `conversation_history` as canonical frontmatter fields. Agents must not fabricate these fields;
  left absent until the scan runs.
- **tests/test-mission-control.sh NI-004 block** — 12 assertions covering: `how do I know` trigger,
  LinkedIn 3-parallel-fetch spec, experience-history cross-reference, all three new schema fields,
  cohort detection, dedup fallback documented in SKILL.md, and `last_message_sent` fallback code in
  HOW.py. All 57 tests pass.
- **rules/warm-contact-outreach-dedup/HOW.py** — `conversation_history.last_message_sent` fallback
  already in code (confirmed this release). When `last_contact` frontmatter is absent, HOW.py falls
  back to `last_message_sent` from the `conversation_history` block as the recency signal.

## [0.35.4] — 2026-05-05 — Content routing + context pre-flight + /ship-careeros

### Added

- **mission-control/SKILL.md** — `Write/draft content` row added to routing table. Content requests
  ("write a post", "LinkedIn post", "help me draft", "what should I post", "post about [X]") now
  explicitly route to `social-distribution-engine`. Content Routing Context Pre-Flight Mandate added:
  before dispatching any content request, Mission Control confirms `brain/identity/professional-brand.md`,
  `handles.md`, and the IP Firewall are loaded; reads them silently if not.
- **social-distribution-engine/SKILL.md** — `Step 0 — Context Pre-Flight (MANDATORY)` added before the
  Pre-Publication Gate. Reads brand voice, handles, and IP Firewall before writing any content.
  IP Firewall is a BLOCK (cannot draft without it); brand/handles are warn-and-proceed.
- **`~/.claude/commands/ship-careeros.md`** — `/ship-careeros` slash command. Full 7-step S3F cycle
  specific to career-os: ALL three local test suites (hooks + outreach-dedup + mission-control)
  hard-fail enforced → version bump → release-branch workflow → push → local install → smoke-test → done.
  Unlike generic /ship-plugin, all suites are hard-fail (no `|| true`). Loop closes at smoke-test.

## [0.35.3] — 2026-05-05 — Contact Action Pre-Flight Protocol (people file grounding)

### Added

- **mission-control/SKILL.md** — `PROTOCOL: Contact Action Pre-Flight (MANDATORY)` section.
  Before surfacing any action suggestion for a named contact, Mission Control MUST: (1) read
  `brain/network/people/<slug>.md` in full; (2) check the Interaction Log for evidence the action
  is already done and SUPPRESS if so; (3) check `last_contact` staleness and annotate.
  Origin: 2026-05-05 gate failure where "verify IC title with Paul" was suggested after paul-hessey.md
  already showed the confirmation had been sent via email on 2026-05-04.
- Pre-Dashboard Checks step 5: explicit mandate to apply Contact Action Pre-Flight for every warm
  contact before dashboard render.

### Changed

- **tests/test-mission-control.sh** — added MC-008 spec compliance assertions covering: protocol
  section present, people file path reference, interaction log check, staleness check, suppress rule,
  and MANDATORY label.
- Fixed two pre-existing spec compliance assertions: `"STALE PIPELINE ALERTS"` → `"STALE ALERTS"`;
  `"first-run"` → `"First Run"` (matched actual SKILL.md headings).

## [0.35.2] — 2026-05-05 — Social distribution pre-publication gate

### Added

- **social-distribution-engine/SKILL.md** — mandatory `Pre-Publication Gate` section wired before
  `Execution Flow`. Agents now know to run Gate 1 (structural) then Gate 2 (semantic) on every
  piece of content before `status: ready` or any publish action.
- **Gate 1** — `post_validator.py` (char limits, markdown bleed, pipes, HTML, URL suppression).
- **Gate 2** — `~/cyborg/rules/social-content-readiness-check/HOW.py`: three parallel LLM judges
  (tone/authenticity, IP/patent firewall, narrative clarity). OAuth CLIs only — no `ANTHROPIC_API_KEY`
  required. Judge routing: tone → `claude -p`, ip_safety → `gemini --yolo`, narrative → `codex exec`.
  SDK path retained as last-resort fallback only.

### Changed

- **social-content-readiness-check/HOW.py** (cyborg rule) — primary judge path switched from
  Anthropic SDK to OAuth CLI chain (cross-family: claude + gemini + codex). Each judge result now
  includes `cli` and `cross_family` fields for operator visibility.

## [0.35.1] — 2026-05-05 — Workflow convention + path fix

### Fixed

- **apply-dashboard/SKILL.md** — pipeline-query path was `$CAREER_HOME/~/.career-os-state/...`
  (broken concatenation). Corrected to `~/.career-os-state/scripts/pipeline-query.py`.

### Changed

- **GitHub Actions workflow files** renamed to `career-os-*` convention (matches co-dialectic):
  `ci.yml` → `career-os-ci.yml`, `release.yml` → `career-os-release.yml`,
  `daily-squash.yml` → `career-os-daily-squash.yml`, `mirror-codeberg.yml` → `career-os-mirror-codeberg.yml`.
  `name:` field and header comment updated in each file.

## [0.34.0] — 2026-05-05 — JSON Tracker + pipeline-query + pytest suite

### Added

- **pipeline-query.py** — pure Python stdlib CLI at `~/.career-os-state/scripts/pipeline-query.py`.
  Reads `job-pipeline-match-tracker.json`, filters by score/decision/company/batch/status,
  outputs grouped table or JSON. `--self-test` flag for smoke-check. Zero pip deps.
- **schemas/match-tracker.schema.json** — formal schema for the JSON tracker format.
- **scripts/migrate-tracker-to-json.py** — migrates existing MD tracker to JSON.
  Handles 8/10/11 column formats, score normalisation, status normalisation. 232 rows migrated.
- **scripts/validate-tracker-json.py** — validates JSON tracker against schema. Pure stdlib.
- **tests/test_outreach_dedup.py** — pytest suite (16 tests) replacing `test-outreach-dedup.sh`.
  Calls `HOW.check()` directly; no subprocess; uses `tmp_path` fixture.

### Changed

- **CI/release workflows** — now run `pytest tests/test_outreach_dedup.py -v` (gates both CI and release).
- **job-match-scorer/SKILL.md** — tracker write spec updated to JSON objects (field schema, status enums).
- **apply-dashboard/SKILL.md** — tracker read path updated to `.json`.

### Archived

- `tests/test-outreach-dedup.sh` → `tests/_archive/test-outreach-dedup.sh`

## [0.33.1] — 2026-05-05 — Fix false positive on LinkedIn dash bullets

### Fixed — post_validator.py: `- item` list style no longer flagged as markdown violation

Removed `^\s*[-*]\s` from `_MD_PATTERNS`. Dash-prefixed list items on LinkedIn
are deliberate plain-text formatting, not accidental markdown. Users want `- item`
to render literally. Only patterns where users expect invisible formatting but get
visible noise are violations: pipes, `**bold**`, `# headings`, code fences.

## [0.33.0] — 2026-05-05 — Social Distribution Engine Python Layer

### Added — platform validator, campaign tracker, master index, auto-URL hook

- **platforms.json** — machine-readable platform constraints. Update here; code reads at runtime.
- **post_validator.py** — deterministic format checker. 16/16 CI tests.
- **campaign_tracker.py** — URL capture + analytics + needs-sync gap finder. 39/39 CI tests.
- **campaigns_index.py** — master cross-campaign index for flywheel cross-linking. 15/15 CI tests.
- **postpublish-campaign-tracker.py** (cyborg hook) — auto-records URL after LinkedIn/Reddit MCP publish.
- All 9 existing campaigns migrated to campaign.json.

## [0.32.0] — 2026-05-04 — Zero-Bloat Config

### Fixed — CAREER_OS_PLUGIN env var eliminated

`CAREER_OS_PLUGIN` was the only env var requiring users to know where the
plugin installed. It had exactly one live usage: the STEP 0 dedup check in
outreach-composer. Replaced with a self-resolving glob:

```bash
ls -v ~/.claude/plugins/cache/xos/career-os/*/rules/warm-contact-outreach-dedup/HOW.py | tail -1
```

This reads directly from the Claude Code marketplace cache — the canonical
install location — without any env var. Upgrades are automatically picked up
via the version-sorted glob.

`CAREER_OS_PLUGIN` removed from `ci.yml` and `release.yml` as well. Only
`CAREER_HOME` needs to be set (user's data repo root — genuinely
user-specific and not derivable).

## [0.31.0] — 2026-05-05 — Multi-User Portability + CI

### Fixed — portability: all hardcoded user paths replaced with env vars

Every skill file and enforcement script previously referenced Anand's personal
paths (`~/anand-career-os/`, `~/aiprojects/career-os-plugin/`). Any marketplace
user would get broken path references immediately. All 11 skill files and 2
scripts now use:
- `$CAREER_HOME` — user's data repo root (set in shell profile at install)
- `$CAREER_OS_PLUGIN` — plugin installation directory
- `$CAREER_GITHUB_REPO` — derived from `git -C $CAREER_HOME remote get-url origin`

`rules/warm-contact-outreach-dedup/HOW.py` reads `CAREER_HOME` env var with
graceful fallback. `scripts/match-tracker-migrate.py` standardized from the
non-canonical `CAREER_HOME` to `CAREER_HOME`.

### Added — outreach-composer: mandatory dedup pre-flight (STEP 0)

`warm-contact-outreach-dedup/HOW.py` existed but was never wired into the
outreach-composer skill. Every trigger (`write outreach for`, `follow up with`,
`linkedin message to`, etc.) now invokes HOW.py as STEP 0 — BLOCK verdict halts
the draft entirely. Skip-rule: NONE.

### Added — CI: GitHub Actions + release gate

`.github/workflows/ci.yml` runs on every push and PR. `test-outreach-dedup.sh`
(17 tests) is the mandatory gate. `release.yml` now has `needs: test` — no tag
can produce a `.plugin` artifact without CI passing first.

## [0.30.0] — 2026-05-04 — Relationship Origin Detection

### Added — network-intelligence: relationship origin scan + cohort detection

`how do I know [Name]` now triggers a 3-signal LinkedIn fetch (connection date,
employment timeline, message history) cross-referenced against the user's
`experience-history.md` to determine WHERE and WHEN a relationship started.

Multiple connections sharing the same origin company + similar connection date
are grouped into a named cohort — one shared opener warms the entire cluster.

People file schema gains three new frontmatter fields: `relationship_origin`,
`cohort`, and `conversation_history` (populated by the scan; never fabricated).

### Added — rules: warm-contact-outreach-dedup

`HOW.py` now falls back to `conversation_history.last_message_sent` when
`last_contact` frontmatter is absent, so dedup works for contacts created
before manual `last_contact` tracking was in place.

Historical releases prior to this file were captured only in `CLAUDE.md`
"Version" section and `migrations/v{old}-to-v{new}.sh` headers. Going
forward, every release appends a dated entry here.

## [0.29.0] — 2026-04-30

### Changed — Hook runtime state moved out of `<workspace>/.career-os/`

`.career-os/` is no longer touched by any hook. The directory was deleted
from the workspace as part of brain-layer canonicalization, but
`init-repo.sh` / `capture-prompt.sh` / `capture-response.sh` kept
recreating it on every SessionStart. v0.29.0 splits the runtime state
across two correct homes:

- **Plugin internal state** (version, logs, first-run marker) →
  `$CLAUDE_PLUGIN_DATA` (default `~/.career-os-state/`). Plugin owns its
  own runtime state; workspace artifacts are independent.
- **User-facing data** (the daily conversation log) → `<workspace>/brain/sessions/ledger/`.
  Lives alongside the rest of `brain/`, where the v0.28.0
  brain-layer canonicalization put everything else.

**First-run detection** now keys off `$STATE_DIR/version` instead of
workspace `.career-os/` presence. Deleting `brain/` no longer
re-triggers onboarding.

### Added — `judge-session.py` LLM quality judge

After every captured response, a Haiku-powered judge classifies the
response on three axes:

- **Tier** (T0–T4) — escalates from trivial/private through
  outreach-to-real-humans / public publishing.
- **Biographical claim risk** (low/medium/high).
- **Hallucination risk** (low/medium/high).

Notable verdicts (T3+, any medium/high risk, any flag) land in
`brain/sessions/judgments/YYYY-MM-DD.md`. Trivial responses are not
persisted — keeps the judgments file scannable.

**Non-blocking by design.** Missing `anthropic` SDK, missing
`ANTHROPIC_API_KEY`, API failures, JSON parse errors, and disk write
errors all exit 0. The judge is advisory; session capture never blocks
on it.

### Migration — `v0.28.0-to-v0.29.0.sh`

- Copies any `.career-os/ledger/*.md` to `brain/sessions/ledger/`
  (idempotent — `cp -n`).
- Creates `brain/sessions/judgments/`.
- Stamps `0.29.0` into `$STATE_DIR/version`.
- Removes `.career-os/` entirely (the cleanup the user already
  performed; migration codifies the canonical path forward).

Idempotent — re-running is a no-op.

### Test changes

- New assertion: `.career-os/` MUST NOT be created on first run.
- New assertion: `brain/sessions/ledger/` and `brain/sessions/judgments/`
  scaffolded on first run.
- `[R8]` first-run gate test rewritten — keys on `$STATE_DIR/version`
  rather than workspace `.career-os/`.
- `[I3]` post-upgrade lifecycle now verifies `.career-os/` is removed
  after migration completes.

## [0.27.0] — 2026-04-27

### Added — `interviewer-research` skill (panel prep automation)

**`interviewer-research` skill** — auto-fires on apply-tracker's
`Screen → Interview` / `Panel Scheduled` transitions; spawns one parallel
research sub-agent per interviewer; aggregates a per-interviewer dossier
(background + likely questions + user stories to prepare + watch-outs).

**Output:** `INPUT/[company-slug]-[date]-prep-dossier.md` + a `kind:prep`
GitHub Issue at `thewhyman/anand-career-os` linking the dossier.

**The parallelization win:** N interviewers = N parallel sub-agent research
tasks (~60s wall-clock for 4 interviewers vs ~4 min sequential). Each
sub-agent uses Perplexity MCP (live web research) + LinkedIn MCP
(structured profile fetch when URL known) + the pre-loaded user identity
context (canonical experience-history + STORY_INDEX competency clusters).

**apply-tracker integration:** the `Screen → Interview` and
`Applied → Panel Scheduled` transitions now auto-invoke this skill. The
existing per-round prep GitHub Issues (`kind:prep`) remain — this skill
is the research substrate behind them. Per-round talking-points generation
stays with the existing `interview-prep` skill (separation of concerns).

**Origin:** 2026-04-27 panel-prep automation gap — a user advanced to a
2-interviewer panel and faced 30+ min of manual research per panel
without automation. Ship-tonight target for next-day conference demo.

**Read-only on brain layer.** Writes only to `INPUT/` (workspace scratch)
and GitHub Issues. P15 multi-agent safe by construction.

## [0.26.0] — 2026-04-27

### Added — `outreach-fact-check` skill (T4 outreach immunity, two modes)

**`outreach-fact-check` skill** — read-only pre-flight verifier for biographical
claims, with a folded pre-send-check enforcement mode.

**Two modes** (one verification engine, two surfaces):

- **Mode 1 — On-Demand:** explicit `verify claim: <text>` call OR Protocol 8
  dispatch on T3+ artifacts. Returns a structured verdict; caller decides.
- **Mode 2 — Pre-Send Check:** PreToolUse hook on outgoing-message tools
  (Gmail draft, LinkedIn DM). Auto-runs on every outgoing message body;
  BLOCKS the tool call on `mismatch` verdicts; soft-warns on `unknown` /
  `insufficient_evidence`; allows silently on `match`. Single-use override
  with audit-log on user authorization.

**10 claim classes:** tenure · title · scope · compensation · recognition ·
education · speaking · identity · metric · comparative.

**Canonical sources:** `~/<workspace>/brain/identity/experience-history.md`,
`identity.md`, `awards-education-speaking.md` (paths use the active
incarnation's brain layer; tilde-prefixed in the skill's output).

**Output verdicts:** `match` · `mismatch` · `unknown` · `insufficient_evidence`.

**`blast_radius_note`** field (required for `mismatch`) names other artifacts
or claim classes presumed to carry the same error — enables the multi-dim
sweep that catches cancer cells single-slot fixes leave behind.

**Examples shipped:** `example-verdict-match.json`, `example-verdict-mismatch.json`,
`example-verdict-unknown.json`, `example-verdict-insufficient-evidence.json`.

**Origin** (2026-04-26 outreach near-miss): an agent inherited a draft with
multiple unanchored biographical claims; canonical sources contradicted three
of them. T4 outreach to a real human in PANIC-mode warm-path. User caught
pre-send. Multi-dim sweep then surfaced more silent biographical errors in
the same draft class. This skill closes that immunity gap.

**Why fold the pre-send hook into the skill** (instead of shipping as a
separate hook): single source of truth. Verification logic lives once; both
modes consume it. Sister to Constitution OBJECTIVE-CODIFICATION + variance-
is-evil meta-discipline — no second instance to disagree with the first.

## [0.23.0] — 2026-04-25

**Indexed temporal queries** (Gemini v0.21.0 finding #5 fix). Adds parallel
`DATE` columns alongside existing VARCHAR date columns on the high-value
query targets — a strangler-fig migration that delivers indexed range
queries today without touching any read paths that worked before.

**Why parallel-column over in-place ALTER:**
- Two-way door: original VARCHAR columns stay; v0.22.0 callers see no
  change. `_dt` columns add a new fast path for date-window queries.
- Tolerant of prose-annotated dates: `created_at = "2026-04-22 (major
  revision)"` would crash an in-place DATETIME conversion. With parallel
  columns, those rows simply have NULL `_dt` and prose stays in the
  original VARCHAR column.
- Scoped narrow: 7 high-value query columns get DATE; ~60 audit-only
  columns (source_mtime / ingested_at / per-row created_at) stay
  VARCHAR. Less surface area, less risk.

**Live Dolt schema changes** (commit `5fttmml944du` on dolt main):
- `roles.batch_date_dt DATE` + `idx_roles_batch_date_dt`
- `roles.outcome_date_dt DATE` + `idx_roles_outcome_date_dt`
- `applications.applied_date_dt DATE` + `idx_apps_applied_date_dt`
- `applications.status_date_dt DATE` + `idx_apps_status_date_dt`
- `events.event_date_dt DATE` + `idx_events_event_date_dt`
- `stories.story_date_dt DATE` + `idx_stories_story_date_dt`
- `people.last_contact_dt DATE` + `idx_people_last_contact_dt`

**Back-populate via STR_TO_DATE** with `^YYYY-MM-DD` regex filter (rows
that don't match stay NULL):
- roles.batch_date_dt: 107 / 270 populated
- stories.story_date_dt: 3 / 42 populated
- (Other tables: small / not-yet-populated — migration script populates
  going forward)

**Migration script** (`~/cyborg/brain-db/migrate_career_os.py`): adds
`_parse_date()` helper + populates `_dt` columns during ingest for roles
(batch_date_dt), stories (story_date_dt), events (event_date_dt). Future
ingests automatically fill `_dt` columns where source data is parseable.

**Adapter API** (`dev/memory_adapter.py`):
- `list_roles(batch_after="YYYY-MM-DD", batch_before="YYYY-MM-DD")`
  — uses `idx_roles_batch_date_dt` for indexed range scans
- `list_recent_stories(since="YYYY-MM-DD")` — new method, uses
  `idx_stories_story_date_dt`
- `list_people(last_contact_before="YYYY-MM-DD",
   last_contact_after="YYYY-MM-DD")` — surfaces decay-aware re-contact
  candidates ("warm contacts not pinged since 30 days ago"). Uses
  `idx_people_last_contact_dt`.

**Tests added** (28 total, all green):
- `test_list_roles_batch_date_window`
- `test_list_recent_stories_uses_dt_index`
- `test_list_people_last_contact_window`

**What stayed VARCHAR (intentional):**
- `source_mtime` (audit-only — never queried temporally)
- `ingested_at` (used by reconcile pass; string compare works)
- `created_at` / `updated_at` (frontmatter-sourced; often have prose
  annotations that DATETIME would reject)
- `migration_log.started_at` / `finished_at` (audit log; ISO strings
  sort lexicographically)

**Item #6 (hooks review)** still deferred — Co-Dialectic Dolt-ledger
integration is itself paused per user directive 2026-04-25 (concerns
about coupling, privacy surface, and xOS kernel migration timing).
Career-OS hook surface stays as-is; revisit when Co-Dialectic schema
stabilizes OR a concrete cross-product query surfaces.

## [0.22.0] — 2026-04-25

**Campaign-ready release.** Tightens dev-loop, adds doc surface, hardens
schema + healthcheck, and prepares the plugin to be consumed as the v0
of the future xHumanOS Career Module. No breaking changes; v0.22.0 is
fully backward-compatible with v0.21.0 callers.

Driven by the v0.21.0 dual cross-family review (Codex BLOCK + Gemini
CONDITIONAL SHIP). 8 of 12 findings landed in v0.21.0; the remaining
4 split here:

- ✅ Item #1 (`b34267e`) — `dev/ci-local.sh` single-command runner
  (Dolt-up → migrate → pytest → optional teardown). Unblocks v0.22.0+
  iteration cadence. 4 flags (`--fresh` / `--skip-migrate` / `--teardown`
  / `-v`).
- ✅ Item #2 (`6704c27`) — `docs/MEMORY-ACCESS.md` single source of
  truth for v0.20.0+ read/write pattern (CLI + Python adapter API +
  sync semantics + troubleshooting). CLAUDE.md adds Memory Access
  section + Before-You-Code checklist step #4.
- ✅ Item #3 (`63ea97e`) — `decision_tier VARCHAR(32)` normalized
  column + `idx_roles_decision_tier` index (Codex MINOR #6 fix).
  Live Dolt back-populated 270 rows: CHECK_DELTA 96 · APPLY 75 ·
  NULL 49 · SKIP 29 · FULL_INVEST 21. Adapter auto-promotes known
  enums to indexed lookup; `tier=` arg added to `list_roles()`;
  `upsert_role()` derives tier when caller omits.
- ✅ Item #5 (`feabeaf`) — healthcheck identifier hardening
  (Gemini MINOR #4). Two-layer gate: `_is_safe_identifier()` regex
  validation + `_HEALTHCHECK_TABLES` whitelist. Defense-in-depth
  before any f-string COUNT(*).
- ✅ Item #7 (this release) — README.md adds Dolt setup + daily
  dev-loop + skill-side memory access + troubleshooting + roadmap
  section explaining xHumanOS Career Module migration path.
- ⏸ Item #4 (VARCHAR → DATETIME timestamps) — deferred to v0.23.0;
  invasive schema change, ship as rc1 + rc2 in next release.
- ⏸ Item #6 (hooks review) — deferred pending Co-Dialectic thread
  Dolt-ledger scope (cross-thread coordination required).

**Tests:** 25/25 green via `bash dev/ci-local.sh --skip-migrate`.

**Architectural specs added** *(in anand-career-os workspace, not plugin
repo)*:
- `WIP/xOS-product/career-os-contributions-to-kernel.md` — kernel API
  contracts Career-OS needs from xOS when kernel ships
- `WIP/xHumanOS-product/specs/career-module-spec.md` — career module
  within xHumanOS, plugin's destination as v0
- `WIP/career-os-product/specs/Anand-xHumanOS-incarnation.md` — Anand's
  per-instance config files (`INCARNATION.md` + `PERSONAS.md` +
  `DOMAIN-DATA.md`)
- `WIP/xOS-product/XOS-KERNEL-ARCHITECTURE.md` updated: 3 → 4 → 5
  kernel engines (Distribution + Campaign promoted), xTeamOS /
  xHumanOS reframed as incarnations not products

**Field rebuild:** Dolt container hard-reset event 2026-04-25 (cause
unknown). Recovery: re-applied schema + re-migrated 629 rows in <60s
via the new `dev/ci-local.sh` runner. Schema spec at
`WIP/career-os-product/specs/dolt-migration-schema.sql` updated to
match v0.21.0 in-session column widenings (P9 coherence fix —
spec was lagging the live DB).

**Plugin is campaign-ready:** `cruise-control` runs job-search
campaigns, `outreach-composer` writes channel-aware messages,
`apply-tracker` tracks lifecycle, `interview-prep` maps stories to
rounds. All consume Dolt via adapter; all skills functional.

## [0.21.0] — 2026-04-24

**Dolt-canonical cutover (Phase 3 of ADR-003).** Markdown fallback removed.
Skills now fail fast if the `cyborg-brain-db` Docker container is down —
intentional: `.md` files are scheduled for deletion, so silent fallback
would read empty/stale source-of-truth.

Driven by a Ground-Zero Independent-Verification-Gate review loop — two
different-model-family reviewers (Codex/GPT-family and Gemini 3.1 Flash
Lite) reviewed the v0.20.0 surface in parallel. Codex verdict: BLOCK.
Gemini verdict: CONDITIONAL SHIP. 8 findings addressed in this release;
3 MINOR findings deferred to v0.22.0 with explicit rationale.

**Adapter changes (`dev/memory_adapter.py`):**
- Ripped out `.md` fallback path. `Adapter()` raises `AdapterUnreachable`
  when Dolt is unreachable. No silent degradation.
- `_db_config()` is now evaluated per `__init__` call (was module-import-time);
  env overrides don't leak across tests.
- Added spec-mandated methods (closes Codex #3 / Gemini #1):
  `get_role`, `upsert_role`, `get_application`, `upsert_application`,
  `get_story`, `get_skill(category, name)`, `list_stories(competency=..., tag=...)`,
  `list_applications(status=...)`, `append_task`.
- `Adapter` is a context manager (`__enter__`/`__exit__`/`close`).

**Migration script changes (`~/cyborg/brain-db/migrate_career_os.py` v0.2.0):**
- **Per-batch dolt commit** with SHA captured in `migration_log.dolt_commit_sha`
  (closes Codex #2 CRITICAL). Every entity batch is a replayable checkpoint.
- **Reconcile pass** — after upsert, `DELETE FROM <table> WHERE ingested_at <
  run_start` removes orphan rows whose source files disappeared. Closes the
  second half of Codex #2.
- `ingested_at` is captured per upsert (was a module constant at import time);
  lets reconcile do its job without killing the run's own rows.
- `connect()` is env-driven (`CYBORG_DB_HOST/PORT/USER/PASSWORD/NAME/TIMEOUT`);
  no hardcoded `127.0.0.1`/`root` (closes Gemini #2).
- **`rejected` section preserved** as a distinct value — `Inactive / Rejected`
  headings now map to `inactive_rejected`, `Rejected` alone maps to `rejected`,
  and row-level `❌ REJECTED` status can promote section to `rejected`
  (closes Codex #4).
- Story slugs include category prefix (`stories/google/interview.md` →
  `google-interview`, not `interview`); prevents cross-directory collisions
  (closes Gemini #3).
- `--no-commit` and `--no-reconcile` flags for CI/test environments.

**CLI changes (`scripts/cyborg-db.py`):**
- `--backend` flag removed (Dolt-only, no choice to make).
- `applications --section` accepts any value (was whitelist of 3); new
  `--status` filter for status-substring match.
- Clear error + hint when Dolt is unreachable.

**Script rewrite (`scripts/pipeline-query.py`):**
- Reduced from 732 lines of markdown parsing to ~145 lines of adapter calls.
- CLI shape preserved (same flags, same outputs) so calling skills work
  unchanged. Dolt-required; no markdown read path.

**Tests (`tests/`):**
- `test_memory_adapter.py` — 16 cases, all Dolt-canonical (was 15, mixed).
  Added `test_no_md_fallback_methods_exist` regression guard.
- **`test_migration_regression.py` — NEW, 6 cases** covering Codex #2 and
  #4: idempotency, `migration_log.dolt_commit_sha` population, orphan
  reconcile (runs the script against a tmp CAREER_HOME), rejected-section
  preservation, new adapter methods functional, competency filter.
- **Total: 22/22 green against live `cyborg_brain` Dolt.**

**Known deferred items (→ v0.22.0):**
- Codex #6: `UPPER(decision) LIKE` defeats the decision index. Fix is a
  normalized `decision_tier VARCHAR(32)` column with its own index.
- Gemini #4: `healthcheck` uses f-string interpolation for table names
  sourced from `SHOW TABLES`. Low risk (no user input path reaches it),
  but tighten as hardening.
- Gemini #5: VARCHAR timestamps → DATETIME for native temporal queries.
  Schema change; migration script needs matching updates.

## [0.20.0] — 2026-04-24

**Dolt memory substrate (ADR-003).** Career-OS gains a SQL-queryable memory
layer backed by DoltDB (MySQL-wire, git-versioned) running in Docker. Skills
opt in via the new adapter; all existing markdown read paths remain
functional. Zero-breakage migration — the adapter falls back to `.md` when
Dolt is unreachable.

- **New: `dev/memory_adapter.py`** — single entry point for skills.
  Dolt-first, `.md` fallback, 12-factor env config
  (`CYBORG_DB_HOST`/`PORT`/`NAME`, `CAREER_OS_MEMORY_BACKEND=auto|dolt|md`).
  Dataclass read/write API for Role, Application, Story, SkillRow, Person.
- **New: `scripts/cyborg-db.py`** — thin CLI skills + shell scripts call
  instead of parsing markdown directly. Subcommands: `status`, `roles`,
  `applications`, `stories`, `skills`, `people`, `identity`, `scoring`.
  `--format json` for machine-readable output, `--backend md|dolt|auto` to
  force a specific backend.
- **New: `tests/test_memory_adapter.py`** — 15 pytest cases covering
  both-backend parity (C1 + C2 coherence re-asserted against Dolt),
  Dolt→md fallback on connection failure, schema shape invariants.
  15/15 green against live `cyborg_brain` DB.
- **Spec: `WIP/career-os-product/specs/`** — `ADR-003-memory-substrate-dolt.md`,
  `dolt-migration-spec.md`, `dolt-migration-schema.sql` (canonical DDL for
  12 tables: `roles`, `applications`, `stories`, `projects`, `references`,
  `identity`, `scoring_metadata`, `skills_matrix`, `tasks`, `events`,
  `interview_prep`, `migration_log` — `people` already existed).
- **Migration: `~/cyborg/brain-db/migrate_career_os.py`** — idempotent
  parsers for all Career-OS + brain-layer entities.
  Phase 1 ingest committed to Dolt: 592 rows (stories 40, projects 12,
  refs 29, identity 5, scoring 3, skills 47, events 1, interview_prep 10,
  roles 271, applications 8, tasks 192) + 70 people already loaded.
- **Phase discipline.** `.md` files stay canonical through Phase 2; Dolt
  is a shadow/query layer. Phase 3 cutover (Dolt-canonical, `.md` projected)
  is gated on one week of parity + explicit go-ahead — NOT in this release.
- **Docker-first.** Dolt runs via `dockerhub.com/dolthub/dolt-sql-server`
  per P3 portability corollary; no brew dependency, same image dev/prod.

**Non-breaking:** every existing skill keeps working. No SKILL.md prose was
modified in this release — the adapter is additive. Skills that want to use
the new query path call `scripts/cyborg-db.py` or `from memory_adapter import
Adapter`; skills that don't, continue reading markdown.

## [0.19.1] — 2026-04-23

Doc-coherence patch for v0.19.0. No code / migration / skill behavior
changes.

- **`schemas/shared-structures.md`**: add `interview-prep/` and
  `pipeline-snapshots/` directory layouts to the registry per ADR-002.
  v0.19.0 introduced these structures + the migration + the boundary
  test, but missed the registry entries themselves — which is the
  primary ADR-002 artifact. This release closes that gap.
- **`tests/test-hooks.sh` [C3]**: two new assertions that the registry
  lists the two new layouts. Guards against the registry-drift failure
  mode that required this patch in the first place. 196 pass / 0 fail
  (was 194 / 0).

## [0.19.0] — 2026-04-23

Interview-prep filename convention hardening. Normalizes a pre-existing
drift between `skills/interview-prep/SKILL.md` (declares canonical path
`prep-{slug}.md`) and on-disk state in home workspaces (legacy
`{company}-*-prep.md` filenames). Introduces `intel-{slug}.md` prefix
for insider-intel docs that live in the same directory but are not
round-prep outputs, and `_archive/` subdir for archived preps.

No hook changes. No skill behavior changes beyond documented read-path
tolerance. See WO-054 for full rationale.

- **Migration v0.18.1 → v0.19.0** (`migrations/v0.18.1-to-v0.19.0.sh`)
  idempotently renames existing `.career-os/interview-prep/*.md` to the
  canonical shape, ingests 3 loose interview-prep files from `WIP/`
  root into plugin memory (Anand-home-specific but no-op on fresh
  installs), and scaffolds `_archive/` + `.career-os/memory/pipeline-
  snapshots/` directories.
- **`skills/interview-prep/SKILL.md`** gains a "Legacy Read Tolerance"
  subsection documenting the skill's runtime behavior: writes are
  always canonical `prep-{slug}.md`; reads accept any `*.md` in
  `.career-os/interview-prep/` with prep-*.md preferred; filename
  migrations are handled by plugin migrations, not by silent rewrites
  on read.
- **New boundary test** in `tests/test-hooks.sh`
  (`[B-interview-prep-convention]`) asserts every non-archived file in
  `.career-os/interview-prep/` matches `prep-*.md` or `intel-*.md`
  after migration. Guards against future drift.
- **`.career-os/memory/pipeline-snapshots/`** — new scaffold directory
  for human-readable pipeline status captures separate from the live
  `job-pipeline.md`. Not yet consumed by any skill; reserved for
  future use (periodic snapshots, handoff summaries, retro analysis).

## [0.18.1] — 2026-04-19

Release-prep patch. Documentation coherence only — zero code changes,
zero hook changes, zero data-format changes. No migration required
beyond the version-stamp migration bundled with this release.

- **xOS architecture context added.** career-os-plugin is now scoped
  as a specialist observer library inside AgencyOS, the middleware
  tier of the xOS stack. Canonical reference:
  `anand-career-os/WIP/xOS-product/ARCHITECTURE-TAXONOMY.md`.
- **Session-logger hook orphan pointer.** The Stop-hook (`hooks/scripts/
  capture-response.sh`) and UserPromptSubmit hook (`capture-prompt.sh`)
  auto-commits have been degrading since ~2026-04-13 in some workspaces.
  The fix flow runs at end-of-session per the runbook — not in this
  release-prep cut. See `NEXT_SESSION_HANDOFF.md` "Compounding
  investments LEFT ON THE TABLE" → "Hook chain fix" for the triage
  entry and `anand-career-os/WIP/xOS-product/UNIFIED-CI-SPEC.md` for
  the eventual harness that will install/verify this end-to-end.
- **Unified CI reference.** Future ship surface for this plugin
  (and co-dialectic, MCP) is `bash ci.sh <product> <cmd>`. Spec:
  `anand-career-os/WIP/xOS-product/UNIFIED-CI-SPEC.md`. The existing
  `dev/ci/` skill becomes a sub-handler under that router.
- **CLAUDE.md version drift corrected.** Previous header still read
  v0.17.0 after v0.18.0 shipped. Skill count drift (12 listed vs 17
  present) and plugin-version stamp now match repo reality.

## [0.18.0] — prior release

Bundled: WO-043 Greenhouse portal verification, WO-044 cover-letter
DOCX/PDF + opt-in gate, WO-045 SSOT skill read paths, WO-046
session-logger ledger push fix, WO-047 scorer → job-match-scorer
rename (P9 self-qualifying names), WO-048 pipeline-query.py 10-col
tracker schema, WO-049 mission-control recursive story count, WO-051
ADR-002 Schema Evolution Protocol, WO-052 SessionStart first-run
gate fix, WO-053 schema-version header backfill, ADR-001 SSOT
write-path rules.

See `migrations/v0.17.0-to-v0.18.0.sh` for the full data-transform
notes and `CLAUDE.md` "Version" section for the one-line summary.

## [0.17.0] and earlier

See `migrations/v{old}-to-v{new}.sh` headers and git log. Key releases:
v0.17.0 (hook-paths fix, rescore queue consumer, multi-scan enrichment,
browser DOM/JS extraction); v0.16.0, v0.15.x, v0.14.0, v0.13.x,
v0.12.x, v0.11.0, v0.10.0 (file-per-release in `migrations/`).
