#!/usr/bin/env bun
/**
 * handler.ts — linkedin-post-on-article-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * LinkedIn hub posts sharing an Article must:
 *   - Have NO external links in the post body (algorithm penalty)
 *   - Reference the Article via a within-platform URL (linkedin.com/pulse/)
 *   - Have no placeholder tokens
 *   - Have a visible hook in the first line
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "platform": "linkedin_post",
 *   "post_body": "...",
 *   "article_url": "https://www.linkedin.com/pulse/...",   // optional
 *   "first_comment": "..."                                  // optional, for context
 * }
 *
 * Exits: 0=PASS, 1=BLOCK, 2=WARN
 *
 * Gates (in order):
 *   1. external_link_in_body  — any non-linkedin.com URL in body = BLOCK
 *   2. article_url_format     — article_url must be linkedin.com/pulse/ if provided = BLOCK
 *   3. placeholder_in_post    — REPLACE_ tokens in body = BLOCK
 *   4. hook_visibility        — first line < 10 chars = WARN
 */

import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SLUG = "linkedin-post-on-article-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

const URL_RE = /https?:\/\/[^\s)"']+/g;
const LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com/;
const LNKD_RE = /^https?:\/\/lnkd\.in/;
const PULSE_RE = /^https?:\/\/(www\.)?linkedin\.com\/pulse\//;
const PLACEHOLDER_RE = /REPLACE_WITH_\w+/;

interface InputContext {
  platform?: string;
  post_body?: string;
  article_url?: string;
  first_comment?: string;
}

interface OutputResult {
  verdict: string;
  gate?: string;
  reason?: string;
  remediation?: string;
  platform?: string;
  external_links_in_body?: number;
  article_url_valid?: boolean;
  placeholder_clean?: boolean;
  hook_visible?: boolean;
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
    emit(
      {
        verdict: "BLOCK",
        reason:
          "No input. Pass JSON with post_body/article_url fields.",
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

  const postBody = ctx!.post_body ?? "";
  const articleUrl = ctx!.article_url ?? "";

  // ── Gate 1: external_link_in_body ──────────────────────────────────────────
  const urlsInBody = postBody.match(URL_RE) ?? [];
  const externalUrls = urlsInBody.filter(
    (u) => !LINKEDIN_RE.test(u) && !LNKD_RE.test(u)
  );
  if (externalUrls.length > 0) {
    const offender = externalUrls[0];
    emit(
      {
        verdict: "BLOCK",
        gate: "external_link_in_body",
        reason: `External link found in post body: '${offender}'. LinkedIn suppresses posts with external URLs.`,
        remediation: `Move '${offender}' (and all other external links) to the first comment. Post body must contain only linkedin.com or lnkd.in URLs.`,
      },
      1
    );
  }

  // ── Gate 2: article_url_format ────────────────────────────────────────────
  if (articleUrl && !PULSE_RE.test(articleUrl)) {
    emit(
      {
        verdict: "BLOCK",
        gate: "article_url_format",
        reason: `article_url '${articleUrl}' is not a within-platform LinkedIn Article URL. Hub posts must link to LinkedIn Articles (linkedin.com/pulse/), not external URLs.`,
        remediation:
          "Publish the article on LinkedIn first, then use the resulting linkedin.com/pulse/ URL here. LinkedIn Articles can embed links in body — external platforms cannot.",
      },
      1
    );
  }

  // ── Gate 3: placeholder_in_post ───────────────────────────────────────────
  const placeholderMatch = postBody.match(PLACEHOLDER_RE);
  if (placeholderMatch) {
    emit(
      {
        verdict: "BLOCK",
        gate: "placeholder_in_post",
        reason: `Unresolved placeholder '${placeholderMatch[0]}' found in post body.`,
        remediation: `Replace '${placeholderMatch[0]}' with the real URL or text. Search the full post body for any remaining REPLACE_ tokens.`,
      },
      1
    );
  }

  // ── Gate 4: hook_visibility — WARN not BLOCK ──────────────────────────────
  const firstLine = postBody.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine.length < 10) {
    emit(
      {
        verdict: "WARN",
        gate: "hook_visibility",
        reason: `First line is only ${firstLine.length} characters. LinkedIn shows the first ~2 lines before 'see more' — a weak first line loses readers before they click.`,
        remediation:
          "Start with a strong hook of at least 10 characters. Lead with the tension or the specific claim.",
      },
      2
    );
  }

  emit(
    {
      verdict: "PASS",
      platform: "linkedin_post",
      external_links_in_body: 0,
      article_url_valid: Boolean(articleUrl),
      placeholder_clean: true,
      hook_visible: true,
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
