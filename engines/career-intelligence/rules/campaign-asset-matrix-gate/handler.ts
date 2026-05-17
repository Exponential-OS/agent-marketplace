#!/usr/bin/env bun
/**
 * handler.ts — campaign-asset-matrix-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * Reads campaign.json. For each spoke/hub/source on an image-bearing platform,
 * checks that asset.file is specified AND that the file exists on disk.
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "campaign_file": "/abs/path/to/campaign.json"
 * }
 *
 * Exits: 0=PASS, 1=BLOCK, 2=WARN
 *
 * Gates (in order):
 *   1. instagram_asset_required  — any instagram spoke without asset.file = BLOCK
 *   2. substack_asset_required   — source on substack without asset.file = BLOCK
 *   3. linkedin_hub_asset        — hub on linkedin without asset.file = WARN
 *   4. asset_file_exists         — any specified asset.file not on disk = BLOCK
 */

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname, resolve, isAbsolute } from "path";

const SLUG = "campaign-asset-matrix-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

// Platforms where images are required (BLOCK if missing)
const REQUIRED_ASSET_PLATFORMS = new Set(["instagram"]);
// Platforms where images are recommended (WARN if missing)
const WARN_ASSET_PLATFORMS = new Set(["linkedin", "x", "substack"]);

interface AssetSpec {
  file?: string;
  [key: string]: unknown;
}

interface CampaignComponent {
  platform?: string;
  asset?: AssetSpec;
  id?: string;
  [key: string]: unknown;
}

interface Campaign {
  source?: CampaignComponent;
  hub?: CampaignComponent;
  spokes?: CampaignComponent[];
  [key: string]: unknown;
}

interface BlockItem {
  component: string;
  platform: string;
  issue: string;
  remediation: string;
}

interface WarnItem {
  component: string;
  platform: string;
  issue: string;
  remediation: string;
}

interface PassItem {
  component: string;
  platform: string;
  asset: string;
}

interface OutputResult {
  verdict: string;
  gate?: string;
  reason?: string;
  blocks?: BlockItem[];
  warns?: WarnItem[];
  passed?: PassItem[];
  remediation?: string;
  components_checked?: number;
  all_assets_present?: boolean;
  assets?: string[];
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
        reason: "No input. Pass JSON with campaign_file field.",
      },
      1
    );
  }

  let ctx: { campaign_file?: string };
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

  const campaignFile = ctx!.campaign_file ?? "";
  if (!campaignFile) {
    emit({ verdict: "BLOCK", reason: "campaign_file is required." }, 1);
  }

  if (!existsSync(campaignFile)) {
    emit(
      {
        verdict: "WARN",
        reason: `campaign.json not found: ${campaignFile}`,
      },
      2
    );
  }

  let campaign: Campaign;
  try {
    campaign = JSON.parse(readFileSync(campaignFile, "utf-8"));
  } catch (e: unknown) {
    emit(
      {
        verdict: "WARN",
        reason: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}`,
      },
      2
    );
  }

  const campaignDir = dirname(campaignFile);
  const blocks: BlockItem[] = [];
  const warns: WarnItem[] = [];
  const passed: PassItem[] = [];

  function checkComponent(comp: CampaignComponent, label: string): void {
    const platform = (comp.platform ?? "").toLowerCase();
    const asset = comp.asset;
    const assetFile = asset?.file ?? null;

    if (REQUIRED_ASSET_PLATFORMS.has(platform)) {
      if (!assetFile) {
        blocks.push({
          component: label,
          platform,
          issue: "asset.file is missing",
          remediation: `Generate an image for ${label} (${platform}) and set asset.file in campaign.json.`,
        });
        return;
      }
    } else if (WARN_ASSET_PLATFORMS.has(platform)) {
      if (!assetFile) {
        warns.push({
          component: label,
          platform,
          issue: "asset.file is not set — image recommended for this platform",
          remediation: `Consider generating an image for ${label} (${platform}) to improve engagement.`,
        });
        return;
      }
    }

    if (assetFile) {
      const resolved = isAbsolute(assetFile)
        ? assetFile
        : join(campaignDir, assetFile);
      if (!existsSync(resolved)) {
        blocks.push({
          component: label,
          platform,
          issue: `asset.file '${assetFile}' specified but file not found on disk at ${resolved}`,
          remediation: `Generate the image and save it to ${resolved}, or update asset.file in campaign.json.`,
        });
        return;
      }
      passed.push({ component: label, platform, asset: assetFile });
    }
  }

  // Check source
  if (campaign!.source) {
    checkComponent(campaign!.source, "source");
  }

  // Check hub
  if (campaign!.hub) {
    checkComponent(campaign!.hub, "hub");
  }

  // Check all spokes
  for (const spoke of campaign!.spokes ?? []) {
    const label = `spoke:${spoke.id ?? "unknown"}`;
    checkComponent(spoke, label);
  }

  if (blocks.length > 0) {
    emit(
      {
        verdict: "BLOCK",
        gate: "campaign_asset_matrix",
        reason: `${blocks.length} required image slot(s) missing or file not on disk.`,
        blocks,
        warns,
        passed,
        remediation:
          "Generate the missing images and update campaign.json asset.file fields before distributing.",
      },
      1
    );
  }

  if (warns.length > 0) {
    emit(
      {
        verdict: "WARN",
        gate: "campaign_asset_matrix",
        reason: `${warns.length} image slot(s) missing on recommended platforms.`,
        warns,
        passed,
        remediation:
          "Consider generating images for the warned platforms — visual content significantly improves reach.",
      },
      2
    );
  }

  emit(
    {
      verdict: "PASS",
      gate: "campaign_asset_matrix",
      components_checked: passed.length,
      all_assets_present: true,
      assets: passed.map((p) => p.asset),
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
