/**
 * brain-kernel-bootstrap.ts — brand-amplification engine bootstrap for brain-kernel.
 *
 * Registers ACL declarations and lint functions with an existing brain instance.
 * Called once at engine install time (or session start when the engine is active).
 *
 * Usage:
 *   import { registerEngine } from "./brain-kernel-bootstrap.ts";
 *   const brain = createBrain(workspaceRoot);
 *   registerEngine(brain);
 *
 * Lint functions receive a synchronous BrainReadAPI (from brain-kernel/lint.ts).
 * The registry bridges async FS reads — linters should call list() before read()
 * to ensure the read cache is populated (see brain-kernel/lint.ts for details).
 */

import type { Brain, LintFn as LinterFn } from "../xos/plugins/brain-kernel/kernel.ts";
import type { LintFinding } from "../xos/plugins/brain-kernel/lint.ts";
import type { BrainReadAPI } from "../xos/plugins/brain-kernel/lint.ts";
import type { RegisterEngineOpts } from "../xos/plugins/brain-kernel/acl.ts";

const ENGINE_ID = "brand-amplification";

// ─── ACL registration ─────────────────────────────────────────────────────────

/**
 * registerAcl — declare engine namespace + primitive write access to the kernel ACL.
 *
 * Mirrors the `brain` section in plugin.json:
 *   namespace:             brand-amplification
 *   owned_paths:           voice-strategies/**, campaigns/**, personas/**,
 *                          performance-history.md, patterns/**, identity/**, strategy/**
 *   writes_to_primitives:  identity/handles.md
 *   reads_from_primitives: identity/**, network/companies/**, network/people/**
 *   reads_from_engines:    co-dialectic/feedback/**, co-dialectic/personas/**,
 *                          career-intelligence/stories/**
 *
 * IMPLEMENTATION NOTE — ACL writes_to_primitives support (brain-kernel >= 1.0.0):
 * The kernel's ACL Gap Fix (2026-05-21) adds writes_to_primitives support to
 * AclStore.checkWithKind(). The full RegisterEngineOpts overload is used here
 * so the kernel can grant writes to identity/handles.md via the primitive-write
 * path. This differs from the career-intelligence bootstrap which was written
 * before the ACL fix landed and used the legacy simple-register + NO-OP pattern.
 */
function registerAcl(brain: Brain): void {
  const opts: RegisterEngineOpts = {
    namespace: ENGINE_ID,
    owned_paths: [
      "voice-strategies/**",
      "campaigns/**",
      "personas/**",
      "performance-history.md",
      "patterns/**",
      "identity/**",
      "strategy/**",
    ],
    writes_to_primitives: [
      "identity/handles.md",
    ],
    reads_from_primitives: [
      "identity/**",
      "network/companies/**",
      "network/people/**",
    ],
    reads_from_engines: [
      "co-dialectic/feedback/**",
      "co-dialectic/personas/**",
      "career-intelligence/stories/**",
    ],
  };
  brain.acl.register(ENGINE_ID, opts);
}

// ─── Linters ─────────────────────────────────────────────────────────────────

/**
 * checkCampaignCompleteness — walks brand-amplification/campaigns/ (recursive) and
 * flags any campaign master.md file missing a "Surface Coverage Matrix" section.
 *
 * Severity: "block" — a campaign without a surface coverage matrix must not ship.
 * This enforces the CAMPAIGN-COMPLETENESS INVARIANT (Ground Zero).
 *
 * NOTE: BrainReadAPI declares list/read as synchronous, but the lint runner
 * bridges via an async-capable implementation. We await all brain calls so
 * this linter works correctly under both the sync type contract and the
 * async bridge used in production (see lint.ts SPEC-CLARIFICATION-NEEDED).
 */
export const checkCampaignCompleteness: LinterFn = async (
  brain: BrainReadAPI,
): Promise<LintFinding[]> => {
  const findings: LintFinding[] = [];

  // eslint-disable-next-line @typescript-eslint/await-thenable
  const paths = await (brain.list("brand-amplification/campaigns") as unknown as Promise<string[]> | string[]);

  for (const p of paths) {
    // Only check master.md campaign files
    if (!p.endsWith("master.md")) continue;

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const content = await (brain.read(p) as unknown as Promise<string | null> | string | null);
    if (content === null) continue;

    const hasSurfaceCoverageMatrix =
      content.includes("Surface Coverage Matrix") ||
      content.includes("surface-coverage-matrix") ||
      content.includes("surface_coverage_matrix");

    if (!hasSurfaceCoverageMatrix) {
      findings.push({
        severity: "block",
        path: p,
        message: `campaign master missing "Surface Coverage Matrix" section`,
        fix:
          `Add a "## Surface Coverage Matrix" section to ${p} listing every ` +
          `platform in identity/handles.md with in-scope/out-of-scope and reason.`,
      });
    }
  }

  return findings;
};

/**
 * checkSurfaceCoverage — reads identity/handles.md and scans recent campaign masters
 * for any platform handle that is not covered by the latest campaign.
 *
 * Severity: "warn" — a missing surface is not a hard blocker but should be reviewed.
 */
