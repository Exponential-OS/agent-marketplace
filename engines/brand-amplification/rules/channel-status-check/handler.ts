#!/usr/bin/env bun
// handler.ts — channel-status-check enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: blocks distribution to BANNED or Low ROI channels.
// Reads social-channel-directory.md and checks every spoke in campaign.json against it.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "channel-status-check";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CAREER_HOME = process.env.CAREER_HOME ?? process.env.CAREER_OS_HOME ?? null;
const DEFAULT_CHANNEL_DIR = CAREER_HOME ? join(CAREER_HOME, "brain/social-distribution-engine/social-channel-directory.md") : null;

interface Spoke {
  id?: string;
  platform?: string;
  subreddits?: string[];
  [key: string]: unknown;
}

interface Campaign {
  spokes?: Spoke[];
  [key: string]: unknown;
}

interface InputCtx {
  campaign_file: string;
  channel_dir_file?: string;
}

interface ChannelHit {
  spoke_id: string;
  channel: string;
  type: string;
  reason: string;
}

interface Output {
  verdict: "pass" | "block" | "warn";
  banned: ChannelHit[];
  low_roi: ChannelHit[];
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

function parseChannelDirectory(mdText: string): { banned: Set<string>; lowRoi: Set<string> } {
  const banned = new Set<string>();
  const lowRoi = new Set<string>();

  for (const line of mdText.split("\n")) {
    if (!line.includes("|")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cols.length < 4) continue;

    const channelCol = cols[0].toLowerCase();
    const rowText = line.toLowerCase();
    const isBanned = rowText.includes("banned");
    const isLowRoi = rowText.includes("low roi") || rowText.includes("low-roi");

    if (!isBanned && !isLowRoi) continue;

    // Normalize: strip "r/" prefix for subreddits
    const name = channelCol.startsWith("r/") ? channelCol.slice(2).trim() : channelCol.trim();

    if (isBanned) {
      banned.add(name);
      banned.add(`r/${name}`);
    }
    if (isLowRoi) {
      lowRoi.add(name);
      lowRoi.add(`r/${name}`);
    }
  }

  return { banned, lowRoi };
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "warn", banned: [], low_roi: [], message: "No input provided." }, 2);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "block", banned: [], low_roi: [], message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` }, 1);
  }

  const campaignFile = ctx.campaign_file ?? "";
  if (!campaignFile) {
    emit({ verdict: "warn", banned: [], low_roi: [], message: "campaign_file is required." }, 2);
  }

  const channelDirFile = ctx.channel_dir_file ?? DEFAULT_CHANNEL_DIR;

  if (!existsSync(channelDirFile)) {
    emit({ verdict: "warn", banned: [], low_roi: [], message: `Channel directory not found: ${channelDirFile}` }, 2);
  }

  if (!existsSync(campaignFile)) {
    emit({ verdict: "warn", banned: [], low_roi: [], message: `campaign.json not found: ${campaignFile}` }, 2);
  }

  let campaign: Campaign;
  try {
    campaign = JSON.parse(readFileSync(campaignFile, "utf-8")) as Campaign;
  } catch (e: unknown) {
    emit({ verdict: "warn", banned: [], low_roi: [], message: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}` }, 2);
  }

  let channelMd: string;
  try {
    channelMd = readFileSync(channelDirFile, "utf-8");
  } catch (e: unknown) {
    emit({ verdict: "warn", banned: [], low_roi: [], message: `Cannot read channel directory: ${e instanceof Error ? e.message : String(e)}` }, 2);
  }

  const { banned: bannedChannels, lowRoi: lowRoiChannels } = parseChannelDirectory(channelMd);

  const bannedHits: ChannelHit[] = [];
  const lowRoiHits: ChannelHit[] = [];

  for (const spoke of campaign.spokes ?? []) {
    const spokeId = spoke.id ?? "unknown";

    // Check subreddits list
    for (const subreddit of spoke.subreddits ?? []) {
      const name = subreddit.toLowerCase().startsWith("r/")
        ? subreddit.toLowerCase().slice(2)
        : subreddit.toLowerCase();
      if (bannedChannels.has(name) || bannedChannels.has(`r/${name}`)) {
        bannedHits.push({
          spoke_id: spokeId,
          channel: subreddit,
          type: "subreddit",
          reason: `r/${subreddit} is BANNED in channel directory`,
        });
      } else if (lowRoiChannels.has(name) || lowRoiChannels.has(`r/${name}`)) {
        lowRoiHits.push({
          spoke_id: spokeId,
          channel: subreddit,
          type: "subreddit",
          reason: `r/${subreddit} is marked Low ROI in channel directory`,
        });
      }
    }
  }

  if (bannedHits.length > 0) {
    emit({
      verdict: "block",
      banned: bannedHits,
      low_roi: lowRoiHits,
      message: `BLOCK — ${bannedHits.length} spoke(s) target BANNED channel(s). Remove or replace before distributing.`,
    }, 1);
  }

  if (lowRoiHits.length > 0) {
    const channels = lowRoiHits.map((h) => h.channel);
    emit({
      verdict: "warn",
      banned: [],
      low_roi: lowRoiHits,
      message: `WARN — ${lowRoiHits.length} spoke(s) target Low ROI channel(s): ${JSON.stringify(channels)}. Review before distributing.`,
    }, 2);
  }

  emit({
    verdict: "pass",
    banned: [],
    low_roi: [],
    message: `PASS — No banned or low ROI channels targeted in ${(campaign.spokes ?? []).length} spokes.`,
  }, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "block",
      banned: [],
      low_roi: [],
      message: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(1);
});
