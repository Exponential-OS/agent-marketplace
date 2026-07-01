import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendInboundEntry,
  BRAND_INBOUND_PIPELINE_CREATED_EVENT,
  buildInboundPipelineEntry,
  emitBrandInboundPipelineCreated,
  type InboundPipelineEntry,
} from "../src/pipeline/inbound-pipeline";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "inbound-pipeline-test-"));
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
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

describe("inbound pipeline entries", () => {
  test("buildInboundPipelineEntry tags brand attribution and picks max tracker_id plus one", () => {
    const entry = buildInboundPipelineEntry({
      company: "Acme AI",
      role: "Engineering Manager",
      recruiter: "Priya Shah",
      recruiter_title: "Technical Recruiter",
      source_post: "post-brand-loop",
      note: "Recruiter DM after seeing the distributed systems post.",
    }, {
      existingEntries: [
        { tracker_id: 7, company: "Existing A" },
        { tracker_id: "11", company: "Existing B" },
        { tracker_id: "not-a-number", company: "Ignored" },
      ],
    });

    expect(entry).toEqual({
      tracker_id: 12,
      company: "Acme AI",
      role: "Engineering Manager",
      stage: "recruiter_inbound",
      stage_detail: "Recruiter DM after seeing the distributed systems post.",
      recruiter: "Priya Shah",
      recruiter_email: null,
      recruiter_title: "Technical Recruiter",
      hiring_manager: null,
      comp_note: null,
      warm_path: null,
      next_action: "Respond to recruiter",
      source: "brand_inbound",
      source_post: "post-brand-loop",
    });
  });

  test("buildInboundPipelineEntry accepts a non-colliding tracker_id and avoids a colliding one", () => {
    const existingEntries = [{ tracker_id: 40 }, { tracker_id: 41 }];

    const accepted = buildInboundPipelineEntry({
      tracker_id: 99,
      company: "Beta Systems",
      role: "Director of Engineering",
    }, { existingEntries });

    const collisionSafe = buildInboundPipelineEntry({
      tracker_id: 41,
      company: "Gamma Labs",
      role: "VP Engineering",
    }, { existingEntries });

    expect(accepted.tracker_id).toBe(99);
    expect(collisionSafe.tracker_id).toBe(42);
  });

  test("tracker_id avoids the GLOBAL id space, not just stage_data (no match-tracker collision)", () => {
    // stage_data max is 142, but the match-tracker registry goes up to 265 and
    // already contains 143. Seeding from stage_data alone would return 143 and
    // collide with an existing role. Passing existingTrackerIds must yield 266.
    const entry = buildInboundPipelineEntry(
      { company: "Inbound Co", role: "Staff Eng" },
      {
        existingEntries: [{ tracker_id: 141 }, { tracker_id: 142 }],
        existingTrackerIds: [143, 226, 241, 265, "55", null, undefined],
      },
    );
    expect(entry.tracker_id).toBe(266);
  });

  test("appendInboundEntry appends immutably without changing existing pipeline entries", () => {
    const originalEntry = { tracker_id: 1, company: "Existing Co", role: "Lead", stage: "applied" };
    const pipeline = {
      stage_data: [
        originalEntry,
        { tracker_id: 2, company: "Second Co", role: "Staff", stage: "advancing" },
      ],
      pending_referrals: [{ company: "Referral Co" }],
    };
    const before = structuredClone(pipeline);
    const inbound = buildInboundPipelineEntry({
      company: "Acme AI",
      role: "Engineering Manager",
      source_post: "post-123",
    }, { existingEntries: pipeline.stage_data });

    const next = appendInboundEntry(pipeline, inbound);

    expect(next).not.toBe(pipeline);
    expect(next.stage_data).not.toBe(pipeline.stage_data);
    expect(next.stage_data).toHaveLength(3);
    expect(next.stage_data.slice(0, 2)).toEqual(before.stage_data);
    expect(next.stage_data[2]).toEqual(inbound);
    expect(pipeline).toEqual(before);
    expect(pipeline.stage_data[0]).toBe(originalEntry);
  });

  test("appendInboundEntry tolerates missing stage_data by creating it", () => {
    const inbound: InboundPipelineEntry = buildInboundPipelineEntry({
      company: "No Stage Co",
      role: "Platform Lead",
    });

    expect(appendInboundEntry({ pending_referrals: [] }, inbound)).toEqual({
      pending_referrals: [],
      stage_data: [inbound],
    });
  });
});

describe("brand inbound pipeline telemetry", () => {
  test("telemetry is gated off by default", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitBrandInboundPipelineCreated(
      { source_post: "post-private-slug" },
      { env: {}, eventsPath, now: new Date("2026-06-30T12:00:00Z") },
    );

    expect(result.written).toBe(false);
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("telemetry writes only source_post presence when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitBrandInboundPipelineCreated(
      { source_post: "post-private-slug" },
      {
        env: { XOS_98_TELEMETRY: "1" },
        eventsPath,
        now: new Date("2026-06-30T12:00:00Z"),
      },
    );

    expect(result.written).toBe(true);
    expect(readEvents(eventsPath)).toEqual([
      {
        event: BRAND_INBOUND_PIPELINE_CREATED_EVENT,
        has_source_post: true,
        ts: "2026-06-30T12:00:00Z",
      },
    ]);

    const serialized = JSON.stringify(readEvents(eventsPath));
    expect(serialized).not.toContain("Acme AI");
    expect(serialized).not.toContain("Engineering Manager");
    expect(serialized).not.toContain("Priya Shah");
    expect(serialized).not.toContain("private-slug");
  });
});
