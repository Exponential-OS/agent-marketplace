import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { summarizeProfileChangeImpact } from "../src/telemetry/profile-inbound-impact";

const roots: string[] = [];
const CHANGE_TS = "2026-06-30T12:00:00Z";

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "xos94-profile-impact-test-"));
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

describe("profile change inbound impact summary", () => {
  test("missing or empty JSONL returns zeros", () => {
    const root = makeRoot();
    const missingEventsPath = join(root, "missing-events.jsonl");
    const emptyEventsPath = join(root, "empty-events.jsonl");
    writeFileSync(emptyEventsPath, "");

    expect(summarizeProfileChangeImpact(CHANGE_TS, { eventsPath: missingEventsPath })).toEqual({
      beforeCount: 0,
      afterCount: 0,
      inboundRateChange: 0,
      windowDays: 30,
    });
    expect(summarizeProfileChangeImpact(CHANGE_TS, { eventsPath: emptyEventsPath })).toEqual({
      beforeCount: 0,
      afterCount: 0,
      inboundRateChange: 0,
      windowDays: 30,
    });
  });

  test("counts inbound DMs in the 30 days before and after the change", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    writeJsonl(eventsPath, [
      {
        event: "content_to_dm_tracked",
        post_id: "before-one",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-01T12:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "before-two",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-15T12:00:00Z",
      },
      {
        event: "profile_change_logged",
        section: "headline",
        ts: CHANGE_TS,
      },
      {
        event: "content_to_dm_tracked",
        post_id: "after-one",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-07-01T12:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "after-two",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-07-15T12:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "after-three",
        dm_source: "email",
        attributed_by: "inferred",
        ts: "2026-07-30T12:00:00Z",
      },
    ]);

    expect(summarizeProfileChangeImpact(CHANGE_TS, { eventsPath })).toEqual({
      beforeCount: 2,
      afterCount: 3,
      inboundRateChange: 1,
      windowDays: 30,
    });
  });

  test("respects the exact 30-day boundaries around the profile change", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    writeJsonl(eventsPath, [
      {
        event: "content_to_dm_tracked",
        post_id: "too-old",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-05-31T11:59:59.999Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "before-cutoff",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-05-31T12:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "just-before",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-30T11:59:59.999Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "at-change",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: CHANGE_TS,
      },
      {
        event: "content_to_dm_tracked",
        post_id: "just-after",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-30T12:00:00.001Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "after-cutoff",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-07-30T12:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "future",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-07-30T12:00:00.001Z",
      },
    ]);

    expect(summarizeProfileChangeImpact(CHANGE_TS, { eventsPath })).toEqual({
      beforeCount: 2,
      afterCount: 2,
      inboundRateChange: 0,
      windowDays: 30,
    });
  });

  test("malformed lines and invalid events are ignored without throwing", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    writeJsonl(eventsPath, [
      "{malformed",
      {
        event: "content_to_dm_tracked",
        post_id: "valid-before",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-06-29T12:00:00Z",
      },
      {
        event: "content_to_dm_tracked",
        post_id: "invalid-ts",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "not-a-date",
      },
      {
        event: "content_to_dm_tracked",
        post_id: " ",
        dm_source: "linkedin",
        attributed_by: "user",
        ts: "2026-07-01T12:00:00Z",
      },
      {
        event: "post_prompt_from_conversation",
        conversation_source: "dm",
        ts: "2026-07-01T12:00:00Z",
      },
    ]);

    expect(summarizeProfileChangeImpact(CHANGE_TS, { eventsPath })).toEqual({
      beforeCount: 1,
      afterCount: 0,
      inboundRateChange: -1,
      windowDays: 30,
    });
  });
});
