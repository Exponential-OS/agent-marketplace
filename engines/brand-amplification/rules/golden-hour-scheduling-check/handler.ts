#!/usr/bin/env bun
// handler.ts — golden-hour-scheduling-check enforcement (TypeScript+Bun replacement for HOW.py)
// Validates campaign components are scheduled during platform-specific golden-hour windows.
// NOTE: This gate never BLOCKs — wrong timing degrades performance, it does not invalidate the campaign.

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SLUG = "golden-hour-scheduling-check";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

// Golden windows per platform key: [startH, startM, endH, endM][]
const GOLDEN_WINDOWS: Record<string, Array<[number, number, number, number]>> = {
  linkedin_article: [[7, 30, 9, 0], [11, 30, 13, 0], [17, 0, 18, 30]],
  linkedin_post:    [[7, 30, 9, 0], [11, 30, 13, 0], [17, 0, 18, 30]],
  x_thread:         [[8, 0, 10, 0], [12, 0, 13, 0], [17, 0, 18, 0]],
  instagram:        [[6, 0, 9, 0],  [11, 0, 13, 0], [19, 0, 21, 0]],
  substack:         [[6, 0, 10, 0]],
  reddit:           [[6, 0, 8, 0],  [12, 0, 14, 0]],
  facebook:         [[9, 0, 13, 0]],
};

// Days to avoid: 0=Mon…6=Sun
const BAD_DAYS: Record<string, number[]> = {
  linkedin_article: [4, 5, 6],
  linkedin_post:    [4, 5, 6],
  x_thread:         [5, 6],
  instagram:        [],
  substack:         [4, 5, 6],
  reddit:           [5, 6],
  facebook:         [5, 6],
};

const MIN_SPACING_HOURS = 2;

interface Finding {
  severity: "warn";
  component: string;
  issue: string;
  fix: string;
}

interface Component {
  platform?: string;
  type?: string;
  id?: string;
  scheduled_at?: string;
  distribution?: { scheduled_at?: string };
  meta?: { scheduled_at?: string };
  [key: string]: unknown;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  try { appendFileSync(LOG_PATH, JSON.stringify({ ts, rule_slug: SLUG, ...extra }) + "\n"); } catch { /* fail-open */ }
}

function platformKey(componentType: string, spoke?: Component): string | null {
  const t = componentType.toLowerCase();
  if (t.includes("article") || t === "hub") return "linkedin_article";
  if (t === "post_hub" || t === "linkedin_post" || t === "linkedin") return "linkedin_post";
  if (t.includes("x_thread") || t.includes("twitter") || t === "x") return "x_thread";
  if (t.includes("instagram")) return "instagram";
  if (t.includes("reddit")) return "reddit";
  if (t.includes("facebook")) return "facebook";
  if (t.includes("substack") || t === "source" || t === "newsletter") return "substack";
  if (spoke) {
    const sid = ((spoke.id ?? "") + (spoke.platform ?? "")).toLowerCase();
    for (const key of Object.keys(GOLDEN_WINDOWS)) {
      if (sid.includes(key.split("_")[0])) return key;
    }
  }
  return null;
}

function getScheduledAt(comp: Component): string | null {
  return comp.scheduled_at
    ?? comp.distribution?.scheduled_at
    ?? comp.meta?.scheduled_at
    ?? null;
}

