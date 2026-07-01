import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  aggregateAlignment,
  emitProfileBrandAlignmentScored,
  formatAlignmentReport,
  PROFILE_BRAND_ALIGNMENT_SCORED_EVENT,
  type SectionScore,
} from "../src/pipeline/profile-brand-alignment";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "profile-brand-alignment-test-"));
  roots.push(root);
  return root;
}

function readEvents(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("profile brand alignment aggregation", () => {
  test("computes the weighted overall score with default section visibility weights", () => {
    const result = aggregateAlignment([
      { section: "headline", score: 40, gaps: ["says EM not AI-thinker"] },
      { section: "summary", score: 85, gaps: [] },
      { section: "experience", score: 70, gaps: [] },
    ] satisfies SectionScore[]);

    expect(result.status).toBe("ok");
    expect(result.overall).toBe(62);
    expect(result.bySection.map((score) => [score.section, score.score, score.weight])).toEqual([
      ["headline", 40, 4],
      ["summary", 85, 3],
      ["experience", 70, 2],
    ]);
  });

  test("ranks gaps worst-first from score deficit and section weight", () => {
    const result = aggregateAlignment([
      { section: "summary", score: 65, gaps: ["summary underplays AI systems"] },
      { section: "headline", score: 35, gaps: ["headline contradicts content themes"] },
      { section: "experience", score: 80, gaps: ["experience lacks proof points"] },
    ]);

    expect(result.rankedGaps.map((gap) => gap.gap)).toEqual([
      "headline contradicts content themes",
      "summary underplays AI systems",
      "experience lacks proof points",
    ]);
    expect(result.rankedGaps.map((gap) => gap.severity)).toEqual([260, 105, 40]);
  });

  test("tolerates empty, missing, and malformed section scores", () => {
    expect(aggregateAlignment([])).toEqual({
      overall: 0,
      status: "insufficient_data",
      bySection: [],
      rankedGaps: [],
    });

    const result = aggregateAlignment([
      null,
      {},
      { section: "", score: 90, gaps: ["ignored"] },
      { section: "headline", score: "90", gaps: ["ignored"] },
      { section: "summary", score: Number.NaN, gaps: ["ignored"] },
    ]);

    expect(result.status).toBe("insufficient_data");
    expect(result.overall).toBe(0);
    expect(result.bySection).toEqual([]);
  });

  test("clamps out-of-range scores before weighting and reporting", () => {
    const result = aggregateAlignment([
      { section: "headline", score: 125, gaps: [] },
      { section: "summary", score: -20, gaps: ["summary conflict"] },
    ]);

    expect(result.bySection.map((score) => [score.section, score.score])).toEqual([
      ["headline", 100],
      ["summary", 0],
    ]);
    expect(result.overall).toBe(57);
    expect(result.rankedGaps[0]).toEqual({
      section: "summary",
      gap: "summary conflict",
      severity: 300,
    });
  });

  test("formats a plain-text report without pipe characters", () => {
    const result = aggregateAlignment([
      { section: "headline", score: 45, gaps: ["claims operator | posts as systems thinker"] },
    ]);
    const report = formatAlignmentReport(result);

    expect(report).toContain("Profile brand alignment score: 45/100");
    expect(report).toContain("Prioritized fixes:");
    expect(report).not.toContain("|");
  });
});

describe("profile brand alignment telemetry", () => {
  test("telemetry is gated off by default", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = aggregateAlignment([
      { section: "headline", score: 40, gaps: ["Acme AI Engineering Manager mismatch"] },
    ]);
    const emitted = emitProfileBrandAlignmentScored(result, {
      env: {},
      eventsPath,
      now: new Date("2026-06-30T12:00:00Z"),
    });

    expect(emitted.written).toBe(false);
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("telemetry writes only score bucket and counts when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = aggregateAlignment([
      { section: "headline", score: 40, gaps: ["Acme AI Engineering Manager mismatch"] },
      { section: "summary", score: 85, gaps: [] },
      { section: "experience", score: 70, gaps: ["private founder story missing"] },
    ]);
    const emitted = emitProfileBrandAlignmentScored(result, {
      env: { XOS_98_TELEMETRY: "1" },
      eventsPath,
      now: new Date("2026-06-30T12:00:00Z"),
    });

    expect(emitted.written).toBe(true);
    expect(readEvents(eventsPath)).toEqual([
      {
        event: PROFILE_BRAND_ALIGNMENT_SCORED_EVENT,
        overall_score_bucket: "50-74",
        section_count: 3,
        gap_count: 2,
        ts: "2026-06-30T12:00:00Z",
      },
    ]);

    const serialized = JSON.stringify(readEvents(eventsPath));
    expect(serialized).not.toContain("Acme AI");
    expect(serialized).not.toContain("Engineering Manager");
    expect(serialized).not.toContain("founder story");
    expect(serialized).not.toContain("headline");
    expect(serialized).not.toContain("summary");
    expect(serialized).not.toContain("experience");
  });
});
