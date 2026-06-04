/**
 * brain-kernel-bootstrap.ts — career-intelligence engine bootstrap for brain-kernel.
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

import { join } from "path";
import { fileURLToPath } from "url";

import type { Brain, LintFn as LinterFn } from "../xos/plugins/brain-kernel/kernel.ts";
import type { RegisterEngineOpts } from "../xos/plugins/brain-kernel/acl.ts";
import type { LintFinding } from "../xos/plugins/brain-kernel/lint.ts";
import type { BrainReadAPI } from "../xos/plugins/brain-kernel/lint.ts";

// H3: resolve kernel path via BRAIN_KERNEL_ROOT env var with documented fallback.
// Set BRAIN_KERNEL_ROOT when the kernel is installed outside the repo tree
// (e.g., in a monorepo or Docker image).
// Default fallback assumes the standard sibling-repo layout:
//   career-intelligence-engine/ and xos/ are siblings under the same parent.
// Type-only imports above use literal relative paths (static resolution).
// This variable is available for runtime-dynamic kernel creation patterns.
const _kernelRoot: string =
  process.env.BRAIN_KERNEL_ROOT ??
  join(new URL(".", import.meta.url).pathname, "..", "xos", "plugins", "brain-kernel");

const ENGINE_ID = "career-intelligence";

// ─── ACL registration ─────────────────────────────────────────────────────────

/**
 * registerAcl — declare engine namespace + primitive write access to the kernel ACL.
 *
 * Uses the full RegisterEngineOpts overload (brain-kernel >= H2) which correctly
 * wires writes_to_primitives so the AclStore.check() grants cross-namespace writes
 * to declared identity/ and network/ paths.
 *
 * Mirrors the `brain` section in plugin.json:
 *   owned_paths:          career-intelligence/**
 *   writes_to_primitives: identity/skills-matrix.md, identity/experience-history.md,
 *                         network/people/**, network/companies/**,
 *                         network/outreach/**, network/events/**
 *   reads_from_primitives: identity/**, network/**
 *   reads_from_engines:   co-dialectic/feedback/**, co-dialectic/personas/**,
 *                         brand-amplification/campaigns/**
 *
 * Judge finding D-1: replaced multi-call legacy overload sequence with a single
 * RegisterEngineOpts call. The legacy idempotency behaviour made all calls after
 * the first into silent no-ops, so writes_to_primitives were never registered.
 */
function registerAcl(brain: Brain): void {
  const opts: RegisterEngineOpts = {
    namespace: "career-intelligence",
    owned_paths: [
      "stories/**", "projects/**", "tasks/**", "pipeline.json",
      "match-tracker.json", "resumes/**", "cover-letters/**",
    ],
    writes_to_primitives: [
      "identity/skills-matrix.md",
      "identity/experience-history.md",
      "network/people/**",
      "network/companies/**",
      "network/outreach/**",
      "network/events/**",
    ],
    reads_from_primitives: ["identity/**", "network/**"],
    reads_from_engines: [
      "co-dialectic/feedback/**",
      "co-dialectic/personas/**",
      "brand-amplification/campaigns/**",
    ],
  };
  brain.acl.register(ENGINE_ID, opts);
}

// ─── Linters ─────────────────────────────────────────────────────────────────

/**
 * checkStoryCompleteness — walks career-intelligence/stories/** and flags any
 * story file missing required STAR fields (situation, task, action, result).
 *
 * Severity: "warn" (missing field on a story is not a write blocker)
 *
 * NOTE: BrainReadAPI declares list/read as synchronous, but the lint runner
 * bridges via an async-capable implementation. We await all brain calls so
 * this linter works correctly under both the sync type contract and the
 * async bridge used in production (see lint.ts SPEC-CLARIFICATION-NEEDED).
 */
export const checkStoryCompleteness: LinterFn = async (
  brain: BrainReadAPI,
): Promise<LintFinding[]> => {
  const REQUIRED_FIELDS = ["situation", "task", "action", "result"] as const;
  const findings: LintFinding[] = [];

  // eslint-disable-next-line @typescript-eslint/await-thenable
  const paths = await (brain.list("career-intelligence/stories") as unknown as Promise<string[]> | string[]);

  for (const p of paths) {
    // Skip index and non-story files
    if (p.endsWith("STORY_INDEX.md") || p.endsWith("README.md")) continue;
    if (!p.endsWith(".md")) continue;

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const content = await (brain.read(p) as unknown as Promise<string | null> | string | null);
    if (content === null) continue;

    const lower = content.toLowerCase();

    for (const field of REQUIRED_FIELDS) {
      // Accept "## Situation", "**Situation**", "situation:", or inline bold/header
      const fieldPresent =
        lower.includes(`## ${field}`) ||
        lower.includes(`**${field}**`) ||
        lower.includes(`${field}:`) ||
        lower.includes(`\n${field}\n`);

      if (!fieldPresent) {
        findings.push({
          severity: "warn",
          path: p,
          message: `story missing STAR field: ${field}`,
          fix: `Add a "## ${field[0].toUpperCase()}${field.slice(1)}" section to ${p}`,
        });
      }
    }
  }

  return findings;
};

