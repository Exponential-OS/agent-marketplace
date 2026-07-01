import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { summarizeWeeklyContentInbound } from "../src/telemetry/weekly-inbound";

const roots: string[] = [];
const NOW = new Date("2026-06-30T12:00:00Z");

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "xos89-weekly-inbound-test-"));
  roots.push(root);
  return root;
}

function writeJsonl(path: string, events: Array<Record<string, unknown> | string>): void {
  writeFileSync(
    path,
    events.map((event) => typeof event === "string" ? event : JSON.stringify(event)).join("\n") + "\n",
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("weekly content-attributed inbound summary", () => {
  test("missing or empty JSONL returns zeros", () => {
    const root = makeRoot();
    const missingEventsPath = join(root, "missing-events.jsonl");
    const emptyEventsPath = join(root, "empty-events.jsonl");
    writeFileSync(emptyEventsPath, "");

    expect(summarizeWeeklyContentInbound({ eventsPath: missingEventsPath, now: NOW })).toEqual({
      total: 0,
      byPost: [],
    });
    expect(summarizeWeeklyContentInbound({ eventsPath: emptyEventsPath, now: NOW })).toEqual({
      total: 0,
      byPost: [],
    });
  });

  test("multiple content-to-DM events are counted and grouped by post_id", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    writeJsonl(eventsPath, [
      {
        event: "content_to_dm_tracked",
        post_id: "post-b",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-29T09:00:00Z",
      },
      {
        event: "post_prompt_from_conversation",
        conversation_source: "dm",
        ts: "2026-06-29T10:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "post-a",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-28T09:00:00Z",
      },
      "{malformed",
      {
        event: "content_to_dm_tracked",
        post_id: "post-b",
        dm_source: "email",
        attributed_by: "inferred",
        ts: "2026-06-27T09:00:00Z",
      },
    ]);

    expect(summarizeWeeklyContentInbound({ eventsPath, now: NOW })).toEqual({
      total: 3,
      byPost: [
        { post_id: "post-b", count: 2 },
        { post_id: "post-a", count: 1 },
      ],
    });
  });

  test("respects the last seven-day window", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    writeJsonl(eventsPath, [
      {
        event: "content_to_dm_tracked",
        post_id: "too-old",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-23T11:59:59Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "at-cutoff",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-23T12:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "current-week",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-30T11:59:59Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "future",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-30T12:00:01Z",
      },
    ]);

    expect(summarizeWeeklyContentInbound({ eventsPath, now: NOW })).toEqual({
      total: 2,
      byPost: [
        { post_id: "at-cutoff", count: 1 },
        { post_id: "current-week", count: 1 },
      ],
    });
  });
});
