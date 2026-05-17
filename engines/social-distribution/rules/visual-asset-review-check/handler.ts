#!/usr/bin/env bun
// handler.ts — visual-asset-review-check enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: blocks distribution if any image-bearing spoke lacks a completed visual review.
// Ground Zero VISUAL-ASSET REVIEW INVARIANT: no image ships unreviewed.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "visual-asset-review-check";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

interface AssetRef {
  file: string;
  [key: string]: unknown;
}

interface CampaignComponent {
  asset?: AssetRef | null;
  platform?: string;
  type?: string;
  id?: string;
  [key: string]: unknown;
}

interface Campaign {
  source?: CampaignComponent;
  hub?: CampaignComponent;
  spokes?: CampaignComponent[];
  review?: {
    assets_reviewed?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface InputCtx {
  campaign_file: string;
}

interface ImageBearingEntry {
  id: string;
  platform: string;
  type?: string;
  asset: string;
}

interface Output {
  verdict: "pass" | "block" | "warn";
  image_bearing_spokes: ImageBearingEntry[];
  assets_reviewed: boolean | null;
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

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "warn", image_bearing_spokes: [], assets_reviewed: null, message: "No input provided." }, 2);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "block", image_bearing_spokes: [], assets_reviewed: null, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 1);
  }

  const campaignFile = ctx.campaign_file ?? "";
  if (!campaignFile) {
    emit({ verdict: "warn", image_bearing_spokes: [], assets_reviewed: null, message: "campaign_file is required." }, 2);
  }

  if (!existsSync(campaignFile)) {
    emit({ verdict: "warn", image_bearing_spokes: [], assets_reviewed: null, message: `campaign.json not found: ${campaignFile}` }, 2);
  }

  let campaign: Campaign;
  try {
    campaign = JSON.parse(readFileSync(campaignFile, "utf-8")) as Campaign;
  } catch (e: unknown) {
    emit({ verdict: "warn", image_bearing_spokes: [], assets_reviewed: null, message: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}` }, 2);
  }

  // Find all image-bearing components
  const imageBearing: ImageBearingEntry[] = [];

  const source = campaign.source ?? {};
  if (source.asset?.file) {
    imageBearing.push({
      id: "source",
      platform: (source.platform as string) ?? "substack",
      asset: source.asset.file,
    });
  }

  const hub = campaign.hub ?? {};
  if (hub.asset?.file) {
    imageBearing.push({
      id: "hub",
      platform: (hub.platform as string) ?? "linkedin",
      type: (hub.type as string) ?? "article",
      asset: hub.asset.file,
    });
  }

  for (const spoke of campaign.spokes ?? []) {
    if (spoke.asset?.file) {
      imageBearing.push({
        id: (spoke.id as string) ?? "unknown",
        platform: (spoke.platform as string) ?? "unknown",
        asset: spoke.asset.file,
      });
    }
  }

  if (imageBearing.length === 0) {
    emit({
      verdict: "pass",
      image_bearing_spokes: [],
      assets_reviewed: null,
      message: "PASS — No image-bearing components in campaign. Visual review not required.",
    }, 0);
  }

  // Check review status
  const review = campaign.review ?? {};
  const assetsReviewed = review.assets_reviewed ?? false;

  if (!assetsReviewed) {
    const spokeIds = imageBearing.map((c) => c.id);
    emit({
      verdict: "block",
      image_bearing_spokes: imageBearing,
      assets_reviewed: false,
      message:
        `BLOCK — ${imageBearing.length} image-bearing component(s) found but assets_reviewed=false. ` +
        `A vision-capable reviewer must inspect each asset at full resolution before ship. ` +
        `Components: ${JSON.stringify(spokeIds)}. ` +
        `After review: set campaign.review.assets_reviewed=true.`,
    }, 1);
  }

  emit({
    verdict: "pass",
    image_bearing_spokes: imageBearing,
    assets_reviewed: true,
    message: `PASS — ${imageBearing.length} image-bearing component(s) verified (assets_reviewed=true).`,
  }, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "block",
      image_bearing_spokes: [],
      assets_reviewed: null,
      message: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(1);
});