/**
 * checkSkillStaleness — reads identity/skills-matrix.md and flags any skill
 * whose last-updated date is >180 days ago.
 *
 * Severity: "info" (stale skill is informational, not a blocker)
 */
export const checkSkillStaleness: LinterFn = async (
  brain: BrainReadAPI,
): Promise<LintFinding[]> => {
  const STALE_DAYS = 180;
  const findings: LintFinding[] = [];

  // eslint-disable-next-line @typescript-eslint/await-thenable
  const content = await (brain.read("identity/skills-matrix.md") as unknown as Promise<string | null> | string | null);
  if (content === null) return findings;

  const today = new Date();
  const lines = content.split("\n");

  for (const line of lines) {
    // Match table rows: | Skill Name | ... | YYYY-MM-DD | ... |
    // We look for lines containing a date pattern YYYY-MM-DD
    const dateMatch = line.match(/\|\s*([\w\s.#+/\-()]+?)\s*\|[^|]*\|\s*(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const skillName = dateMatch[1].trim();
    const lastUpdated = new Date(dateMatch[2]);

    if (isNaN(lastUpdated.getTime())) continue;

    const daysSince = Math.floor(
      (today.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSince > STALE_DAYS) {
      findings.push({
        severity: "info",
        path: "identity/skills-matrix.md",
        message: `skill "${skillName}" last updated ${daysSince} days ago`,
        fix: `Review and update "${skillName}" in identity/skills-matrix.md`,
      });
    }
  }

  return findings;
};

/**
 * checkPipelineJobStaleness — reads career-intelligence/pipeline.json and flags
 * any active job with no status update in >14 days.
 *
 * Severity: "warn" (stale pipeline entry needs user attention)
 */
export const checkPipelineJobStaleness: LinterFn = async (
  brain: BrainReadAPI,
): Promise<LintFinding[]> => {
  const STALE_DAYS = 14;
  const findings: LintFinding[] = [];

  // eslint-disable-next-line @typescript-eslint/await-thenable
  const content = await (brain.read("career-intelligence/pipeline.json") as unknown as Promise<string | null> | string | null);
  if (content === null) return findings;

  let pipeline: unknown;
  try {
    pipeline = JSON.parse(content);
  } catch {
    return findings; // malformed JSON — skip, don't crash
  }

  // Support both array and { stage_data: [] } shapes
  const entries: unknown[] = Array.isArray(pipeline)
    ? pipeline
    : Array.isArray((pipeline as Record<string, unknown>)?.stage_data)
      ? ((pipeline as Record<string, unknown>).stage_data as unknown[])
      : [];

  const today = new Date();

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;

    // Only flag active/advancing entries
    const stage = String(e.stage ?? "").toLowerCase();
    if (stage === "dead" || stage === "rejected" || stage === "offered" || stage === "declined") {
      continue;
    }

    const company = String(e.company ?? e.company_name ?? "unknown");
    const slug = String(e.slug ?? e.id ?? company.toLowerCase().replace(/\s+/g, "-"));
    const updatedAt = e.updated_at ?? e.last_activity ?? e.stage_date;

    if (!updatedAt || typeof updatedAt !== "string") continue;

    const lastUpdate = new Date(updatedAt);
    if (isNaN(lastUpdate.getTime())) continue;

    const daysSince = Math.floor(
      (today.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSince > STALE_DAYS) {
      findings.push({
        severity: "warn",
        path: "career-intelligence/pipeline.json",
        message: `job "${slug}" at ${company} stale >${STALE_DAYS} days (last update: ${updatedAt})`,
        fix: `Update the pipeline entry for ${company} or close it if no longer active`,
      });
    }
  }

  return findings;
};

// ─── Public bootstrap entrypoint ─────────────────────────────────────────────

/**
 * registerEngine — register career-intelligence ACL declarations and linters
 * with a brain instance. Call once at engine install / session start.
 */
export function registerEngine(brain: Brain): void {
  registerAcl(brain);

  brain.lint.register("story-completeness", checkStoryCompleteness, {
    runs_on: "session-end",
  });
  brain.lint.register("skill-staleness", checkSkillStaleness, {
    runs_on: "session-end",
  });
  brain.lint.register("pipeline-job-staleness", checkPipelineJobStaleness, {
    runs_on: "session-end",
  });
}