export const checkSurfaceCoverage: LinterFn = async (
  brain: BrainReadAPI,
): Promise<LintFinding[]> => {
  const findings: LintFinding[] = [];

  // eslint-disable-next-line @typescript-eslint/await-thenable
  const handlesContent = await (brain.read("identity/handles.md") as unknown as Promise<string | null> | string | null);
  if (handlesContent === null) return findings;

  // Extract platform names from handles.md — line-by-line platform keyword scan.
  // Supports all formats: "- LinkedIn: @handle", "| LinkedIn |", "**LinkedIn**",
  // "X/Twitter: @handle", etc.
  const KNOWN_PLATFORMS = [
    "linkedin", "substack", "x", "twitter", "instagram",
    "reddit", "facebook", "threads", "tiktok", "youtube",
  ] as const;
  const platforms = new Set<string>();
  for (const line of handlesContent.split("\n")) {
    const lower = line.toLowerCase();
    for (const p of KNOWN_PLATFORMS) {
      if (lower.includes(p)) {
        // Normalize "twitter" to "x" so both map to the same canonical name
        platforms.add(p === "twitter" ? "x" : p);
      }
    }
  }

  if (platforms.size === 0) return findings; // handles.md has no parseable platforms

  // Find most recent campaign master
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const campaignPaths = await (brain.list("brand-amplification/campaigns") as unknown as Promise<string[]> | string[]);
  const masterPaths = campaignPaths.filter((p) => p.endsWith("master.md"));

  if (masterPaths.length === 0) return findings; // no campaigns yet — skip

  // Read the most recently modified master (alphabetically last by path as a proxy)
  const latestMaster = masterPaths[masterPaths.length - 1];
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const masterContent = await (brain.read(latestMaster) as unknown as Promise<string | null> | string | null);
  if (masterContent === null) return findings;

  // Check each platform from handles.md against the campaign master
  for (const platform of platforms) {
    const platformPresent = masterContent.toLowerCase().includes(platform);
    if (!platformPresent) {
      findings.push({
        severity: "warn",
        path: latestMaster,
        message: `platform "${platform}" is in identity/handles.md but not covered in latest campaign master`,
        fix:
          `Add "${platform}" to the Surface Coverage Matrix in ${latestMaster}. ` +
          `Explicitly mark it "out-of-scope" with a reason if intentionally excluded.`,
      });
    }
  }

  return findings;
};

/**
 * checkVoiceDrift — reads the active voice strategy and scans recent post text
 * in brand-amplification/campaigns/ (platforms sub-dirs) for deviations from
 * declared voice patterns (tone markers, forbidden phrases, required signals).
 *
 * Severity: "warn" — voice drift is reviewed, not auto-blocked.
 */
export const checkVoiceDrift: LinterFn = async (
  brain: BrainReadAPI,
): Promise<LintFinding[]> => {
  const findings: LintFinding[] = [];

  // Load active voice strategy — check for content-flywheel.md in voice-strategies/
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const voicePaths = await (brain.list("brand-amplification/voice-strategies") as unknown as Promise<string[]> | string[]);

  // Prefer "active" or "content-flywheel" files; fall back to first .md
  const activeVoicePath =
    voicePaths.find((p) => p.includes("active")) ??
    voicePaths.find((p) => p.includes("content-flywheel")) ??
    voicePaths.find((p) => p.endsWith(".md"));

  if (!activeVoicePath) return findings; // no voice strategy configured — skip

  // eslint-disable-next-line @typescript-eslint/await-thenable
  const voiceContent = await (brain.read(activeVoicePath) as unknown as Promise<string | null> | string | null);
  if (voiceContent === null) return findings;

  // Extract forbidden phrases from the voice strategy.
  // Match lines: "NEVER use: competitors" → extract "competitors"
  // Pattern: NEVER/DO NOT/forbidden + optional verb + colon + phrase
  const forbiddenPhrases: string[] = [];
  const forbiddenLineRegex =
    /(?:NEVER|DO NOT|forbidden|not use|avoid)(?:\s+\w+)?\s*:\s*["']?([^"'\n,]{3,60})["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = forbiddenLineRegex.exec(voiceContent)) !== null) {
    const phrase = m[1].trim().toLowerCase();
    if (phrase.length > 2) forbiddenPhrases.push(phrase);
  }

  if (forbiddenPhrases.length === 0) return findings; // no forbidden phrases declared — skip

  // Scan recent post drafts in campaigns/ (recursive, platforms sub-dirs)
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const campaignPaths = await (brain.list("brand-amplification/campaigns") as unknown as Promise<string[]> | string[]);
  const platformPosts = campaignPaths.filter(
    (p) =>
      p.includes("/platforms/") &&
      (p.endsWith(".md") || p.endsWith(".txt")),
  );

  // Check last 10 posts to bound lint time
  const recentPosts = platformPosts.slice(-10);

  for (const postPath of recentPosts) {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const postContent = await (brain.read(postPath) as unknown as Promise<string | null> | string | null);
    if (postContent === null) continue;
    const lower = postContent.toLowerCase();

    for (const phrase of forbiddenPhrases) {
      if (lower.includes(phrase)) {
        findings.push({
          severity: "warn",
          path: postPath,
          message: `voice drift: forbidden phrase "${phrase}" detected in post draft`,
          fix:
            `Remove "${phrase}" from ${postPath}. ` +
            `See ${activeVoicePath} for the declared voice constraints.`,
        });
      }
    }
  }

  return findings;
};

// ─── Public bootstrap entrypoint ─────────────────────────────────────────────

/**
 * registerEngine — register brand-amplification ACL declarations and linters
 * with a brain instance. Call once at engine install / session start.
 */
export function registerEngine(brain: Brain): void {
  registerAcl(brain);

  brain.lint.register("campaign-completeness", checkCampaignCompleteness, {
    runs_on: "session-end",
  });
  brain.lint.register("surface-coverage", checkSurfaceCoverage, {
    runs_on: "session-end",
  });
  brain.lint.register("voice-drift", checkVoiceDrift, {
    runs_on: "session-end",
  });
}
