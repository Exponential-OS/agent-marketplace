#!/usr/bin/env bun
// handler.ts — analytics-sync-watch enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: WARN-only gate that fires if a campaign is 7+ days post-ship with no analytics recorded.
// Publishing is not blocked — but warns the human to record metrics before window closes.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "analytics-sync-watch";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LIVE_STATUSES = new Set(["published", "live", "sent"]);
const DEFAULT_STALE_DAYS = 7;

interface CampaignComponent {
  status?: string;
  [key: string]: unknown;
}

interface Campaign {
  source?: CampaignComponent;
  hub?: CampaignComponent;
  spokes?: CampaignComponent[];
  analytics?: Record<string, unknown> | null;
  meta?: {
    id?: string;
    ship_date?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface InputCtx {
  campaign_file: string;
  stale_days?: number;
}

interface Output {
  verdict: "pass" | "warn";
  days_since_ship: number | null;
  has_analytics: boolean;
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

function isPublished(campaign: Campaign): boolean {
  if (LIVE_STATUSES.has((campaign.source?.status ?? "").toLowerCase())) return true;
  if (LIVE_STATUSES.has((campaign.hub?.status ?? "").toLowerCase())) return true;
  for (const spoke of campaign.spokes ?? []) {
    if (LIVE_STATUSES.has((spoke.status ?? "").toLowerCase())) return true;
  }
  return false;
}

function hasAnalytics(campaign: Campaign): boolean {
  const analytics = campaign.analytics;
  if (!analytics) return false;
  if (typeof analytics === "object") {
    return Object.values(analytics).some((v) => v !== null);
  }
  return false;
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "pass", days_since_ship: null, has_analytics: false, message: "No input. Defaulting to pass." }, 0);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "pass", days_since_ship: null, has_analytics: false, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 0);
  }

  const campaignFile = ctx.campaign_file ?? "";
  const staleDays = Number(ctx.stale_days ?? DEFAULT_STALE_DAYS);

  if (!campaignFile) {
    emit({ verdict: "pass", days_since_ship: null, has_analytics: false, message: "No campaign_file. Defaulting to pass." }, 0);
  }

  if (!existsSync(campaignFile)) {
    emit({ verdict: "pass", days_since_ship: null, has_analytics: false, message: `campaign.json not found: ${campaignFile}` }, 0);
  }

  let campaign: Campaign;
  try {
    campaign = JSON.parse(readFileSync(campaignFile, "utf-8")) as Campaign;
  } catch (e: unknown) {
    emit({ verdict: "pass", days_since_ship: null, has_analytics: false, message: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}` }, 0);
  }

  if (!isPublished(campaign)) {
    emit({ verdict: "pass", days_since_ship: null, has_analytics: false, message: "PASS — Campaign not yet published. Analytics monitoring starts after ship." }, 0);
  }

  const analyticsPresent = hasAnalytics(campaign);
  if (analyticsPresent) {
    emit({ verdict: "pass", days_since_ship: null, has_analytics: true, message: "PASS — Campaign published and analytics data present." }, 0);
  }

  const shipDateStr = campaign.meta?.ship_date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let daysSinceShip: number | null = null;

  if (shipDateStr) {
    try {
      const shipDate = new Date(String(shipDateStr));
      shipDate.setHours(0, 0, 0, 0);
      if (!isNaN(shipDate.getTime())) {
        daysSinceShip = Math.floor((today.getTime() - shipDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    } catch {
      // ignore parse error — daysSinceShip stays null
    }
  }

  if (daysSinceShip !== null && daysSinceShip >= staleDays) {
    const campaignId = campaign.meta?.id ?? campaignFile.split("/").slice(-2, -1)[0] ?? "unknown";
    emit({
      verdict: "warn",
      days_since_ship: daysSinceShip,
      has_analytics: false,
      message:
        `WARN — '${campaignId}' published ${daysSinceShip} days ago but has no analytics data. ` +
        `Record impressions/reactions/comments/shares in campaign.analytics before the engagement window closes.`,
    }, 2);
  }

  emit({
    verdict: "pass",
    days_since_ship: daysSinceShip,
    has_analytics: false,
    message: `PASS — Campaign published ${daysSinceShip ?? 0} days ago. Analytics window still open (${staleDays - (daysSinceShip ?? 0)} days remaining).`,
  }, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "pass",
      days_since_ship: null,
      has_analytics: false,
      message: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(0);
});