function parseDt(raw: string, tzName: string): Date | null {
  try {
    // Try to parse as ISO 8601
    let str = raw;
    // If no timezone offset and no Z, treat as local time in tzName
    const hasOffset = /[Z+\-]\d*$/.test(raw.trim()) || raw.trim().endsWith("Z");
    if (!hasOffset) {
      // Use Intl to get the UTC offset for tzName at a rough time
      const roughDate = new Date(raw);
      if (isNaN(roughDate.getTime())) return null;
      // Format the date in the target timezone to get offset
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tzName,
        timeZoneName: "shortOffset",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      });
      // Get the date parts in the target timezone
      const parts = fmt.formatToParts(roughDate);
      const p: Record<string, string> = {};
      for (const part of parts) p[part.type] = part.value;
      // Reconstruct: treat the raw string as being in tzName by shifting
      const utcOffset = Intl.DateTimeFormat("en-US", { timeZone: tzName, timeZoneName: "shortOffset" })
        .formatToParts(roughDate)
        .find(x => x.type === "timeZoneName")?.value ?? "GMT+0";
      // Convert offset like "GMT-7" or "GMT+5:30"
      const offsetMatch = utcOffset.match(/GMT([+\-])(\d+)(?::(\d+))?/);
      if (!offsetMatch) return roughDate;
      const sign = offsetMatch[1] === "+" ? 1 : -1;
      const offsetHours = parseInt(offsetMatch[2], 10);
      const offsetMinutes = parseInt(offsetMatch[3] ?? "0", 10);
      const totalOffsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;
      // Adjust: roughDate was parsed as UTC, but we want it as tzName local
      const adjustedMs = roughDate.getTime() - totalOffsetMs;
      return new Date(adjustedMs + totalOffsetMs);
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function getLocalTime(dt: Date, tzName: string): { weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tzName,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(dt);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  // weekday: 0=Mon, 6=Sun
  const weekdayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const weekday = weekdayMap[p.weekday] ?? 0;
  const hour = parseInt(p.hour === "24" ? "0" : p.hour, 10);
  const minute = parseInt(p.minute, 10);
  return { weekday, hour, minute };
}

function inGoldenWindow(hour: number, minute: number, windows: Array<[number, number, number, number]>): boolean {
  const totalMins = hour * 60 + minute;
  return windows.some(([sh, sm, eh, em]) => {
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    return totalMins >= startMins && totalMins <= endMins;
  });
}

function windowStr(windows: Array<[number, number, number, number]>): string {
  return windows.map(([sh, sm, eh, em]) =>
    `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}–${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`
  ).join(", ");
}

function checkComponent(
  label: string,
  pk: string,
  rawDt: string,
  tzName: string,
  findings: Finding[],
  scheduled: Map<string, number[]>
): number | null {
  const dt = parseDt(rawDt, tzName);
  if (dt === null) {
    findings.push({
      severity: "warn",
      component: label,
      issue: `Cannot parse scheduled_at value: '${rawDt}'`,
      fix: "Use ISO 8601 format, e.g. '2026-05-08T08:00:00' or '2026-05-08T08:00:00-07:00'",
    });
    return null;
  }

  const { weekday, hour, minute } = getLocalTime(dt, tzName);

  const badDays = BAD_DAYS[pk] ?? [];
  if (badDays.includes(weekday)) {
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    findings.push({
      severity: "warn",
      component: label,
      issue: `Scheduled on ${dayNames[weekday]} — low-engagement day for ${pk}`,
      fix: "Move to Mon–Thu for best algorithmic reach",
    });
  }

  const windows = GOLDEN_WINDOWS[pk] ?? [];
  if (windows.length > 0 && !inGoldenWindow(hour, minute, windows)) {
    const goldenHours = ["linkedin_article", "linkedin_post", "substack"].includes(pk) ? 60 : 30;
    findings.push({
      severity: "warn",
      component: label,
      issue: `Scheduled at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${tzName}) — outside ${pk} golden windows (${windowStr(windows)})`,
      fix: `Reschedule into a golden window so the first ${goldenHours} min of engagement velocity reaches real humans and locks in algorithmic distribution`,
    });
  }

  const ts = dt.getTime();
  if (!scheduled.has(pk)) scheduled.set(pk, []);
  scheduled.get(pk)!.push(ts);
  return ts;
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw = (argVal === undefined || argVal === "-")
    ? (await Bun.stdin.text()).trim()
    : argVal;

  if (!raw) {
    process.stdout.write(JSON.stringify({ status: "warn", message: "No input JSON provided.", findings: [] }) + "\n");
    process.exit(2);
  }

  let inp: { campaign_file?: string; timezone?: string };
  try { inp = JSON.parse(raw); }
  catch (e: unknown) {
    process.stdout.write(JSON.stringify({ status: "warn", message: `Invalid input JSON: ${e instanceof Error ? e.message : String(e)}`, findings: [] }) + "\n");
    process.exit(2);
  }

  const campaignPath = inp!.campaign_file ?? "";
  if (!campaignPath || !existsSync(campaignPath)) {
    process.stdout.write(JSON.stringify({ status: "warn", message: `campaign.json not found: ${campaignPath}`, findings: [] }) + "\n");
    process.exit(2);
  }

  let campaign: Record<string, unknown>;
  try { campaign = JSON.parse(readFileSync(campaignPath, "utf-8")); }
  catch (e: unknown) {
    process.stdout.write(JSON.stringify({ status: "warn", message: `Cannot parse campaign.json: ${e instanceof Error ? e.message : String(e)}`, findings: [] }) + "\n");
    process.exit(2);
  }

  const tzName = inp!.timezone
    ?? (campaign.meta as Record<string,unknown>)?.timezone as string
    ?? "America/Los_Angeles";

  const findings: Finding[] = [];
  const scheduled = new Map<string, number[]>();

  // source (Substack)
  const source = campaign.source as Component | undefined;
  if (source && typeof source === "object") {
    const sat = getScheduledAt(source);
    if (sat) checkComponent("source (Substack)", "substack", sat, tzName, findings, scheduled);
  }

  // hub (LinkedIn Article)
  const hub = campaign.hub as Component | undefined;
  if (hub && typeof hub === "object") {
    const sat = getScheduledAt(hub);
    if (sat) checkComponent("hub (LinkedIn Article)", "linkedin_article", sat, tzName, findings, scheduled);
  }

  // spokes
  let spokes = campaign.spokes;
  if (spokes && typeof spokes === "object" && !Array.isArray(spokes)) {
    spokes = Object.values(spokes as Record<string, unknown>);
  }
  for (const spoke of ((spokes as Component[]) ?? [])) {
    if (!spoke || typeof spoke !== "object") continue;
    const sat = getScheduledAt(spoke);
    if (!sat) continue;
    const sid = spoke.id ?? "spoke";
    const stype = (spoke.type ?? spoke.platform ?? String(sid)) as string;
    const pk = platformKey(stype, spoke);
    if (pk) checkComponent(`spoke (${sid})`, pk, sat, tzName, findings, scheduled);
  }

  // spacing check
  for (const [pk, timestamps] of scheduled.entries()) {
    if (timestamps.length < 2) continue;
    const sorted = [...timestamps].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapH = (sorted[i + 1] - sorted[i]) / 3_600_000;
      if (gapH < MIN_SPACING_HOURS) {
        findings.push({
          severity: "warn",
          component: `${pk} spacing`,
          issue: `Two ${pk} posts scheduled ${gapH.toFixed(1)}h apart (minimum ${MIN_SPACING_HOURS}h recommended)`,
          fix: `Space ${pk} posts ≥${MIN_SPACING_HOURS}h apart to avoid algorithm de-prioritisation`,
        });
      }
    }
  }

  // no scheduling info at all
  const totalScheduled = [...scheduled.values()].reduce((s, v) => s + v.length, 0);
  const hasContent = !!(source || hub || (Array.isArray(spokes) && spokes.length > 0));
  if (hasContent && totalScheduled === 0) {
    const result = {
      status: "warn",
      message: "No scheduled_at timestamps found in any component — golden hour cannot be validated. Add scheduled_at (ISO 8601) to each component or confirm manual posting with timing awareness.",
      findings: [],
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    log({ verdict: "warn", total_scheduled: 0 });
    process.exit(2);
  }

  if (findings.length === 0) {
    const result = {
      status: "pass",
      message: `All ${totalScheduled} scheduled component(s) fall within platform golden windows.`,
      findings: [],
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    log({ verdict: "pass", total_scheduled: totalScheduled });
    process.exit(0);
  }

  const msg = `${findings.length} golden-hour warning(s): ` +
    findings.slice(0, 2).map(f => f.issue).join("; ") +
    (findings.length > 2 ? ` (+${findings.length - 2} more)` : "");

  const result = { status: "warn", message: msg, findings };
  process.stdout.write(JSON.stringify(result) + "\n");
  log({ verdict: "warn", findings_count: findings.length });
  process.exit(2);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    status: "warn",
    message: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    findings: [],
  }) + "\n");
  process.exit(2);
});
