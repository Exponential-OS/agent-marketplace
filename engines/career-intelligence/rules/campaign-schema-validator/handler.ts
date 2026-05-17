#!/usr/bin/env bun
// handler.ts — campaign-schema-validator enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: validates campaign.json required fields and verifies all referenced files exist on disk.
// Checks required top-level fields, meta fields, review fields, and all file references.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "campaign-schema-validator";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const REQUIRED_TOP = ["meta", "source", "hub", "spokes", "assets", "comment_cascade", "review"];
const REQUIRED_META = ["id", "title", "ship_date", "folder", "status"];
const REQUIRED_REVIEW = [
  "content_reviewed",
  "assets_reviewed",
  "hashtags_reviewed",
  "formatting_reviewed",
  "name_tags_verified",
  "ready_to_publish",
];

interface AssetRef {
  file?: string;
  status?: string;
  [key: string]: unknown;
}

interface CampaignComponent {
  content_file?: string;
  asset?: AssetRef;
  id?: string;
  [key: string]: unknown;
}

interface Campaign {
  meta?: Record<string, unknown>;
  source?: CampaignComponent;
  hub?: CampaignComponent;
  spokes?: CampaignComponent[];
  assets?: Record<string, AssetRef>;
  comment_cascade?: CampaignComponent;
  review?: Record<string, unknown>;
  [key: string]: unknown;
}

interface InputCtx {
  campaign_file: string;
}

interface Output {
  verdict: "pass" | "block" | "warn";
  errors: string[];
  warnings: string[];
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

function collectFileRefs(campaign: Campaign, campaignDir: string): Array<{ label: string; absPath: string }> {
  const refs: Array<{ label: string; absPath: string }> = [];

  function resolve(relPath: string): string {
    return join(campaignDir, relPath);
  }

  if (campaign.source?.content_file) {
    refs.push({ label: "source.content_file", absPath: resolve(campaign.source.content_file) });
  }

  if (campaign.hub?.content_file) {
    refs.push({ label: "hub.content_file", absPath: resolve(campaign.hub.content_file) });
  }
  if (campaign.hub?.asset?.file) {
    refs.push({ label: "hub.asset.file", absPath: resolve(campaign.hub.asset.file) });
  }

  for (let i = 0; i < (campaign.spokes ?? []).length; i++) {
    const spoke = campaign.spokes![i];
    const sid = spoke.id ?? `spoke[${i}]`;
    if (spoke.content_file) {
      refs.push({ label: `${sid}.content_file`, absPath: resolve(spoke.content_file) });
    }
    if (spoke.asset?.file) {
      refs.push({ label: `${sid}.asset.file`, absPath: resolve(spoke.asset.file) });
    }
  }

  if (campaign.comment_cascade?.content_file) {
    refs.push({ label: "comment_cascade.content_file", absPath: resolve(campaign.comment_cascade.content_file) });
  }

  for (const [key, assetObj] of Object.entries(campaign.assets ?? {})) {
    if (typeof assetObj === "object" && assetObj.file) {
      // Only check existence if status is not "pending"
      if ((assetObj.status ?? "pending") !== "pending") {
        refs.push({ label: `assets.${key}.file`, absPath: resolve(assetObj.file) });
      }
    }
  }

  return refs;
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "warn", errors: [], warnings: [], message: "No input provided." }, 2);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "warn", errors: [], warnings: [], message: `Invalid JSON input: ${e instanceof Error ? e.message : String(e)}` }, 2);
  }

  const campaignFile = ctx.campaign_file ?? "";
  if (!campaignFile) {
    emit({ verdict: "warn", errors: [], warnings: [], message: "campaign_file is required." }, 2);
  }

  if (!existsSync(campaignFile)) {
    emit({ verdict: "warn", errors: [], warnings: [], message: `campaign.json not found: ${campaignFile}` }, 2);
  }

  let campaign: Campaign;
  try {
    campaign = JSON.parse(readFileSync(campaignFile, "utf-8")) as Campaign;
  } catch (e: unknown) {
    emit({ verdict: "warn", errors: [], warnings: [], message: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}` }, 2);
  }

  const campaignDir = campaignFile.substring(0, campaignFile.lastIndexOf("/")) || ".";
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required top-level fields
  for (const field of REQUIRED_TOP) {
    if (!(field in campaign)) {
      errors.push(`Missing required top-level field: '${field}'`);
    }
  }

  // Check required meta fields
  const meta = campaign.meta ?? {};
  for (const field of REQUIRED_META) {
    if (!(field in meta)) {
      errors.push(`Missing required meta.${field}`);
    }
  }

  // Check required review fields
  const review = campaign.review ?? {};
  for (const field of REQUIRED_REVIEW) {
    if (!(field in review)) {
      errors.push(`Missing required review.${field}`);
    }
  }

  // Check all file references exist
  const fileRefs = collectFileRefs(campaign, campaignDir);
  for (const { label, absPath } of fileRefs) {
    if (!existsSync(absPath)) {
      errors.push(`Referenced file not found: ${label}: ${absPath}`);
    }
  }

  // Warn if ready_to_publish=true but review sub-fields are false
  if (review.ready_to_publish === true) {
    const unreviewed = ["content_reviewed", "assets_reviewed", "hashtags_reviewed", "formatting_reviewed", "name_tags_verified"]
      .filter((f) => review[f] === false);
    if (unreviewed.length > 0) {
      warnings.push(
        `ready_to_publish=true but review fields are false: ${JSON.stringify(unreviewed)}. Possible data inconsistency.`
      );
    }
  }

  if (errors.length > 0) {
    emit({ verdict: "block", errors, warnings, message: `BLOCK — ${errors.length} schema/file error(s). Fix before distributing.` }, 1);
  }

  if (warnings.length > 0) {
    emit({ verdict: "warn", errors, warnings, message: `WARN — ${warnings.length} warning(s). Review before distributing.` }, 2);
  }

  emit({
    verdict: "pass",
    errors: [],
    warnings: [],
    message: `PASS — campaign.json valid. ${fileRefs.length} file reference(s) verified.`,
  }, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "block",
      errors: [`Uncaught: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
      message: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(1);
});
