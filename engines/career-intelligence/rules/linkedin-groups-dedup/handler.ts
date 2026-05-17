#!/usr/bin/env bun
// handler.ts — linkedin-groups-dedup enforcement (TypeScript+Bun replacement for HOW.py)
// Gate: before posting to any LinkedIn Group, check groups-post-log.jsonl for a post
// to the same group within the last 7 days (configurable cooldown).

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "linkedin-groups-dedup";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CAREER_HOME = process.env.CAREER_HOME ?? process.env.CAREER_OS_HOME ?? join(homedir(), "anand-career-os");
const DEFAULT_LOG = join(CAREER_HOME, "brain/social-distribution-engine/groups-post-log.jsonl");
const DEFAULT_LOOKBACK_DAYS = 7;

interface InputCtx {
  group_url: string;
  log_file?: string;
  lookback_days?: number;
}

interface LogEntry {
  group_url: string;
  posted_at: string;
  [key: string]: unknown;
}

type OutputPass = { verdict: "PASS" };
type OutputBlock = {
  verdict: "BLOCK";
  reason: string;
  last_posted: string;
  next_available: string;
};
type Output = OutputPass | OutputBlock;

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

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function check(groupUrl: string, logFile: string, lookbackDays: number): Output {
  const normUrl = normalizeUrl(groupUrl);
  const now = new Date();
  const cutoffMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;

  if (!existsSync(logFile)) {
    return { verdict: "PASS" };
  }

  let mostRecent: Date | null = null;

  try {
    const lines = readFileSync(logFile, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: LogEntry;
      try {
        entry = JSON.parse(trimmed) as LogEntry;
      } catch {
        continue;
      }
      if (normalizeUrl(entry.group_url ?? "") !== normUrl) continue;
      const postedStr = entry.posted_at ?? "";
      let postedDt: Date;
      try {
        postedDt = new Date(postedStr.replace("Z", "+00:00").replace(/\+00:00$/, "Z"));
        if (isNaN(postedDt.getTime())) continue;
      } catch {
        continue;
      }
      if (postedDt.getTime() > cutoffMs) {
        if (mostRecent === null || postedDt > mostRecent) {
          mostRecent = postedDt;
        }
      }
    }
  } catch {
    return { verdict: "PASS" };
  }

  if (mostRecent === null) {
    return { verdict: "PASS" };
  }

  const nextAvailable = new Date(mostRecent.getTime() + lookbackDays * 24 * 60 * 60 * 1000);
  const daysRemaining = Math.floor((nextAvailable.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysAgo = Math.floor((now.getTime() - mostRecent.getTime()) / (1000 * 60 * 60 * 24));

  const nextAvailableStr = nextAvailable.toISOString().slice(0, 10);
  const lastPostedStr = mostRecent.toISOString().replace(/\.\d+Z$/, "Z");

  return {
    verdict: "BLOCK",
    reason:
      `Posted to this group ${daysAgo} day(s) ago ` +
      `(cooldown: ${lookbackDays} days). ` +
      `Next available: ${nextAvailableStr} ` +
      `(${daysRemaining} day(s) from now).`,
    last_posted: lastPostedStr,
    next_available: nextAvailableStr,
  };
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    emit({ verdict: "BLOCK", reason: "No input.", last_posted: "", next_available: "" }, 1);
  }

  let ctx: InputCtx;
  try {
    ctx = JSON.parse(raw) as InputCtx;
  } catch (e: unknown) {
    emit({ verdict: "BLOCK", reason: `Invalid JSON input: ${e instanceof Error ? e.message : String(e)}`, last_posted: "", next_available: "" }, 1);
  }

  const groupUrl = (ctx.group_url ?? "").trim();
  if (!groupUrl) {
    emit({ verdict: "BLOCK", reason: "group_url is required.", last_posted: "", next_available: "" }, 1);
  }

  const logFile = ctx.log_file ?? DEFAULT_LOG;
  const lookbackDays = Number(ctx.lookback_days ?? DEFAULT_LOOKBACK_DAYS);

  const result = check(groupUrl, logFile, lookbackDays);

  if (result.verdict === "BLOCK") {
    emit(result, 1);
  }
  emit(result, 0);
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "BLOCK",
      reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
      last_posted: "",
      next_available: "",
    }) + "\n"
  );
  process.exit(1);
});
