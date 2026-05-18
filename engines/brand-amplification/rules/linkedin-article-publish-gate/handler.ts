#!/usr/bin/env bun
/**
 * handler.ts — linkedin-article-publish-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * LinkedIn Articles are within-platform (linkedin.com/pulse/) and allow links in body.
 * This gate fires BEFORE publishing to verify the article is complete and correct.
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "platform": "linkedin_article",
 *   "article_title": "...",
 *   "article_content": "...",     // full article text
 *   "article_excerpt": "...",     // first ~500 chars for LLM judge (falls back to first 500 of content)
 *   "char_count": 5000
 * }
 *
 * Exits: 0=PASS, 1=BLOCK, 2=WARN
 *
 * Gates (in order):
 *   1. placeholder_block  — any REPLACE_ token or unresolved (coming soon)/(#) link = BLOCK
 *   2. backlink_check     — no linkedin.com/pulse/ or linkedin.com/posts/ in body = WARN
 *   3. cta_check          — no Substack URL or Co-Dialectic GitHub link = BLOCK
 *   4. quality            — LLM judge via PROMPT.md + claude -p on article_excerpt
 */

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "linkedin-article-publish-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(SCRIPT_DIR, "PROMPT.md");

function loadHoneyPotDomain(): string {
  // Load customer-configured honey-pot domain from $CAREER_HOME/brain/social-distribution-engine/brand-spec.json.
  // Falls back to "substack.com" (generic platform) if not set.
  const careerHome = process.env.CAREER_HOME ?? process.env.CAREER_OS_HOME;
  if (!careerHome) return "substack.com";
  const specPath = join(careerHome.replace(/^~/, homedir()), "brain", "social-distribution-engine", "brand-spec.json");
  try {
    if (existsSync(specPath)) {
      const spec = JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
      const domain = spec["honey_pot_domain"];
      if (typeof domain === "string" && domain.length > 0) return domain;
    }
  } catch {
    /* fall through to default */
  }
  return "substack.com";
}

const HONEY_POT_DOMAIN = loadHoneyPotDomain();
const HONEY_POT_PATTERN = new RegExp(HONEY_POT_DOMAIN.replace(/\./g, "\\."), "i");

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /REPLACE_WITH_\w+/,
  /\[Part\s+\d[^\]]*\]\(#\)/,       // [Part N →](#) — unresolved anchor
  /\[Part\s+\d[^\]]*\]\(\s*\)/,     // [Part N →]() — empty href
  /\(coming\s+soon\)/i,             // (coming soon) in part nav
];

const BACKLINK_PATTERNS: RegExp[] = [
  /linkedin\.com\/pulse\//i,
  /linkedin\.com\/posts\//i,
];

const CTA_PATTERNS: RegExp[] = [
  /substack\.com/i,
  HONEY_POT_PATTERN, // customer-configured honey-pot domain
  /github\.com\/Exponential-OS/i,
];

interface InputContext {
  platform?: string;
  article_title?: string;
  article_content?: string;
  article_excerpt?: string;
  char_count?: number;
}

interface OutputResult {
  verdict: string;
  gate?: string;
  reason?: string;
  remediation?: string;
  platform?: string;
  article_title?: string;
  char_count?: number;
  has_backlink?: boolean;
  has_cta?: boolean;
  quality?: string;
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
  excerpt: string
): Promise<{ verdict: string; reason?: string; fix?: string }> {
  if (process.env["SKIP_LLM_JUDGES"] === "1") {
    return { verdict: "PASS", reason: "SKIP_LLM_JUDGES=1 — judge bypassed for CI" };
  }

  if (!existsSync(PROMPT_PATH)) {
    return {
      verdict: "BLOCK",
      reason: `PROMPT.md not found at ${PROMPT_PATH}`,
      fix: `Ensure ${PROMPT_PATH} exists.`,
    };
  }

  const promptTemplate = readFileSync(PROMPT_PATH, "utf-8");
  const prompt = promptTemplate.replace("{EXCERPT}", excerpt.trim());

  for (const cli of ["claude", "gemini", "codex"]) {
    try {
      const proc = Bun.spawn([cli, "-p", prompt], {
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
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // Try next CLI
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("ENOENT") && !msg.includes("not found")) {
        // Unexpected error — try next
      }
    }
  }

  return {
    verdict: "BLOCK",
    reason: "All LLM judges unavailable or timed out.",
    fix: "Install claude CLI or set SKIP_LLM_JUDGES=1 for CI.",
  };
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
          "No input. Pass JSON with article_title/article_content/article_excerpt/char_count fields.",
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

  const content = ctx!.article_content ?? "";
  const excerpt = ctx!.article_excerpt || content.slice(0, 500);
  const title = ctx!.article_title ?? "";

  // ── Gate 1: placeholder_block ────────────────────────────────────────────────
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      emit(
        {
          verdict: "BLOCK",
          gate: "placeholder_block",
          reason: `Unresolved placeholder found: '${match[0]}'. Article contains tokens that must be replaced before publishing.`,
          remediation: `Replace all '${match[0]}' tokens with real URLs or remove them. Search the full article for any remaining REPLACE_ tokens.`,
        },
        1
      );
    }
  }

  // ── Gate 2: backlink_check — WARN not BLOCK ──────────────────────────────────
  const hasBacklink = BACKLINK_PATTERNS.some((p) => p.test(content));
  if (!hasBacklink) {
    emit(
      {
        verdict: "WARN",
        gate: "backlink_check",
        reason:
          "No back-link to a prior LinkedIn post or article found in the body. Back-links to prior campaign posts help readers navigate the series and resurface older content.",
        remediation:
          "Add a reference link to the previous campaign's LinkedIn post or article. Even a single mention helps the algorithm chain content.",
      },
      2
    );
  }

  // ── Gate 3: cta_check ────────────────────────────────────────────────────────
  const hasCta = CTA_PATTERNS.some((p) => p.test(content));
  if (!hasCta) {
    emit(
      {
        verdict: "BLOCK",
        gate: "cta_check",
        reason:
          "No CTA found. Article must include at least one of: Substack URL (substack.com or your honey-pot) OR Co-Dialectic install link (github.com/Exponential-OS).",
        remediation:
          "Add a CTA section before the closing. Include either the Substack link for the full piece or the Co-Dialectic install link to drive action.",
      },
      1
    );
  }

  // ── Gate 4: quality — LLM judge ─────────────────────────────────────────────
  if (!excerpt) {
    emit(
      {
        verdict: "BLOCK",
        gate: "quality",
        reason:
          "article_excerpt is empty and article_content is also empty. Cannot run quality judge.",
        remediation:
          "Pass at least the first 500 characters of the article body as article_content.",
      },
      1
    );
  }

  const judgeResult = await runLlmJudge(excerpt);
  const verdict = (judgeResult.verdict ?? "BLOCK").toUpperCase();

  if (verdict !== "PASS") {
    emit(
      {
        verdict: "BLOCK",
        gate: "quality (LLM judge)",
        reason: judgeResult.reason ?? "LLM judge returned no reason.",
        remediation:
          judgeResult.fix ??
          "Rewrite the opening paragraph to hook the reader immediately.",
      },
      1
    );
  }

  emit(
    {
      verdict: "PASS",
      platform: "linkedin_article",
      article_title: title,
      char_count: ctx!.char_count ?? content.length,
      has_backlink: hasBacklink,
      has_cta: hasCta,
      quality: "PASS (LLM judge)",
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
