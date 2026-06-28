import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildCoverLetterGeneratedEvent,
  emitCoverLetterGenerated,
  isXos98TelemetryEnabled,
} from "../src/cover-letter/events";

const roots: string[] = [];

function makeEventsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "cover-letter-events-test-"));
  roots.push(root);
  return join(root, "events.jsonl");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("cover letter generated event", () => {
  test("builds the expected event shape", () => {
    expect(
      buildCoverLetterGeneratedEvent(
        { standalone: true, company: "  Acme  ", role: " VP Engineering " },
        new Date("2026-06-28T12:34:56.789Z"),
      ),
    ).toEqual({
      event: "cover_letter_generated",
      standalone: true,
      company: "Acme",
      role: "VP Engineering",
      ts: "2026-06-28T12:34:56Z",
    });
  });

  test("is gated off by default and does not create an events file", () => {
    const eventsPath = makeEventsPath();
    const result = emitCoverLetterGenerated(
      { standalone: true, company: "Acme", role: "VP Engineering" },
      { env: {}, eventsPath, now: new Date("2026-06-28T12:34:56Z") },
    );

    expect(result.written).toBe(false);
    expect(result.event.event).toBe("cover_letter_generated");
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("writes one local JSONL event when XOS_98_TELEMETRY is enabled", () => {
    const eventsPath = makeEventsPath();
    const result = emitCoverLetterGenerated(
      { standalone: false, company: "Acme", role: "VP Engineering" },
      {
        env: { XOS_98_TELEMETRY: "1" },
        eventsPath,
        now: new Date("2026-06-28T12:34:56Z"),
      },
    );

    expect(result.written).toBe(true);
    expect(result.path).toBe(eventsPath);
    expect(readFileSync(eventsPath, "utf-8")).toBe(
      JSON.stringify({
        event: "cover_letter_generated",
        standalone: false,
        company: "Acme",
        role: "VP Engineering",
        ts: "2026-06-28T12:34:56Z",
      }) + "\n",
    );
  });

  test("recognizes explicit XOS_98_TELEMETRY truthy values only", () => {
    expect(isXos98TelemetryEnabled({ XOS_98_TELEMETRY: "true" })).toBe(true);
    expect(isXos98TelemetryEnabled({ XOS_98_TELEMETRY: "on" })).toBe(true);
    expect(isXos98TelemetryEnabled({ XOS_98_TELEMETRY: "0" })).toBe(false);
    expect(isXos98TelemetryEnabled({})).toBe(false);
  });
});
