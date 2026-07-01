import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ACTIVE_USER_TIME_BUCKET_ASSUMPTIONS,
  createTelemetryReport,
  formatTelemetryReport,
  readTelemetryReport,
  type FunnelEventName,
  type TelemetryReport,
} from "../src/telemetry/report";

const roots: string[] = [];

function makeEventsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "xos133-report-test-"));
  roots.push(root);
  return join(root, "events.jsonl");
}

function writeJsonl(path: string, rows: Array<Record<string, unknown> | string>): void {
  writeFileSync(path, rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n") + "\n");
}

function step(report: TelemetryReport, event: FunnelEventName) {
  return report.funnel.find((item) => item.event === event)!;
}

function cohortStep(report: TelemetryReport, cohort: string, event: FunnelEventName) {
  return report.cohorts.find((item) => item.cohort === cohort)!.funnel.find((item) => item.event === event)!;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("XOS-133 local telemetry report", () => {
  test("computes funnel counts, conversion, and drop-off", () => {
    const eventsPath = makeEventsPath();
    writeJsonl(eventsPath, [
      { event: "onboarding_started", cohort: "2026-W26", ts: "2026-06-22T09:00:00Z" },
      { event: "onboarding_started", cohort: "2026-W26", ts: "2026-06-22T09:01:00Z" },
      { event: "onboarding_started", cohort: "2026-W26", ts: "2026-06-22T09:02:00Z" },
      { event: "onboarding_started", cohort: "2026-W26", ts: "2026-06-22T09:03:00Z" },
      { event: "onboarding_completed", cohort: "2026-W26", ts: "2026-06-22T09:04:00Z" },
      { event: "onboarding_completed", cohort: "2026-W26", ts: "2026-06-22T09:05:00Z" },
      { event: "onboarding_completed", cohort: "2026-W26", ts: "2026-06-22T09:06:00Z" },
      { event: "first_artifact_created", artifact_type: "resume", ts: "2026-06-22T09:07:00Z" },
      { event: "first_artifact_created", artifact_type: "outreach", ts: "2026-06-22T09:08:00Z" },
      { event: "beta_user_activated", cohort: "2026-W26", trigger: "resume", ts: "2026-06-22T09:09:00Z" },
    ]);

    const report = readTelemetryReport({ eventsPath });

    expect(step(report, "onboarding_started").count).toBe(4);
    expect(step(report, "onboarding_completed")).toMatchObject({
      count: 3,
      previousCount: 4,
    });
    expect(step(report, "onboarding_completed").conversionRate).toBeCloseTo(0.75);
    expect(step(report, "onboarding_completed").dropOffRate).toBeCloseTo(0.25);
    expect(step(report, "first_artifact_created").conversionRate).toBeCloseTo(2 / 3);
    expect(step(report, "beta_user_activated").dropOffRate).toBeCloseTo(0.5);
    expect(step(report, "d7_return").dropOffRate).toBeCloseTo(1);
  });

  test("estimates NSM from active-user-time buckets", () => {
    const report = createTelemetryReport([
      { event: "validated_outward_win", kind: "applied", ts: "2026-06-22T10:00:00Z" },
      { event: "validated_outward_win", kind: "screen", ts: "2026-06-22T10:01:00Z" },
      { event: "validated_outward_win", kind: "interview", ts: "2026-06-22T10:02:00Z" },
      { event: "active_user_time", seconds_bucket: "15_60m", ts: "2026-06-22T10:03:00Z" },
    ]);

    expect(report.nsm.estimate).toBe(true);
    expect(report.nsm.validatedOutwardWins).toBe(3);
    expect(report.nsm.estimatedActiveHours).toBeCloseTo(0.625);
    expect(report.nsm.value).toBeCloseTo(4.8);
    expect(report.nsm.bucketAssumptions).toEqual(ACTIVE_USER_TIME_BUCKET_ASSUMPTIONS);
  });

  test("splits funnel counts by install-week cohort", () => {
    const report = createTelemetryReport([
      { event: "onboarding_started", cohort: "2026-W26", ts: "2026-06-22T09:00:00Z" },
      { event: "first_artifact_created", artifact_type: "resume", ts: "2026-06-28T09:00:00Z" },
      { event: "onboarding_started", cohort: "2026-W27", ts: "2026-06-29T09:00:00Z" },
      { event: "onboarding_completed", cohort: "2026-W27", ts: "2026-06-29T09:01:00Z" },
      { event: "first_artifact_created", artifact_type: "outreach", ts: "2026-07-01T09:00:00Z" },
      { event: "beta_user_activated", cohort: "2026-W27", trigger: "outreach", ts: "2026-07-01T09:01:00Z" },
    ]);

    expect(report.cohorts.map((cohort) => cohort.cohort)).toEqual(["2026-W26", "2026-W27"]);
    expect(cohortStep(report, "2026-W26", "onboarding_started").count).toBe(1);
    expect(cohortStep(report, "2026-W26", "first_artifact_created").count).toBe(1);
    expect(cohortStep(report, "2026-W27", "onboarding_completed").count).toBe(1);
    expect(cohortStep(report, "2026-W27", "beta_user_activated").count).toBe(1);
  });

  test("missing event log returns a zeroed report", () => {
    const eventsPath = makeEventsPath();
    const report = readTelemetryReport({ eventsPath: join(eventsPath, "missing.jsonl") });

    expect(report.source.exists).toBe(false);
    expect(report.source.parsedEvents).toBe(0);
    expect(report.funnel.every((item) => item.count === 0)).toBe(true);
    expect(report.funnel.every((item) => item.conversionRate === 0)).toBe(true);
    expect(report.funnel.every((item) => item.dropOffRate === 0)).toBe(true);
    expect(report.nsm.value).toBe(0);
    expect(report.cohorts).toEqual([]);
    expect(report.recent.events).toEqual([]);
  });

  test("malformed lines are skipped without crashing", () => {
    const eventsPath = makeEventsPath();
    writeJsonl(eventsPath, [
      { event: "onboarding_started", cohort: "2026-W26", ts: "2026-06-22T09:00:00Z" },
      "not json",
      "[]",
      { event: "", ts: "2026-06-22T09:01:00Z" },
      { event: "d7_return", cohort: "2026-W26", ts: "2026-06-29T09:00:00Z" },
    ]);

    const report = readTelemetryReport({ eventsPath });

    expect(report.source.parsedEvents).toBe(2);
    expect(report.source.skippedMalformedLines).toBe(3);
    expect(step(report, "onboarding_started").count).toBe(1);
    expect(step(report, "d7_return").count).toBe(1);
    expect(formatTelemetryReport(report)).toContain("3 malformed skipped");
  });

  test("formatter renders funnel, NSM estimate, cohorts, and recent totals", () => {
    const report = createTelemetryReport([
      { event: "onboarding_started", cohort: "2026-W26", ts: "2026-06-22T09:00:00Z" },
      { event: "onboarding_completed", cohort: "2026-W26", ts: "2026-06-22T09:01:00Z" },
      { event: "first_artifact_created", artifact_type: "resume", ts: "2026-06-22T09:02:00Z" },
      { event: "beta_user_activated", cohort: "2026-W26", trigger: "resume", ts: "2026-06-22T09:03:00Z" },
      { event: "validated_outward_win", kind: "applied", ts: "2026-06-22T09:04:00Z" },
      { event: "active_user_time", seconds_bucket: "5_15m", ts: "2026-06-22T09:05:00Z" },
    ], { eventsPath: "/tmp/events.jsonl" });

    const formatted = formatTelemetryReport(report);

    expect(formatted).toContain("NSM (ESTIMATE - bucketed active time)");
    expect(formatted).toContain("VOW per active user-hour: 6.00");
    expect(formatted).toContain("FUNNEL");
    expect(formatted).toContain("| 2026-W26 |");
    expect(formatted).toContain("validated_outward_win=1");
  });

  test("report source contains no disallowed transport tokens", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "telemetry", "report.ts"), "utf-8");
    expect(source).not.toMatch(/fetch|http|posthog|axios/i);
  });
});
