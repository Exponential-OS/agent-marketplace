#!/usr/bin/env bun
// handler.ts — content-url-resolution-check enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: blocks distribution if any content file in a campaign contains unresolved URL tokens.
// Tokens like [PART-3-URL], [ARTICLE-URL], [PASTE-URL-HERE] must be resolved before ship.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "content-url-resolution-check";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// Patterns that indicate an unresolved URL/link placeholder
const TOKEN_PATTERNS: RegExp[] = [
  /\[([A-Z0-9][A-Z0-9_-]*(?:URL|LINK|HREF|PART|ARTICLE|HUB|PASTE)[A-Z0-9_-]*)\]/g,
  /\[PASTE [A-Z].*?\]/g,
  /\[INSERT [A-Z].*?\]/g,
  /\[ADD [A-Z].*? HERE\]/g,
];

interface CampaignComponent {
  content_file?: string;
  [key: string]: unknown;
}

interface CommentCascade {
  content_file?: string;
  [key: string]: unknown;
}

interface Campaign {
  source?: CampaignComponent;
  hub?: CampaignComponent;
  spokes?: CampaignComponent[];
  comment_cascade?: CommentCascade;
  [key: string]: unknown;
}

interface InputCtx {
  campaign_file: string;
  career_os_home?: string;
}

interface Violation {
  file: string;
  tokens: string[];
}

interface Output {
  verdict: "pass" | "block" | "warn";
  unresolved: Violation[];
  message: string;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rec = { ts, rule_slug: SLUG, ...extra };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n");
  } catch {
    /* fail-open */
  }
}

function emit(output: Output, exitCode: number): never {
  process.stdout.write(JSON.stringify(output) + "\n");
  log({ verdict: output.verdict, fired: true });
  process.exit(exitCode);
}

function findTokens(text: string): string[] {
  const found: string[] = [];
  for (const pat of TOKEN_PATTERNS) {
    // Reset lastIndex for global patterns
    pat.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pat.exec(text)) !== null) {
      found.push(match[0]);
    }
    pat.lastIndex = 0;
  }
  // Deduplicate, preserve order
  return [...new Map(found.map((t) => [t, t])).values()];
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "warn", unresolved: [], message: "No input provided." }, 2);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "block", unresolved: [], message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 1);
  }

  const campaignFile = ctx.campaign_file ?? "";
  if (!campaignFile) {
    emit({ verdict: "warn", unresolved: [], message: "campaign_file is required." }, 2);
  }

  if (!existsSync(campaignFile)) {
    emit({ verdict: "warn", unresolved: [], message: `campaign.json not found: ${campaignFile}` }, 2);
  }

  let campaign: Campaign;
  try {
    campaign = JSON.parse(readFileSync(campaignFile, "utf-8")) as Campaign;
  } catch (e: unknown) {
    emit({ verdict: "warn", unresolved: [], message: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}` }, 2);
  }

  // Campaign dir is the directory containing campaign.json
  const campaignDir = campaignFile.substring(0, campaignFile.lastIndexOf("/")) || ".";

  // Collect all content_file references from the campaign
  const contentFiles: string[] = [];

  if (campaign.source?.content_file) contentFiles.push(campaign.source.content_file);
  if (campaign.hub?.content_file) contentFiles.push(campaign.hub.content_file);
  for (const spoke of campaign.spokes ?? []) {
    if (spoke.content_file) contentFiles.push(spoke.content_file as string);
  }
  if (campaign.comment_cascade?.content_file) contentFiles.push(campaign.comment_cascade.content_file);

  if (contentFiles.length === 0) {
    emit({ verdict: "warn", unresolved: [], message: "No content_file references found in campaign.json." }, 2);
  }

  // Check each content file for unresolved tokens
  const violations: Violation[] = [];
  const missingFiles: string[] = [];

  for (const relPath of contentFiles) {
    // Content files are relative to campaign directory
    const absPath = join(campaignDir, relPath);
    if (!existsSync(absPath)) {
      missingFiles.push(relPath);
      continue;
    }

    let text: string;
    try {
      text = readFileSync(absPath, "utf-8");
    } catch {
      missingFiles.push(relPath);
      continue;
    }

    const tokens = findTokens(text);
    if (tokens.length > 0) {
      violations.push({ file: relPath, tokens });
    }
  }

  if (violations.length > 0) {
    const tokenSummary = violations
      .map((v) => `${v.file}: ${v.tokens.join(", ")}`)
      .join("; ");
    emit({
      verdict: "block",
      unresolved: violations,
      message:
        `BLOCK — ${violations.length} content file(s) contain unresolved URL tokens. ` +
        `Resolve before distributing. ${tokenSummary}`,
    }, 1);
  }

  if (missingFiles.length > 0) {
    emit({
      verdict: "warn",
      unresolved: [],
      message: `WARN — ${missingFiles.length} content file(s) referenced in campaign.json not found on disk: ${missingFiles.join(", ")}`,
    }, 2);
  }

  emit({
    verdict: "pass",
    unresolved: [],
    message: `PASS — All ${contentFiles.length} content files scanned. No unresolved tokens found.`,
  }, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "block",
      unresolved: [],
      message: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(1);
});
