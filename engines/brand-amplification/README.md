<!-- product-vs-solution: example -->
# Social Distribution Plugin

**Platform:** xOS (shared primitive for xHumanOS + xTeamOS + xFamilyOS)
**Status:** v0.47.0 — extracted from career-intelligence-engine v0.61.0 on 2026-05-17

Content distribution orchestrator for human-cyborg partnerships. Implements the hub-and-spoke flywheel (P16 in the Cyborg Constitution), 10-gate preflight CI, and platform-native modules for the major surfaces.

## What's in the box

**Core skills**
- `social-distribution-engine` — Master Coordinator. Routes campaign distribution across platforms.
- `campaign-engine` — Plans new campaigns (Surface Coverage Matrix builder).
- `campaign-dashboard` — Initiative → Campaign → Spoke hierarchy view. Read-only.
- `distribution-analytics-engine` — Post-publish KPI sync, ROI per channel.
- `flywheel-amplification-module` — Day+1 self-reply, Day+2 pull-quote, comment cascade.

**Platform modules (one per surface)**
- LinkedIn (hub + groups), Substack (honey-pot), X, Reddit, Facebook, Instagram, Threads.

**Pre-flight gates (9 in sequence)**
1. `campaign-schema-validator` — schema compliance
2. `channel-status-check` — banned/low-ROI channel detection
3. `surface-coverage-check` — every campaign covers the full surface set
4. `content-url-resolution-check` — no unresolved placeholder URLs
5. `flywheel-sequence-guard` — Substack → LinkedIn Article → LinkedIn Post → Spokes order
6. `visual-asset-review-check` — image-bearing spokes reviewed pre-ship
7. `golden-hour-scheduling-check` — posts land in platform engagement windows
8. `campaign-estate-quality-check` — LLM judge for narrative coherence
9. `flywheel-cta-quality-check` — invisible-signal CTAs (bookmark, save, DM-share)

**Platform-specific publish gates**
- `substack-publish-gate`, `linkedin-article-publish-gate`, `linkedin-post-on-article-gate`, `x-cta-resolution-gate`, `comment-hijack-gate`

## Browser platform executables (XOS-310)

Run from the engine root with Bun. An authenticated Chrome debugging endpoint
(default `:9222`, override with `CDP_PORT`) is required for actual browser work.
Substack Markdown conversion also requires pandoc.

- `bun run platforms/substack.ts --help` — preserved Markdown/frontmatter,
  `--section` and `--subtitle` CLI; always creates a fresh **draft**, never publishes.
- `bun run platforms/linkedin.ts --help` — one cascade or group target per call;
  stages by default, `--send` submits that single target. Article inspection and
  editing commands are listed in help. Existing article edits require an explicit
  `--allow-destructive-reuse` argument and exact target ID.
- `platforms/_cdp.ts` — shared transport, target capabilities, checked clicks and
  fail-hard precondition/action/postcondition wrapper. Silent no-ops never retry.

Importable primitives accept injected CDP/target clients for offline testing.
Run `bun install`, then `bun test ./tests`; the platform tests include a TypeScript
compile check of single-target signatures. Help commands never contact a browser.

Source audit: all still-live primitives in `surface_driver.py`, plus the standalone
CDP/click and single-target cascade/group flows, were ported. Duplicate click/CDP
implementations were consolidated. Raw WebSocket framing is replaced by Bun's
native WebSocket. Dropped fixed screen coordinates, implicit tab attachment,
campaign-specific copy/paths, first-word group matching, automatic modal dismissal,
silent parse fallbacks, weak body-text send checks and the external Python linter
import. Its nine live-composer checks are TypeScript with explicit surface profiles.
Substack's redundant select-all/delete is dropped because a fresh draft must be empty.
The five source Python files listed in the spec are retired; unrelated engine Python
modules are outside this migration. No runtime Python dependency is introduced.

Review record (2026-09-29, XOS-310, Codex implementation): Gemini 3.8 Flash (Low)
and Gemini 3.1 Pro (High) reviewed the source and tests through `judge-panel`.
Confirmed findings fixed: paragraph inter-tag whitespace, optional hub-URL trailing
slash, and lint assertions that now compare the complete ordered rule/severity set.
The file-chooser-hang claim was rejected against the [CDP contract](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json):
interception suppresses the native dialog, and setting files accepts the input's
object ID. Read-only inspection intentionally needs no destructive capability;
WeakMap/WeakSet do not retain their keys. Substack's verified clipboard flow is
preserved and its postconditions reject silent no-ops. Offline DOM tests verify
the orchestration and emitted scripts, not live ProseMirror behavior. The panel's
GPT-5.4 lane exited with an error; this is not a full-panel passing verdict.

## Required environment

- `$CAREER_HOME` — customer's workspace root. Plugin reads:
  - `$CAREER_HOME/identity/professional-brand.md` — brand voice
  - `$CAREER_HOME/identity/handles.md` — platform handles
  - `$CAREER_HOME/brand-amplification/identity/brand-spec.json` — brand schema (created by `sde-onboarding`)
  - `$CAREER_HOME/brand-amplification/campaigns/` — initiative + campaign storage

## Install

```bash
claude plugin marketplace add Exponential-OS/agent-marketplace
claude plugin install social-distribution@xos
```

For first-time customers, run `sde-onboarding` after install to populate the brand spec.

## Companion plugins

- `career-intelligence@xos` — job search, pipeline, outreach (xHumanOS only)
- `co-dialectic@xos` — prompt sharpening + persona detection (universal)
- `brand-intelligence@xos` — persona schema + registry (planned; currently bundled here as `sde-onboarding`)

## Provenance

Extracted from career-intelligence-engine v0.61.0 to honor the xOS-vs-xHumanOS platform split per `WIP/xOS-platform/social-distribution-product/NEXT_SESSION_HANDOFF.md`.
