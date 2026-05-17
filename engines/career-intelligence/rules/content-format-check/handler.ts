#!/usr/bin/env bun
/**
 * handler.ts — content-format-check enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * Platform-aware content formatting validator.
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "text": "...",
 *   "platform": "substack|linkedin|twitter|reddit|instagram"
 * }
 *
 * Exit 0=PASS, 1=BLOCK, 2=WARN
 */

import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SLUG = "content-format-check";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

const VALID_PLATFORMS = new Set(["substack", "linkedin", "twitter", "reddit", "instagram"]);

interface InputContext {
  text?: string;
  platform?: string;
}

interface OutputResult {
  verdict: string;
  reason: string;
  warnings?: string[];
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

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw =
    argVal === undefined || argVal === "-"
      ? (await Bun.stdin.text()).trim()
      : argVal;

  if (!raw) {
    emit({ verdict: "BLOCK", reason: "No input provided." }, 1);
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

  const text = ctx!.text ?? "";
  const platform = (ctx!.platform ?? "").toLowerCase();

  if (!text) {
    emit({ verdict: "BLOCK", reason: "No text provided" }, 1);
  }

  if (platform && !VALID_PLATFORMS.has(platform)) {
    emit(
      {
        verdict: "BLOCK",
        reason: `Unknown platform '${platform}'. Valid: ${[...VALID_PLATFORMS].sort().join(", ")}`,
      },
      1
    );
  }

  const violations: string[] = [];
  const warnings: string[] = [];

  // ── Universal checks (all platforms) ────────────────────────────────────────

  // Double spaces (two+ consecutive spaces not at start of line)
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trimStart();
    if (stripped.includes("  ")) {
      violations.push(`Line ${i + 1}: double space detected → "${line.slice(0, 80)}"`);
    }
  }

