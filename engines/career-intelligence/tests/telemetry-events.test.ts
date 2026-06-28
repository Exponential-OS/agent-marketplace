import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildBetaUserActivatedEvent,
  buildFirstArtifactCreatedEvent,
  emitArtifactCreated,
} from "../src/telemetry/beta-funnel";
import { emitEvent } from "../src/telemetry/events";
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
