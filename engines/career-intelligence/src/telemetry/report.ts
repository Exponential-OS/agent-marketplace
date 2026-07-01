import { existsSync, readFileSync } from "fs";
import { cohortFromDate } from "./beta-funnel";
import { defaultEventsPath, type TelemetryEnv } from "./events";
import { ACTIVE_USER_TIME_BUCKETS, type ActiveUserTimeBucket } from "./nsm";

export const FUNNEL_STEPS = [
  { event: "onboarding_started", label: "Onboarding started" },
  { event: "onboarding_completed", label: "Onboarding completed" },
  { event: "first_artifact_created", label: "First artifact" },
  { event: "beta_user_activated", label: "Beta activated" },
  { event: "d7_return", label: "D7 return" },
] as const;

export type FunnelEventName = (typeof FUNNEL_STEPS)[number]["event"];

export const ACTIVE_USER_TIME_BUCKET_ASSUMPTIONS: Record<
  ActiveUserTimeBucket,
  { midpointSeconds: number; midpointMinutes: number; label: string }
> = {
  lt_5m: { midpointSeconds: 150, midpointMinutes: 2.5, label: "lt_5m ~= 2.5m" },
  "5_15m": { midpointSeconds: 600, midpointMinutes: 10, label: "5_15m ~= 10m" },
  "15_60m": { midpointSeconds: 2250, midpointMinutes: 37.5, label: "15_60m ~= 37.5m" },
  "60m_plus": { midpointSeconds: 5400, midpointMinutes: 90, label: "60m_plus ~= 90m" },
};

export interface TelemetryReportEvent {
  event: string;
  ts?: string;
  cohort?: string;
  artifact_type?: string;
  trigger?: string;
  kind?: string;
  seconds_bucket?: string;
  [key: string]: unknown;
}

export interface ReadTelemetryReportOptions {
  env?: TelemetryEnv;
  eventsPath?: string;
  recentLimit?: number;
}

export interface CreateTelemetryReportOptions {
  eventsPath?: string;
  sourceExists?: boolean;
  totalLines?: number;
  skippedMalformedLines?: number;
  recentLimit?: number;
}

export interface FunnelStepReport {
  event: FunnelEventName;
  label: string;
  count: number;
  previousCount: number | null;
  conversionRate: number;
  dropOffRate: number;
}

export interface CohortFunnelReport {
  cohort: string;
  funnel: FunnelStepReport[];
}

export interface NsmReport {
  label: "VOW per active user-hour";
  estimate: true;
  validatedOutwardWins: number;
  estimatedActiveSeconds: number;
  estimatedActiveHours: number;
  value: number;
  bucketCounts: Record<ActiveUserTimeBucket, number>;
  bucketAssumptions: typeof ACTIVE_USER_TIME_BUCKET_ASSUMPTIONS;
}

export interface RecentEventSummary {
  event: string;
  ts?: string;
  details: Record<string, string>;
}

export interface TelemetryReport {
  source: {
    eventsPath: string;
    exists: boolean;
    totalLines: number;
    parsedEvents: number;
    skippedMalformedLines: number;
  };
  funnel: FunnelStepReport[];
  nsm: NsmReport;
  cohorts: CohortFunnelReport[];
  recent: {
    limit: number;
    events: RecentEventSummary[];
    totalsByEventType: Record<string, number>;
  };
}

export function readTelemetryReport(options: ReadTelemetryReportOptions = {}): TelemetryReport {
  const eventsPath = options.eventsPath ?? defaultEventsPath(options.env);
  const readResult = readTelemetryEvents(eventsPath);
  return createTelemetryReport(readResult.events, {
    eventsPath,
    sourceExists: readResult.exists,
    totalLines: readResult.totalLines,
    skippedMalformedLines: readResult.skippedMalformedLines,
    recentLimit: options.recentLimit,
  });
}