  // Trailing whitespace
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== line.trimEnd()) {
      violations.push(`Line ${i + 1}: trailing whitespace`);
    }
  }

  // More than 2 consecutive blank lines
  if (/\n{4,}/.test(text)) {
    violations.push("3+ consecutive blank lines (max 2 between sections)");
  }

  // ── Platform-specific checks ─────────────────────────────────────────────────

  if (platform === "substack") {
    // Only one H1 allowed (the title — don't repeat it in body)
    const h1Matches = text.match(/^# .+/gm) ?? [];
    if (h1Matches.length > 1) {
      violations.push(
        `Multiple H1 headers (${h1Matches.length} found) — Substack only needs one title`
      );
    }

    // H4+ headers look bad in Substack's renderer
    if (/^#{4,} /m.test(text)) {
      violations.push("H4+ headers used — Substack renders poorly below H3");
    }

    // Long paragraphs without breaks (readability)
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const p of paragraphs) {
      const wordCount = p.split(/\s+/).length;
      if (wordCount > 150) {
        const preview = p.split(/\s+/).slice(0, 12).join(" ");
        warnings.push(`Long paragraph (${wordCount} words, no break): "${preview}..."`);
      }
    }

    // Substack supports markdown — check for bad HTML tags
    if (/<[a-zA-Z]+[^>]*>/.test(text)) {
      warnings.push("Raw HTML tags found — may not render in Substack");
    }
  } else if (platform === "linkedin") {
    // External links in body get suppressed by LinkedIn algorithm
    const urlsInBody = text.match(/https?:\/\/\S+/g) ?? [];
    if (urlsInBody.length > 0) {
      violations.push(
        `External URL(s) in post body — LinkedIn suppresses reach. ` +
          `Move to first comment: ${urlsInBody.slice(0, 3).join(", ")}`
      );
    }

    // LinkedIn renders markdown headers as plain text (bad look)
    if (/^#{1,6} /m.test(text)) {
      violations.push(
        "Markdown headers (# ##) in LinkedIn post — rendered as plain text, looks broken"
      );
    }

    // LinkedIn character limit: 3,000 for posts, 700 for articles preview
    const charCount = text.length;
    if (charCount > 3000) {
      violations.push(`LinkedIn post exceeds 3,000 characters (${charCount} chars)`);
    } else if (charCount > 2800) {
      warnings.push(`LinkedIn post near 3,000-char limit (${charCount}/3000)`);
    }

    // Emoji clusters (3+ consecutive emoji-like unicode — often used as visual noise)
    if (/[\u{1F300}-\u{1FAFF}]{3,}/u.test(text)) {
      warnings.push(
        "3+ consecutive emoji — consider reducing for professional LinkedIn posts"
      );
    }
  } else if (platform === "twitter") {
    // Split on thread separator conventions
    const tweets = text.split(/\n---+\n|\n\d+\/\d+\n|\n\d+\.\n/);
    if (tweets.length === 1) {
      // Single tweet check
      if (text.length > 280) {
        violations.push(`Tweet exceeds 280 characters (${text.length} chars)`);
      }
    } else {
      // Thread check
      for (let i = 0; i < tweets.length; i++) {
        const tweet = tweets[i].trim();
        if (tweet.length > 280) {
          violations.push(
            `Tweet ${i + 1} exceeds 280 characters (${tweet.length} chars): "${tweet.slice(0, 60)}..."`
          );
        }
      }
    }

    // Links count as 23 characters on Twitter (t.co wrap)
    const urls = text.match(/https?:\/\/\S+/g) ?? [];
    if (urls.length > 0) {
      warnings.push(
        `${urls.length} URL(s) found — each counts as ~23 chars on X regardless of length`
      );
    }
  } else if (platform === "reddit") {
    // Reddit renders markdown — check for common issues
    // Broken tables (pipes without proper header separator)
    const tableRows = lines.filter((l) => /^\s*\|.*\|/.test(l));
    if (tableRows.length > 0) {
      const hasSeparator = tableRows.some((l) => /^\s*\|[-| :]+\|/.test(l));
      if (!hasSeparator) {
        violations.push(
          "Table rows found but no separator row (|---|---| required for Reddit markdown tables)"
        );
      }
    }

    // Reddit post title limit hint
    const charCount = text.length;
    if (charCount > 40000) {
      violations.push(`Reddit post body exceeds 40,000 characters (${charCount})`);
    } else if (charCount > 10000) {
      warnings.push(`Long Reddit post (${charCount} chars) — consider a TL;DR at top`);
    }
  } else if (platform === "instagram") {
    // No clickable links in Instagram post body
    const urls = text.match(/https?:\/\/\S+/g) ?? [];
    if (urls.length > 0) {
      violations.push(
        `Links in Instagram post body are NOT clickable — remove or note 'link in bio': ${urls.slice(0, 3).join(", ")}`
      );
    }

    // Instagram character limit: 2,200
    const charCount = text.length;
    if (charCount > 2200) {
      violations.push(`Instagram caption exceeds 2,200 characters (${charCount} chars)`);
    } else if (charCount > 2000) {
      warnings.push(`Instagram caption near 2,200-char limit (${charCount}/2200)`);
    }

    // Hashtags: warn if mixed into body (best practice: cluster at end or first comment)
    const bodyHashtags = text.split(/\s+/).filter((w) => w.startsWith("#"));
    if (bodyHashtags.length > 0) {
      const last200 = text.slice(-200);
      const bodyOnlyTags = bodyHashtags.filter((t) => !last200.includes(t));
      if (bodyOnlyTags.length > 0) {
        warnings.push(
          `Hashtags mixed into body text — best practice is to cluster at end or first comment: ${bodyOnlyTags.slice(0, 5).join(", ")}`
        );
      }
    }
  }

  // ── Result ───────────────────────────────────────────────────────────────────
  if (violations.length > 0) {
    emit(
      { verdict: "BLOCK", reason: violations.join("; "), warnings },
      1
    );
  } else if (warnings.length > 0) {
    emit(
      { verdict: "WARN", reason: warnings.join("; ") },
      2
    );
  } else {
    const platLabel = platform ? ` [${platform}]` : "";
    emit(
      { verdict: "PASS", reason: `No formatting issues detected${platLabel}` },
      0
    );
  }
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
