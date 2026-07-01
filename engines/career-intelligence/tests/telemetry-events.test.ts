import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildBetaUserActivatedEvent,
  buildFirstArtifactCreatedEvent,
  emitArtifactCreated,
} from "../src/telemetry/beta-funnel";
import {
  buildContentToDmTrackedEvent,
  buildDashboardViewedEvent,
  buildInsightActedOnEvent,
  buildInsightCardViewedEvent,
  buildPostPromptFromConversationEvent,
  buildProfileChangeLoggedEvent,
  emitContentToDmTracked,
  emitDashboardViewed,
  emitEvent,
  emitInsightActedOn,
  emitInsightCardViewed,
  emitPostPromptFromConversation,
  emitProfileChangeLogged,
} from "../src/telemetry/events";
import {
  buildActiveUserTimeEvent,
  buildValidatedOutwardWinEvent,
  emitActiveUserTimeFromRecordedSession,
  recordSessionStart,
} from "../src/telemetry/nsm";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "xos98-telemetry-test-"));
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

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("XOS-98 local telemetry", () => {
  test("shared emitter is gated off by default and creates no file", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitEvent(
      { event: "unit_test_event", ts: "2026-06-28T12:00:00Z" },
      { env: {}, eventsPath },
    );

    expect(result.written).toBe(false);
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("content-to-DM helper is gated off by default and creates no file", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitContentToDmTracked(
      { post_id: "linkedin-post-123", dm_source: "linkedin" },
      {
        env: {},
        eventsPath,
        now: new Date("2026-06-28T12:00:00Z"),
      },
    );

    expect(result.written).toBe(false);
    expect(result.event).toEqual({
      event: "content_to_dm_tracked",
      post_id: "linkedin-post-123",
      dm_source: "linkedin",
      attributed_by: "user",
      ts: "2026-06-28T12:00:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("content-to-DM helper writes a local JSONL event when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitContentToDmTracked(
      {
        post_id: "linkedin-post-123",
        dm_source: "linkedin",
        contact_slug: "jane-recruiter",
      },
      {
        env: { XOS_98_TELEMETRY: "true" },
        eventsPath,
        now: new Date("2026-06-28T12:00:00Z"),
      },
    );
    const events = readEvents(eventsPath);

    expect(result.written).toBe(true);
    expect(result.path).toBe(eventsPath);
    expect(events).toEqual([
      {
        event: "content_to_dm_tracked",
        post_id: "linkedin-post-123",
        dm_source: "linkedin",
        contact_slug: "jane-recruiter",
        attributed_by: "user",
        ts: "2026-06-28T12:00:00Z",
      },
    ]);
  });

  test("content-to-DM event has required fields and optional defaults", () => {
    const event = buildContentToDmTrackedEvent(
      {
        post_id: "  x-post-456  ",
        dm_source: " email ",
      },
      new Date("2026-06-28T12:00:00Z"),
    );
    const inferredEvent = buildContentToDmTrackedEvent(
      {
        post_id: "linkedin-post-789",
        dm_source: "x",
        contact_slug: " recruiter-one ",
        attributed_by: "inferred",
      },
      new Date("2026-06-28T12:00:00Z"),
      "2026-W26",
    );

    expect(event).toEqual({
      event: "content_to_dm_tracked",
      post_id: "x-post-456",
      dm_source: "email",
      attributed_by: "user",
      ts: "2026-06-28T12:00:00Z",
    });
    expect(inferredEvent).toMatchObject({
      event: "content_to_dm_tracked",
      post_id: "linkedin-post-789",
      dm_source: "x",
      contact_slug: "recruiter-one",
      attributed_by: "inferred",
      cohort: "2026-W26",
      ts: "2026-06-28T12:00:00Z",
    });
  });

  test("conversation-to-post prompt helper is gated off by default and creates no file", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitPostPromptFromConversation(
      { conversation_source: "dm", contact_slug: "maya-recruiter" },
      {
        env: {},
        eventsPath,
        now: new Date("2026-06-30T12:00:00Z"),
      },
    );

    expect(result.written).toBe(false);
    expect(result.event).toEqual({
      event: "post_prompt_from_conversation",
      conversation_source: "dm",
      contact_slug: "maya-recruiter",
      ts: "2026-06-30T12:00:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("conversation-to-post prompt helper writes a local JSONL event when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitPostPromptFromConversation(
      {
        conversation_source: "meeting",
        contact_slug: "warm-contact",
        insight_summary: "Hiring managers respond to operator-led narratives.",
      },
      {
        env: { XOS_98_TELEMETRY: "true" },
        eventsPath,
        now: new Date("2026-06-30T12:00:00Z"),
      },
    );
    const events = readEvents(eventsPath);

    expect(result.written).toBe(true);
    expect(result.path).toBe(eventsPath);
    expect(events).toEqual([
      {
        event: "post_prompt_from_conversation",
        conversation_source: "meeting",
        contact_slug: "warm-contact",
        insight_summary: "Hiring managers respond to operator-led narratives.",
        ts: "2026-06-30T12:00:00Z",
      },
    ]);
  });

  test("conversation-to-post prompt event has required fields and optional defaults", () => {
    const event = buildPostPromptFromConversationEvent(
      {
        conversation_source: " relationship-refresh ",
      },
      new Date("2026-06-30T12:00:00Z"),
    );
    const eventWithOptionals = buildPostPromptFromConversationEvent(
      {
        conversation_source: " dm ",
        contact_slug: " senior-engineer ",
        insight_summary: " Strong opinion about founder-led sales. ",
      },
      new Date("2026-06-30T12:00:00Z"),
      "2026-W27",
    );

    expect(event).toEqual({
      event: "post_prompt_from_conversation",
      conversation_source: "relationship-refresh",
      ts: "2026-06-30T12:00:00Z",
    });
    expect(eventWithOptionals).toMatchObject({
      event: "post_prompt_from_conversation",
      conversation_source: "dm",
      contact_slug: "senior-engineer",
      insight_summary: "Strong opinion about founder-led sales.",
      cohort: "2026-W27",
      ts: "2026-06-30T12:00:00Z",
    });
  });

  test("insight-card viewed helper is gated off by default and creates no file", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitInsightCardViewed(
      { insight_kind: "weekly_inbound", week_of: "2026-06-29" },
      {
        env: {},
        eventsPath,
        now: new Date("2026-06-30T12:00:00Z"),
      },
    );

    expect(result.written).toBe(false);
    expect(result.event).toEqual({
      event: "insight_card_viewed",
      insight_kind: "weekly_inbound",
      week_of: "2026-06-29",
      ts: "2026-06-30T12:00:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("insight-card viewed helper writes a local JSONL event when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitInsightCardViewed(
      { insight_kind: "weekly_inbound", week_of: " 2026-06-29 " },
      {
        env: { XOS_98_TELEMETRY: "true" },
        eventsPath,
        now: new Date("2026-06-30T12:00:00Z"),
        cohort: "2026-W27",
      },
    );
    const events = readEvents(eventsPath);

    expect(result.written).toBe(true);
    expect(result.path).toBe(eventsPath);
    expect(events).toEqual([
      {
        event: "insight_card_viewed",
        insight_kind: "weekly_inbound",
        week_of: "2026-06-29",
        cohort: "2026-W27",
        ts: "2026-06-30T12:00:00Z",
      },
    ]);
  });

  test("insight acted-on helper is gated off by default and creates no file", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitInsightActedOn(
      { insight_kind: "weekly_inbound", action: "open_campaign_engine" },
      {
        env: {},
        eventsPath,
        now: new Date("2026-06-30T12:05:00Z"),
      },
    );

    expect(result.written).toBe(false);
    expect(result.event).toEqual({
      event: "insight_acted_on",
      insight_kind: "weekly_inbound",
      action: "open_campaign_engine",
      ts: "2026-06-30T12:05:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("insight acted-on helper writes a local JSONL event when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitInsightActedOn(
      {
        insight_kind: " weekly_inbound ",
        action: " open_campaign_engine ",
        week_of: " 2026-06-29 ",
      },
      {
        env: { XOS_98_TELEMETRY: "true" },
        eventsPath,
        now: new Date("2026-06-30T12:05:00Z"),
        cohort: "2026-W27",
      },
    );
    const events = readEvents(eventsPath);

    expect(result.written).toBe(true);
    expect(result.path).toBe(eventsPath);
    expect(events).toEqual([
      {
        event: "insight_acted_on",
        insight_kind: "weekly_inbound",
        action: "open_campaign_engine",
        week_of: "2026-06-29",
        cohort: "2026-W27",
        ts: "2026-06-30T12:05:00Z",
      },
    ]);
  });

  test("insight events have required fields and optional defaults", () => {
    const viewed = buildInsightCardViewedEvent(
      { insight_kind: " weekly_inbound " },
      new Date("2026-06-30T12:00:00Z"),
    );
    const acted = buildInsightActedOnEvent(
      {
        insight_kind: " weekly_inbound ",
        action: " post_more_on_topic ",
        week_of: " 2026-06-29 ",
      },
      new Date("2026-06-30T12:05:00Z"),
      "2026-W27",
    );

    expect(viewed).toEqual({
      event: "insight_card_viewed",
      insight_kind: "weekly_inbound",
      ts: "2026-06-30T12:00:00Z",
    });
    expect(acted).toEqual({
      event: "insight_acted_on",
      insight_kind: "weekly_inbound",
      action: "post_more_on_topic",
      week_of: "2026-06-29",
      cohort: "2026-W27",
      ts: "2026-06-30T12:05:00Z",
    });
  });

  test("profile-change helper is gated off by default and creates no file", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitProfileChangeLogged(
      { section: "headline", note: "rewrote headline around operator narrative" },
      {
        env: {},
        eventsPath,
        now: new Date("2026-06-30T12:10:00Z"),
      },
    );

    expect(result.written).toBe(false);
    expect(result.event).toEqual({
      event: "profile_change_logged",
      section: "headline",
      note: "rewrote headline around operator narrative",
      ts: "2026-06-30T12:10:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("profile-change helper writes a local JSONL event when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitProfileChangeLogged(
      {
        section: " summary ",
        note: " Added proof points for platform work. ",
      },
      {
        env: { XOS_98_TELEMETRY: "true" },
        eventsPath,
        now: new Date("2026-06-30T12:10:00Z"),
        cohort: "2026-W27",
      },
    );
    const events = readEvents(eventsPath);

    expect(result.written).toBe(true);
    expect(result.path).toBe(eventsPath);
    expect(events).toEqual([
      {
        event: "profile_change_logged",
        section: "summary",
        note: "Added proof points for platform work.",
        cohort: "2026-W27",
        ts: "2026-06-30T12:10:00Z",
      },
    ]);
  });

  test("profile-change event has required fields and optional defaults", () => {
    const event = buildProfileChangeLoggedEvent(
      { section: " experience ", note: " " },
      new Date("2026-06-30T12:10:00Z"),
    );
    const eventWithOptionals = buildProfileChangeLoggedEvent(
      { section: " headline ", note: " Shortened positioning. " },
      new Date("2026-06-30T12:10:00Z"),
      "2026-W27",
    );

    expect(event).toEqual({
      event: "profile_change_logged",
      section: "experience",
      ts: "2026-06-30T12:10:00Z",
    });
    expect(eventWithOptionals).toEqual({
      event: "profile_change_logged",
      section: "headline",
      note: "Shortened positioning.",
      cohort: "2026-W27",
      ts: "2026-06-30T12:10:00Z",
    });
  });

  test("dashboard viewed helper is gated off by default and creates no file", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitDashboardViewed(
      { has_career_data: true, has_brand_data: false },
      {
        env: {},
        eventsPath,
        now: new Date("2026-06-30T12:15:00Z"),
      },
    );

    expect(result.written).toBe(false);
    expect(result.event).toEqual({
      event: "dashboard_viewed",
      has_career_data: true,
      has_brand_data: false,
      ts: "2026-06-30T12:15:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("dashboard viewed helper writes a local JSONL event when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const result = emitDashboardViewed(
      { has_career_data: true, has_brand_data: true },
      {
        env: { XOS_98_TELEMETRY: "true" },
        eventsPath,
        now: new Date("2026-06-30T12:15:00Z"),
        cohort: "2026-W27",
      },
    );
    const events = readEvents(eventsPath);

    expect(result.written).toBe(true);
    expect(result.path).toBe(eventsPath);
    expect(events).toEqual([
      {
        event: "dashboard_viewed",
        has_career_data: true,
        has_brand_data: true,
        cohort: "2026-W27",
        ts: "2026-06-30T12:15:00Z",
      },
    ]);
  });

  test("dashboard viewed event keeps explicit boolean data flags", () => {
    const event = buildDashboardViewedEvent(
      { has_career_data: false, has_brand_data: true },
      new Date("2026-06-30T12:15:00Z"),
      " 2026-W27 ",
    );

    expect(event).toEqual({
      event: "dashboard_viewed",
      has_career_data: false,
      has_brand_data: true,
      cohort: "2026-W27",
      ts: "2026-06-30T12:15:00Z",
    });
  });

  test("telemetry source contains no network tokens", () => {
    const dir = join(import.meta.dir, "..", "src", "telemetry");
    const source = readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(dir, name), "utf-8"))
      .join("\n");

    expect(source).not.toMatch(/fetch|http|posthog|axios/i);
  });

  test("funnel and NSM event shapes avoid PII fields", () => {
    const events = [
      buildFirstArtifactCreatedEvent({ artifact_type: "outreach" }, new Date("2026-06-28T12:00:00Z")),
      buildBetaUserActivatedEvent({
        cohort: "2026-W26",
        trigger: "outreach",
      }, new Date("2026-06-28T12:00:00Z")),
      buildValidatedOutwardWinEvent({ kind: "interview" }, new Date("2026-06-28T12:00:00Z")),
      buildActiveUserTimeEvent({ seconds: 16 * 60 }, new Date("2026-06-28T12:00:00Z")),
    ];
    const keys = new Set(events.flatMap((event) => [...collectKeys(event)]));

    for (const piiKey of ["prompt", "content", "text", "person", "name", "salary", "company", "role"]) {
      expect(keys.has(piiKey)).toBe(false);
    }
  });

  test("artifact creation fires first artifact and activation, not VOW", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const statePath = join(root, "state.json");

    const result = emitArtifactCreated(
      { artifact_type: "resume" },
      {
        env: { XOS_98_TELEMETRY: "on" },
        eventsPath,
        statePath,
        now: new Date("2026-06-28T12:00:00Z"),
      },
    );
    const events = readEvents(eventsPath);

    expect(result.first_artifact.written).toBe(true);
    expect(result.activation?.written).toBe(true);
    expect(events.map((event) => event.event)).toEqual([
      "first_artifact_created",
      "beta_user_activated",
    ]);
    expect(events[1]).toMatchObject({
      event: "beta_user_activated",
      trigger: "resume",
    });
    expect(String(events[1].cohort)).toMatch(/^\d{4}-W\d{2}$/);
    expect(events.some((event) => event.event === "validated_outward_win")).toBe(false);
  });

  test("active user time emits only a coarse seconds bucket", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const statePath = join(root, "state.json");

    const start = recordSessionStart({
      env: { XOS_98_TELEMETRY: "1" },
      eventsPath,
      statePath,
      now: new Date("2026-06-28T12:00:00Z"),
    });
    const stop = emitActiveUserTimeFromRecordedSession({
      env: { XOS_98_TELEMETRY: "1" },
      eventsPath,
      statePath,
      now: new Date("2026-06-28T12:12:00Z"),
    });

    expect(start.written).toBe(true);
    expect(stop.written).toBe(true);
    expect(readEvents(eventsPath)).toEqual([
      {
        event: "active_user_time",
        seconds_bucket: "5_15m",
        ts: "2026-06-28T12:12:00Z",
      },
    ]);
  });
});