export function createTelemetryReport(
  events: readonly TelemetryReportEvent[],
  options: CreateTelemetryReportOptions = {},
): TelemetryReport {
  const recentLimit = options.recentLimit ?? 10;
  const funnelCounts = emptyFunnelCounts();
  const cohortCounts = new Map<string, Record<FunnelEventName, number>>();
  const bucketCounts = emptyBucketCounts();
  const totalsByEventType: Record<string, number> = {};
  let validatedOutwardWins = 0;

  for (const event of events) {
    totalsByEventType[event.event] = (totalsByEventType[event.event] ?? 0) + 1;

    if (isFunnelEventName(event.event)) {
      funnelCounts[event.event] += 1;
      const cohort = cohortForEvent(event);
      const counts = cohortCounts.get(cohort) ?? emptyFunnelCounts();
      counts[event.event] += 1;
      cohortCounts.set(cohort, counts);
    }

    if (event.event === "validated_outward_win") {
      validatedOutwardWins += 1;
    } else if (event.event === "active_user_time" && isActiveUserTimeBucket(event.seconds_bucket)) {
      bucketCounts[event.seconds_bucket] += 1;
    }
  }

  const estimatedActiveSeconds = ACTIVE_USER_TIME_BUCKETS.reduce((total, bucket) => {
    return total + bucketCounts[bucket] * ACTIVE_USER_TIME_BUCKET_ASSUMPTIONS[bucket].midpointSeconds;
  }, 0);
  const estimatedActiveHours = estimatedActiveSeconds / 3600;

  return {
    source: {
      eventsPath: options.eventsPath ?? "(in-memory)",
      exists: options.sourceExists ?? true,
      totalLines: options.totalLines ?? events.length,
      parsedEvents: events.length,
      skippedMalformedLines: options.skippedMalformedLines ?? 0,
    },
    funnel: buildFunnel(funnelCounts),
    nsm: {
      label: "VOW per active user-hour",
      estimate: true,
      validatedOutwardWins,
      estimatedActiveSeconds,
      estimatedActiveHours,
      value: estimatedActiveHours > 0 ? validatedOutwardWins / estimatedActiveHours : 0,
      bucketCounts,
      bucketAssumptions: ACTIVE_USER_TIME_BUCKET_ASSUMPTIONS,
    },
    cohorts: [...cohortCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohort, counts]) => ({ cohort, funnel: buildFunnel(counts) })),
    recent: {
      limit: recentLimit,
      events: events.slice(-recentLimit).reverse().map(summarizeEvent),
      totalsByEventType: Object.fromEntries(
        Object.entries(totalsByEventType).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}

export function formatTelemetryReport(report: TelemetryReport): string {
  const lines: string[] = [];
  const maxFunnelCount = Math.max(...report.funnel.map((step) => step.count), 0);

  lines.push("XOS-98 LOCAL DASHBOARD");
  lines.push(`Source: ${report.source.eventsPath}`);
  lines.push(
    `Events: ${report.source.parsedEvents} parsed / ${report.source.totalLines} lines`
      + (report.source.exists ? "" : " (missing log; empty report)")
      + (report.source.skippedMalformedLines > 0
        ? `, ${report.source.skippedMalformedLines} malformed skipped`
        : ""),
  );
  lines.push("");
  lines.push("NSM (ESTIMATE - bucketed active time)");
  lines.push(`  ${report.nsm.label}: ${formatNumber(report.nsm.value)}`);
  lines.push(`  Validated outward wins: ${report.nsm.validatedOutwardWins}`);
  lines.push(`  Estimated active hours: ${formatNumber(report.nsm.estimatedActiveHours)}`);
  lines.push(
    `  Bucket assumptions: ${ACTIVE_USER_TIME_BUCKETS.map((bucket) => report.nsm.bucketAssumptions[bucket].label).join(", ")}`,
  );
  lines.push("");
  lines.push("FUNNEL");
  for (const step of report.funnel) {
    lines.push(
      `  ${step.label.padEnd(22)} ${String(step.count).padStart(4)} | ${bar(step.count, maxFunnelCount)}`
        + ` | conv ${formatPercent(step.conversionRate).padStart(6)}`
        + ` | drop ${formatPercent(step.dropOffRate).padStart(6)}`,
    );
  }
  lines.push("");
  lines.push("COHORTS");
  if (report.cohorts.length === 0) {
    lines.push("  (no cohort events yet)");
  } else {
    lines.push("  | Cohort | Started | Completed | Artifact | Activated | D7 | Activated/Started | D7/Started |");
    lines.push("  |--------|---------|-----------|----------|-----------|----|-------------------|------------|");
    for (const cohort of report.cohorts) {
      const counts = funnelCountsFromSteps(cohort.funnel);
      lines.push(
        `  | ${cohort.cohort} | ${counts.onboarding_started} | ${counts.onboarding_completed}`
          + ` | ${counts.first_artifact_created} | ${counts.beta_user_activated} | ${counts.d7_return}`
          + ` | ${formatPercent(safeRatio(counts.beta_user_activated, counts.onboarding_started))}`
          + ` | ${formatPercent(safeRatio(counts.d7_return, counts.onboarding_started))} |`,
      );
    }
  }
  lines.push("");
  lines.push("RECENT ACTIVITY");
  const totals = Object.entries(report.recent.totalsByEventType);
  lines.push(
    totals.length > 0
      ? `  Totals: ${totals.map(([event, count]) => `${event}=${count}`).join(", ")}`
      : "  Totals: none",
  );
  if (report.recent.events.length === 0) {
    lines.push("  Last events: none");
  } else {
    lines.push(`  Last ${report.recent.events.length}:`);
    for (const event of report.recent.events) {
      const details = Object.entries(event.details).map(([key, value]) => `${key}=${value}`).join(" ");
      lines.push(`    ${event.ts ?? "unknown-ts"}  ${event.event}${details ? `  ${details}` : ""}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function readTelemetryEvents(eventsPath: string): {
  exists: boolean;
  totalLines: number;
  skippedMalformedLines: number;
  events: TelemetryReportEvent[];
} {
  if (!existsSync(eventsPath)) {
    return { exists: false, totalLines: 0, skippedMalformedLines: 0, events: [] };
  }

  const lines = readFileSync(eventsPath, "utf-8").split(/\r?\n/);
  const events: TelemetryReportEvent[] = [];
  let skippedMalformedLines = 0;
  let totalLines = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    totalLines += 1;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        skippedMalformedLines += 1;
        continue;
      }
      const event = parsed as Record<string, unknown>;
      if (typeof event.event !== "string" || event.event.trim() === "") {
        skippedMalformedLines += 1;
        continue;
      }
      events.push(event as TelemetryReportEvent);
    } catch {
      skippedMalformedLines += 1;
    }
  }

  return { exists: true, totalLines, skippedMalformedLines, events };
}

function buildFunnel(counts: Record<FunnelEventName, number>): FunnelStepReport[] {
  return FUNNEL_STEPS.map((step, index) => {
    const count = counts[step.event];
    const previousCount = index === 0 ? null : counts[FUNNEL_STEPS[index - 1].event];
    const conversionRate = previousCount === null ? (count > 0 ? 1 : 0) : safeRatio(count, previousCount);
    return {
      ...step,
      count,
      previousCount,
      conversionRate,
      dropOffRate: previousCount === null || previousCount === 0 ? 0 : 1 - conversionRate,
    };
  });
}

function summarizeEvent(event: TelemetryReportEvent): RecentEventSummary {
  const details: Record<string, string> = {};
  for (const key of ["cohort", "artifact_type", "trigger", "kind", "seconds_bucket"] as const) {
    const value = event[key];
    if (typeof value === "string" && value.trim() !== "") details[key] = value;
  }
  return {
    event: event.event,
    ts: typeof event.ts === "string" ? event.ts : undefined,
    details,
  };
}

function emptyFunnelCounts(): Record<FunnelEventName, number> {
  return Object.fromEntries(FUNNEL_STEPS.map((step) => [step.event, 0])) as Record<FunnelEventName, number>;
}

function emptyBucketCounts(): Record<ActiveUserTimeBucket, number> {
  return Object.fromEntries(ACTIVE_USER_TIME_BUCKETS.map((bucket) => [bucket, 0])) as Record<
    ActiveUserTimeBucket,
    number
  >;
}

function funnelCountsFromSteps(steps: readonly FunnelStepReport[]): Record<FunnelEventName, number> {
  return Object.fromEntries(steps.map((step) => [step.event, step.count])) as Record<FunnelEventName, number>;
}

function isFunnelEventName(value: string): value is FunnelEventName {
  return FUNNEL_STEPS.some((step) => step.event === value);
}

function isActiveUserTimeBucket(value: unknown): value is ActiveUserTimeBucket {
  return typeof value === "string" && (ACTIVE_USER_TIME_BUCKETS as readonly string[]).includes(value);
}

function cohortForEvent(event: TelemetryReportEvent): string {
  if (typeof event.cohort === "string" && event.cohort.trim() !== "") return event.cohort.trim();
  if (typeof event.ts === "string") {
    const date = new Date(event.ts);
    if (!Number.isNaN(date.getTime())) return cohortFromDate(date);
  }
  return "unknown";
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function bar(count: number, max: number): string {
  const width = 24;
  const filled = max > 0 ? Math.round((count / max) * width) : 0;
  return `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function parseCliArgs(args: string[]): ReadTelemetryReportOptions & { json: boolean } {
  const options: ReadTelemetryReportOptions & { json: boolean } = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--events-path" || arg === "--path") {
      options.eventsPath = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--events-path=")) {
      options.eventsPath = arg.slice("--events-path=".length);
    } else if (arg.startsWith("--path=")) {
      options.eventsPath = arg.slice("--path=".length);
    } else if (arg === "--recent") {
      options.recentLimit = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--recent=")) {
      options.recentLimit = Number(arg.slice("--recent=".length));
    } else {
      throw new Error("Usage: report.ts [--json] [--events-path <path>] [--recent <count>]");
    }
  }
  return options;
}

if (import.meta.main) {
  try {
    const { json, ...options } = parseCliArgs(process.argv.slice(2));
    const report = readTelemetryReport(options);
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatTelemetryReport(report));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
