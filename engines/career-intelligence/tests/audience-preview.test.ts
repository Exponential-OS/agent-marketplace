import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  formatAudiencePreview,
  normalizeWarmth,
  scoreAudience,
  topicRelevance,
} from "../src/pipeline/audience-preview";
import {
  buildAudiencePreviewViewedEvent,
  emitAudiencePreviewViewed,
} from "../src/telemetry/events";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "audience-preview-test-"));
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

describe("audience preview helper", () => {
  test("normalizes messy warmth values without crashing", () => {
    expect(normalizeWarmth(4)).toBe(4);
    expect(normalizeWarmth(7)).toBe(5);
    expect(normalizeWarmth(null)).toBe(1);
    expect(normalizeWarmth(undefined)).toBe(1);
    expect(normalizeWarmth("4 (warm professional)")).toBe(4);
    expect(normalizeWarmth("5 — family, lifelong arc with the user")).toBe(5);
    expect(normalizeWarmth("warm professional")).toBe(2);
    expect(normalizeWarmth({ score: 5 })).toBe(1);
  });

  test("counts case-insensitive token overlap across contact fields", () => {
    const relevance = topicRelevance(["AI", "systems", "Platform", "sales"], {
      their_expertise: "AI systems architecture",
      role: "Platform lead",
      company: "Acme",
      they_told_us: { ignored: "sales" },
    });

    expect(relevance).toBe(3);
  });

  test("scores and ranks valid contacts while skipping malformed and nameless entries", () => {
    const ranked = scoreAudience(["AI", "systems"], [
      {
        name: "Bob",
        company: "DesignCo",
        role: "AI designer",
        warmth: "5 (peer)",
      },
      null,
      { company: "No Name Co", role: "AI systems" },
      {
        name: "Jane",
        company: "Acme",
        their_expertise: "AI systems architecture",
        warmth: 4,
      },
    ]);

    expect(ranked.map((contact) => [contact.name, contact.company, contact.relevance, contact.warmth, contact.score])).toEqual([
      ["Jane", "Acme", 2, 4, 8],
      ["Bob", "DesignCo", 1, 5, 5],
    ]);
    expect(ranked[0].matchedThemes).toEqual(["AI", "systems"]);
  });

  test("empty people returns an empty audience", () => {
    expect(scoreAudience(["AI"], [])).toEqual([]);
    expect(scoreAudience(["AI"], undefined)).toEqual([]);
  });

  test("zero-relevance contacts are EXCLUDED by default (opt-in to include)", () => {
    const people = [
      { name: "Relevant", their_expertise: "AI systems", warmth: 3 },
      { name: "Unrelated", role: "chef", company: "Bistro", warmth: 5 },
    ];
    // Default: only the topic-relevant contact — the high-warmth chef must NOT fill the list.
    const def = scoreAudience(["AI"], people);
    expect(def.map((c) => c.name)).toEqual(["Relevant"]);
    // A post matching nobody → empty, NOT padded with warm-but-irrelevant contacts.
    expect(scoreAudience(["quantum-biology"], people)).toEqual([]);
    // Opt-in still includes zero-relevance.
    expect(scoreAudience(["AI"], people, { includeZeroRelevance: true }).length).toBe(2);
  });

  test("formats paste-safe preview text without pipes and respects limit", () => {
    const ranked = scoreAudience(["AI", "systems", "design"], [
      {
        name: "Jane | Example",
        company: "Acme | Labs",
        their_expertise: "AI systems architecture",
        warmth: 4,
      },
      {
        name: "Bob",
        company: "DesignCo",
        role: "Design systems",
        warmth: 3,
      },
      {
        name: "Casey",
        company: "OtherCo",
        role: "Finance",
        warmth: 5,
      },
    ]);

    const preview = formatAudiencePreview(ranked, { limit: 2 });

    expect(preview).toContain("Warm contacts likely to see this post:");
    expect(preview).toContain("1. Jane / Example — Acme / Labs — why: matched themes: AI, systems");
    expect(preview).toContain("2. Bob — DesignCo — why: matched themes: systems, design");
    expect(preview).not.toContain("Casey");
    expect(preview).not.toContain("|");
  });
});

describe("audience preview telemetry", () => {
  test("telemetry is gated off by default", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const emitted = emitAudiencePreviewViewed(
      { audience_count: 2, top_score: 8 },
      {
        env: {},
        eventsPath,
        now: new Date("2026-06-30T12:20:00Z"),
      },
    );

    expect(emitted.written).toBe(false);
    expect(emitted.event).toEqual({
      event: "audience_preview_viewed",
      audience_count: 2,
      top_score_bucket: "5-9",
      ts: "2026-06-30T12:20:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("telemetry writes only count and score bucket when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const ranked = scoreAudience(["AI", "systems"], [
      {
        name: "Jane Private",
        company: "Acme Private",
        their_expertise: "AI systems architecture",
        warmth: 4,
      },
    ]);

    const emitted = emitAudiencePreviewViewed(
      { audience_count: ranked.length, top_score: ranked[0]?.score ?? 0 },
      {
        env: { XOS_98_TELEMETRY: "true" },
        eventsPath,
        now: new Date("2026-06-30T12:20:00Z"),
      },
    );

    expect(emitted.written).toBe(true);
    expect(readEvents(eventsPath)).toEqual([
      {
        event: "audience_preview_viewed",
        audience_count: 1,
        top_score_bucket: "5-9",
        ts: "2026-06-30T12:20:00Z",
      },
    ]);

    const serialized = JSON.stringify(readEvents(eventsPath));
    expect(serialized).not.toContain("Jane");
    expect(serialized).not.toContain("Acme");
    expect(serialized).not.toContain("AI systems architecture");
  });

  test("event builder buckets scores and clamps invalid counts", () => {
    expect(buildAudiencePreviewViewedEvent(
      { audience_count: -3, top_score: 25 },
      new Date("2026-06-30T12:20:00Z"),
    )).toEqual({
      event: "audience_preview_viewed",
      audience_count: 0,
      top_score_bucket: "20+",
      ts: "2026-06-30T12:20:00Z",
    });
  });
});
