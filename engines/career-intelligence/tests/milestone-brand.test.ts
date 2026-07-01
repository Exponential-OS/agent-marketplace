import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildBrandMomentPrompt,
  detectShareableMilestones,
  emitMilestoneBrandSuggested,
  MILESTONE_BRAND_SUGGESTED_EVENT,
  type MilestoneBrandMoment,
} from "../src/pipeline/milestone-brand";

const roots: string[] = [];

function pipeline(stage_data: unknown[]) {
  return { stage_data };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    company: "Acme AI",
    role: "Engineering Manager",
    tracker_id: 105,
    stage: "offered",
    ...overrides,
  };
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "milestone-brand-test-"));
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

describe("milestone brand detection", () => {
  test("fail-closed: notable stages without an explicit shareable flag are not returned", () => {
    const milestones = detectShareableMilestones(pipeline([
      entry({ stage: "offered" }),
      entry({ company: "Panel Co", tracker_id: 106, stage: "panel_interview" }),
    ]));

    expect(milestones).toEqual([]);
  });

  test("shareable notable entries are returned with stable refs and optional angles", () => {
    const milestones = detectShareableMilestones(pipeline([
      entry({
        shareable: true,
        brand_angle: "What this milestone taught me about choosing high-agency teams.",
      }),
    ]));

    expect(milestones).toEqual([
      {
        company: "Acme AI",
        role: "Engineering Manager",
        ref: "#105",
        stage: "offered",
        angle: "What this milestone taught me about choosing high-agency teams.",
      },
    ]);
  });

  test("brand_shareable and nested milestone shareability are explicit opt-ins", () => {
    const milestones = detectShareableMilestones(pipeline([
      entry({ company: "Brand Flag Co", tracker_id: 201, stage: "awaiting_decision", brand_shareable: true }),
      entry({
        company: "Nested Co",
        tracker_id: 202,
        stage: "applied",
        milestone: { stage: "panel_interview", shareable: true, angle: "A useful interview prep lesson." },
      }),
    ]));

    expect(milestones).toEqual([
      {
        company: "Brand Flag Co",
        role: "Engineering Manager",
        ref: "#201",
        stage: "awaiting_decision",
      },
      {
        company: "Nested Co",
        role: "Engineering Manager",
        ref: "#202",
        stage: "panel_interview",
        angle: "A useful interview prep lesson.",
      },
    ]);
  });

  test("non-notable stages are excluded even when shareable", () => {
    const milestones = detectShareableMilestones(pipeline([
      entry({ company: "Applied Co", tracker_id: 301, stage: "applied", shareable: true }),
      entry({ company: "Rejected Co", tracker_id: 302, stage: "rejected", shareable: true }),
      entry({ company: "Dead Co", tracker_id: 303, stage: "dead", shareable: true }),
      entry({ company: "Declined Co", tracker_id: 304, stage: "declined", shareable: true }),
      entry({ company: "Deprioritized Co", tracker_id: 305, stage: "deprioritized", shareable: true }),
    ]));

    expect(milestones).toEqual([]);
  });

  test("missing and malformed stage_data is tolerated", () => {
    const cases: unknown[] = [
      undefined,
      null,
      {},
      { stage_data: "not an array" },
      pipeline([null, "bad", {}, entry({ company: "", shareable: true }), entry({ role: "", shareable: true })]),
    ];

    for (const value of cases) {
      expect(detectShareableMilestones(value)).toEqual([]);
    }
  });

  test("buildBrandMomentPrompt is draft-only and points to the campaign engine", () => {
    const prompt = buildBrandMomentPrompt({
      company: "Acme AI",
      role: "Engineering Manager",
      ref: "#105",
      stage: "offered",
    });

    expect(prompt).toContain("Milestone: Engineering Manager at Acme AI reached offered.");
    expect(prompt).toContain("Draft a brand post with the campaign engine?");
    expect(prompt).toContain("Nothing publishes automatically");
    // The prompt output itself must carry the gate requirement so the executable
    // path is not "doc-only" — surfacing requires the Company Action Gate + firewall check.
    expect(prompt).toContain("Company Action Gate");
    expect(prompt.toLowerCase()).toContain("firewall");
  });
});

describe("milestone brand telemetry", () => {
  const milestones: MilestoneBrandMoment[] = [
    {
      company: "Acme AI",
      role: "Engineering Manager",
      ref: "#105",
      stage: "offered",
    },
    {
      company: "Beta Systems",
      role: "Director of Engineering",
      ref: "#106",
      stage: "panel_interview",
    },
  ];

  test("telemetry is gated off by default", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitMilestoneBrandSuggested(milestones, {
      env: {},
      eventsPath,
      now: new Date("2026-06-30T12:00:00Z"),
    });

    expect(result.written).toBe(false);
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("telemetry writes only count and stage breakdown when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitMilestoneBrandSuggested(milestones, {
      env: { XOS_98_TELEMETRY: "1" },
      eventsPath,
      now: new Date("2026-06-30T12:00:00Z"),
    });

    expect(result.written).toBe(true);
    expect(readEvents(eventsPath)).toEqual([
      {
        event: MILESTONE_BRAND_SUGGESTED_EVENT,
        count: 2,
        stage_breakdown: { offered: 1, panel_interview: 1 },
        ts: "2026-06-30T12:00:00Z",
      },
    ]);

    const serialized = JSON.stringify(readEvents(eventsPath));
    expect(serialized).not.toContain("Acme AI");
    expect(serialized).not.toContain("Engineering Manager");
    expect(serialized).not.toContain("Beta Systems");
    expect(serialized).not.toContain("Director of Engineering");
    expect(serialized).not.toContain("#105");
    expect(serialized).not.toContain("#106");
  });
});
