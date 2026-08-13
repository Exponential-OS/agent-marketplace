import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  bootstrapIdentityFiles,
  buildBrandVoiceDoc,
  buildHandlesDoc,
  IDENTITY_BRAND_VOICE_PATH,
  IDENTITY_HANDLES_PATH,
} from "../src/pipeline/identity-bootstrap";
import { emitIdentityFileBootstrapped } from "../src/telemetry/events";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "identity-bootstrap-test-"));
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

describe("identity file bootstrap", () => {
  test("bootstrapIdentityFiles produces both durable identity files and paths", () => {
    const result = bootstrapIdentityFiles({
      name: "Anand",
      linkedin: "anandv",
      themes: ["AI systems"],
      voiceLine: "builder",
    });

    expect(result.files.map((file) => file.path)).toEqual([
      IDENTITY_HANDLES_PATH,
      IDENTITY_BRAND_VOICE_PATH,
    ]);
    expect(result.filesCreated).toEqual([
      IDENTITY_HANDLES_PATH,
      IDENTITY_BRAND_VOICE_PATH,
    ]);
    expect(result.files[0].content).toContain("- Name: Anand");
    expect(result.files[0].content).toContain("- LinkedIn: anandv");
    expect(result.files[1].content).toContain("- AI systems");
    expect(result.files[1].content).toContain("builder");
  });

  test("buildHandlesDoc omits blank handle fields", () => {
    const doc = buildHandlesDoc({
      name: "  Anand  ",
      linkedin: " anandv ",
      github: " ",
      substack: "",
      website: "example.com/anand",
    });

    expect(doc).toContain("- Name: Anand");
    expect(doc).toContain("- LinkedIn: anandv");
    expect(doc).toContain("- Website: example.com/anand");
    expect(doc).not.toContain("GitHub");
    expect(doc).not.toContain("Substack");
  });

  test("buildBrandVoiceDoc writes a TODO stub on empty input", () => {
    const doc = buildBrandVoiceDoc();

    expect(doc).toContain("## Themes");
    expect(doc).toContain("- TODO: Add recurring themes.");
    expect(doc).toContain("## Voice");
    expect(doc).toContain("TODO: Add a one-line description");
  });
});

describe("identity file bootstrap telemetry", () => {
  test("telemetry is gated off by default", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const filesCreated = bootstrapIdentityFiles().filesCreated;
    const result = emitIdentityFileBootstrapped(
      { files_created: filesCreated },
      {
        env: {},
        eventsPath,
        now: new Date("2026-07-01T12:00:00Z"),
      },
    );

    expect(result.written).toBe(false);
    expect(result.event).toEqual({
      event: "identity_file_bootstrapped",
      files_created: [
        IDENTITY_HANDLES_PATH,
        IDENTITY_BRAND_VOICE_PATH,
      ],
      count: 2,
      ts: "2026-07-01T12:00:00Z",
    });
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("telemetry writes only relative file paths and count when enabled", () => {
    const root = makeRoot();
    const eventsPath = join(root, "events.jsonl");
    const bootstrapped = bootstrapIdentityFiles({
      name: "Anand",
      linkedin: "anandv",
      email: "anand@example.com",
      themes: ["AI systems"],
      voiceLine: "builder",
    });
    const result = emitIdentityFileBootstrapped(
      { files_created: bootstrapped.filesCreated },
      {
        env: { XOS_98_TELEMETRY: "1" },
        eventsPath,
        now: new Date("2026-07-01T12:00:00Z"),
      },
    );

    expect(result.written).toBe(true);
    expect(readEvents(eventsPath)).toEqual([
      {
        event: "identity_file_bootstrapped",
        files_created: [
          IDENTITY_HANDLES_PATH,
          IDENTITY_BRAND_VOICE_PATH,
        ],
        count: 2,
        ts: "2026-07-01T12:00:00Z",
      },
    ]);

    const serialized = JSON.stringify(readEvents(eventsPath));
    expect(serialized).not.toContain("Anand");
    expect(serialized).not.toContain("anandv");
    expect(serialized).not.toContain("anand@example.com");
    expect(serialized).not.toContain("AI systems");
    expect(serialized).not.toContain("builder");
    expect(serialized).not.toContain("content");
  });
});
