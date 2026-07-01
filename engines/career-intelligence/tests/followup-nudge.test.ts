import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  computeFollowupNudges,
  emitFollowupNudgesSurfaced,
  FOLLOWUP_NUDGE_SURFACED_EVENT,
  type FollowupNudge,
} from "../src/pipeline/followup-nudge";

const NOW = "2026-06-30T12:00:00Z";
const roots: string[] = [];

function pipeline(stage_data: unknown[]) {
  return { stage_data };
}

function appliedEntry(overrides: Record<string, unknown> = {}) {
  return {
    company: "Acme AI",
    role: "Engineering Manager",
    tracker_id: 105,
    stage: "applied",
    updated_at: "2026-06-22",
    ...overrides,
  };
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "followup-nudge-test-"));
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

describe("follow-up nudge computation", () => {
  test("1wk boundary: exactly 7d nudges; 6d does not", () => {
    const nudges = computeFollowupNudges(pipeline([
      appliedEntry({ company: "Seven Day Co", tracker_id: 101, updated_at: "2026-06-23" }),
      appliedEntry({ company: "Six Day Co", tracker_id: 102, updated_at: "2026-06-24" }),
    ]), NOW);

    expect(nudges).toEqual([
      {
        company: "Seven Day Co",
        role: "Engineering Manager",
        ref: "#101",
        id: 101,
        daysSince: 7,
        cadence: "1wk",
        appliedDate: "2026-06-23",
      },
    ]);
  });

  test("2wk boundary: exactly 14d surfaces the 2wk cadence", () => {
    const nudges = computeFollowupNudges(pipeline([
      appliedEntry({ tracker_id: 201, updated_at: "2026-06-16" }),
    ]), NOW);

    expect(nudges).toEqual([
      {
        company: "Acme AI",
        role: "Engineering Manager",
        ref: "#201",
        id: 201,
        daysSince: 14,
        cadence: "2wk",
        appliedDate: "2026-06-16",
      },
    ]);
  });

  test("nudges only 'applied' (no response yet); excludes deprioritized, engaged, and closed stages", () => {
    const nudges = computeFollowupNudges(pipeline([
      appliedEntry({ company: "Applied Co", tracker_id: 301, stage: "applied", updated_at: "2026-06-22" }),
      // deprioritized = Company Action Gate forbids surfacing it as an action — never nudge.
      appliedEntry({ company: "Deprioritized Co", tracker_id: 302, stage: "deprioritized", updated_at: "2026-06-22" }),
      appliedEntry({ company: "Advancing Co", tracker_id: 303, stage: "advancing", updated_at: "2026-06-10" }),
      appliedEntry({ company: "Panel Co", tracker_id: 304, stage: "panel_interview", updated_at: "2026-06-10" }),
      // engaged / awaiting-their-decision = already in contact, not a "no first response" nudge.
      appliedEntry({ company: "Process Co", tracker_id: 305, stage: "in_process", updated_at: "2026-06-10" }),
      appliedEntry({ company: "Awaiting Co", tracker_id: 310, stage: "awaiting_decision", updated_at: "2026-06-10" }),
      appliedEntry({ company: "Rejected Co", tracker_id: 306, stage: "rejected", updated_at: "2026-06-10" }),
      appliedEntry({ company: "Dead Co", tracker_id: 307, stage: "dead", updated_at: "2026-06-10" }),
      appliedEntry({ company: "Offered Co", tracker_id: 308, stage: "offered", updated_at: "2026-06-10" }),
      appliedEntry({ company: "Declined Co", tracker_id: 309, stage: "declined", updated_at: "2026-06-10" }),
    ]), NOW);

    expect(nudges.map((nudge) => nudge.company)).toEqual(["Applied Co"]);
    expect(nudges.every((nudge) => nudge.cadence === "1wk")).toBe(true);
  });

  test("logged nudges are not repeated for the same cadence", () => {
    const nudges = computeFollowupNudges(pipeline([
      appliedEntry({
        company: "Already Nudged Co",
        tracker_id: 401,
        updated_at: "2026-06-22",
        followup_nudges: [{ cadence: "1wk", tracker_id: 401 }],
      }),
      appliedEntry({
        company: "Second Cadence Co",
        tracker_id: 402,
        updated_at: "2026-06-10",
        followup_nudges: [{ cadence: "1wk", tracker_id: 402 }],
      }),
    ]), NOW);

    expect(nudges.map((nudge) => [nudge.company, nudge.cadence])).toEqual([
      ["Second Cadence Co", "2wk"],
    ]);
  });

  test("missing, empty, and malformed pipeline data is safe and returns no nudges", () => {
    const cases: unknown[] = [
      undefined,
      null,
      {},
      { stage_data: [] },
      { stage_data: "not an array" },
      pipeline([null, "bad", {}, appliedEntry({ updated_at: "not-a-date" }), appliedEntry({ company: "", role: "" })]),
    ];

    for (const value of cases) {
      expect(computeFollowupNudges(value, NOW)).toEqual([]);
    }

    expect(computeFollowupNudges(pipeline([appliedEntry()]), "not-a-date")).toEqual([]);
  });
});

describe("follow-up nudge telemetry", () => {
  const nudges: FollowupNudge[] = [
    {
      company: "Acme AI",
      role: "Engineering Manager",
      ref: "#105",
      id: 105,
      daysSince: 8,
      cadence: "1wk",
      appliedDate: "2026-06-22",
    },
    {
      company: "Beta Systems",
      role: "Director of Engineering",
      ref: "#106",
      id: 106,
      daysSince: 20,
      cadence: "2wk",
      appliedDate: "2026-06-10",
    },
  ];

  test("telemetry is gated off by default", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitFollowupNudgesSurfaced(nudges, {
      env: {},
      eventsPath,
      now: new Date("2026-06-30T12:00:00Z"),
    });

    expect(result.written).toBe(false);
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("telemetry writes local count and cadence breakdown when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitFollowupNudgesSurfaced(nudges, {
      env: { XOS_98_TELEMETRY: "1" },
      eventsPath,
      now: new Date("2026-06-30T12:00:00Z"),
    });

    expect(result.written).toBe(true);
    expect(readEvents(eventsPath)).toEqual([
      {
        event: FOLLOWUP_NUDGE_SURFACED_EVENT,
        count: 2,
        cadence_breakdown: { "1wk": 1, "2wk": 1 },
        ts: "2026-06-30T12:00:00Z",
      },
    ]);
    expect(JSON.stringify(readEvents(eventsPath))).not.toContain("Acme AI");
    expect(JSON.stringify(readEvents(eventsPath))).not.toContain("Engineering Manager");
  });
});
