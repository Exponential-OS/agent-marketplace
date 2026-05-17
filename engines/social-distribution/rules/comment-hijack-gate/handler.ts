#!/usr/bin/env bun
/**
 * handler.ts — comment-hijack-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "platform": "linkedin|twitter|x",
 *   "target_post_url": "https://...",
 *   "target_post_age_hours": 24,
 *   "comment_text": "The full comment you're about to post...",
 *   "hub_url": "https://...",
 *   "previously_commented_urls": ["https://..."]   // optional, default []
 * }
 *
 * Exits: 0=PASS, 1=BLOCK, 2=WARN
 *
 * Gates (in order):
 *   1. hub_url_present    — structural: hub URL must appear in comment
 *   2. freshness          — structural: post age within platform window
 *   3. dedup              — structural: not already commented on this URL
 *   4. standalone_value   — semantic: LLM judge via PROMPT.md + claude -p
 */

import { appendFileSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "comment-hijack-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(SCRIPT_DIR, "PROMPT.md");

// Platform-specific freshness windows (hours)
const FRESHNESS_WINDOWS: Record<string, number> = {
  linkedin: 72,
  twitter: 8,
  x: 8,
};
const DEFAULT_FRESHNESS = 48;

interface InputContext {
  platform?: string;
  target_post_url?: string;
  target_post_age_hours?: number;
  comment_text?: string;
  hub_url?: string;
  previously_commented_urls?: string[];
}

interface OutputResult {
  verdict: string;
  gate?: string;
  reason?: string;
  remediation?: string;
  platform?: string;
  target_post_url?: string;
  comment_length?: number;
  hub_url_present?: boolean;
  standalone_value?: string;
  [key: string]: unknown;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rec = { ts, rule_slug: SLUG, ...extra };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n");
  } catch {
    // Fail-open on logging errors
  }
}

function emit(output: OutputResult, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({ verdict: output.verdict, fired: true });
  process.exit(exitCode);
}

async function runLlmJudge(
  commentText: string,
  hubUrl: string
): Promise<{ verdict: string; reason?: string; fix?: string }> {
  let promptTemplate: string;
  try {
    promptTemplate = readFileSync(PROMPT_PATH, "utf-8");
  } catch {
    return {
      verdict: "BLOCK",
      reason: `PROMPT.md not found at ${PROMPT_PATH}. Cannot run LLM quality judge.`,
      fix: `Ensure ${PROMPT_PATH} exists.`,
    };
  }

  // Strip hub URL from comment so judge evaluates value without the link
  const commentWithoutHub = commentText.replace(hubUrl, "[hub link]").trim();
  const prompt = promptTemplate.replace(
    "{COMMENT_TEXT_WITHOUT_HUB}",
    commentWithoutHub
  );

  try {
    const proc = Bun.spawn(["claude", "-p", prompt], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutId = setTimeout(() => proc.kill(), 60_000);
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    clearTimeout(timeoutId);

    const raw = stdout.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        verdict: "BLOCK",
        reason: `LLM judge returned non-JSON output: ${raw.slice(0, 200)}`,
        fix: "Retry. If persistent, check PROMPT.md format.",
      };
    }
    return JSON.parse(jsonMatch[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      return {
        verdict: "BLOCK",
        reason:
          "claude CLI not found. Cannot run LLM quality judge for standalone_value.",
        fix: "Install claude CLI: https://claude.ai/code — distribution engine actions require LLM quality gating.",
      };
    }
    return {
      verdict: "BLOCK",
      reason: `LLM judge error: ${msg}`,
      fix: "Retry. If persistent, check claude CLI connectivity.",
    };
  }
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw =
    argVal === undefined || argVal === "-"
      ? (await Bun.stdin.text()).trim()
      : argVal;

  if (!raw) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          "No input. Pass JSON with platform/target_post_url/target_post_age_hours/comment_text/hub_url fields.",
      },
      1
    );
  }

  let ctx: InputContext;
  try {
    ctx = JSON.parse(raw);
  } catch (e: unknown) {
    emit(
      {
        verdict: "BLOCK",
        reason: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      },
      1
    );
  }

  const platform = (ctx!.platform ?? "").toLowerCase().trim();
  const targetUrl = ctx!.target_post_url ?? "";
  const ageHours = ctx!.target_post_age_hours;
  const comment = ctx!.comment_text ?? "";
  const hubUrl = ctx!.hub_url ?? "";
  const previouslyCommented = ctx!.previously_commented_urls ?? [];

  // ── Gate 1: hub_url must be present in the comment ───────────────────────────
  if (!hubUrl) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          "hub_url not provided. A hijack comment without a hub link wastes the slot — the whole point is to drive traffic to the hub.",
        remediation: "Add hub_url field with the URL of your hub post.",
      },
      1
    );
  }

  if (!comment.includes(hubUrl)) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          "hub_url not found in comment_text. Hijack without the hub link drives no traffic.",
        remediation: `Include '${hubUrl}' in the comment body.`,
      },
      1
    );
  }

  // ── Gate 2: freshness window ─────────────────────────────────────────────────
  if (ageHours !== undefined && ageHours !== null) {
    const window = FRESHNESS_WINDOWS[platform] ?? DEFAULT_FRESHNESS;
    if (ageHours > window) {
      emit(
        {
          verdict: "BLOCK",
          reason: `Target post is ${ageHours}h old — past the ${window}h freshness window for ${platform || "this platform"}. Late comments get zero algorithm distribution.`,
          remediation:
            "Find a fresher post from the same person, or skip this hijack slot.",
        },
        1
      );
    }
  }

  // ── Gate 3: dedup ────────────────────────────────────────────────────────────
  if (targetUrl && previouslyCommented.includes(targetUrl)) {
    emit(
      {
        verdict: "BLOCK",
        reason: `Already commented on this post: ${targetUrl}. Duplicate comments look spammy.`,
        remediation:
          "Find a different post from this person to hijack, or skip.",
      },
      1
    );
  }

  // ── Gate 4: standalone_value — LLM semantic judge ────────────────────────────
  const judgeResult = await runLlmJudge(comment, hubUrl);
  const verdict = (judgeResult.verdict ?? "BLOCK").toUpperCase();

  if (verdict !== "PASS") {
    emit(
      {
        verdict: "BLOCK",
        gate: "standalone_value (LLM judge)",
        reason: judgeResult.reason ?? "LLM judge returned no reason.",
        remediation:
          judgeResult.fix ??
          "Rewrite comment to lead with genuine value before the hub link.",
      },
      1
    );
  }

  emit(
    {
      verdict: "PASS",
      platform,
      target_post_url: targetUrl,
      comment_length: comment.length,
      hub_url_present: true,
      standalone_value: "PASS (LLM judge)",
    },
    0
  );
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "BLOCK",
      reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(1);
});
