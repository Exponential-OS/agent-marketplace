import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  quoteHash,
  readQuoteLog,
  type BrainTelemetryWriter,
  type QuoteLogRecord,
} from "../scripts/quote-selector";
import {
  shouldSurfaceToday,
  surfaceTodaysDraft,
} from "../scripts/daily-cadence";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "daily-cadence-test-"));
}

function quoteDeck(lines: string[]): string {
  return [
    "# Cyborg Quotes",
    "",
    "## §1 — POST FREELY (universal wisdom)",
    "",
    ...lines,
    "",
    "## §2 — HOLD until provisional filed — firewall + patent gate",
    "",
    '- "A §2 line that must never become a candidate." — 2026-06-29 [you]',
    "",
    "## §3 — BORROWED (attribute; never post as original)",
    "",
    '- "A borrowed line that must never become a candidate." — someone [cyborg]',
  ].join("\n");
}

function writeJsonl(path: string, records: QuoteLogRecord[]): void {
  writeFileSync(
    path,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

describe("daily cadence once-per-day guard", () => {
  test("tolerates a malformed log record missing drafted_at (no crash → not today)", () => {
    const malformed = [
      { quote_hash: "x", quote_text: "legacy record without drafted_at", status: "drafted" },
    ] as unknown as QuoteLogRecord[];
    const result = shouldSurfaceToday(malformed, "2026-06-30T12:00:00.000Z");
    expect(result.surfaced).toBe(true);
    expect(result.reason).toBe("not_surfaced_today");
  });

  test("returns already_surfaced_today when a quote was drafted today", async () => {
    const tmp = makeTmpDir();
    const deckPath = join(tmp, "cyborg-quotes.md");
    const logPath = join(tmp, "quote-flywheel-log.jsonl");
    writeFileSync(
      deckPath,
      quoteDeck(['- "Safe daily line." — 2026-06-29 [you]']),
    );
    const existing: QuoteLogRecord = {
      quote_hash: quoteHash("Safe daily line.", "you"),
      quote_text: "Safe daily line.",
      provenance: "you",
      drafted_at: "2026-06-30T08:00:00.000Z",
      status: "drafted",
      source: "quote-flywheel",
    };
    writeJsonl(logPath, [existing]);

    expect(shouldSurfaceToday([existing], "2026-06-30T12:00:00.000Z")).toEqual({
      surfaced: false,
      reason: "already_surfaced_today",
      existing,
    });

    const result = await surfaceTodaysDraft({
      deckPath,
      logPath,
      now: new Date("2026-06-30T12:00:00.000Z"),
    });

    expect(result).toEqual({
      surfaced: false,
      reason: "already_surfaced_today",
      existing,
    });
    expect(readQuoteLog(logPath)).toHaveLength(1);
  });

  test("surfaces a §1 draft when the log has no today draft", async () => {
    const tmp = makeTmpDir();
    const deckPath = join(tmp, "cyborg-quotes.md");
    const logPath = join(tmp, "quote-flywheel-log.jsonl");
    writeFileSync(
      deckPath,
      quoteDeck([
        '- "First safe daily line." — 2026-06-29 [you]',
        '- "Second safe daily line." — 2026-06-29 [cyborg]',
      ]),
    );
    writeJsonl(logPath, [
      {
        quote_hash: quoteHash("First safe daily line.", "you"),
        quote_text: "First safe daily line.",
        provenance: "you",
        drafted_at: "2026-05-01T08:00:00.000Z",
        status: "drafted",
        source: "quote-flywheel",
      },
    ]);

    const result = await surfaceTodaysDraft({
      deckPath,
      logPath,
      now: new Date("2026-06-30T08:00:00.000Z"),
    });

    expect(result.surfaced).toBe(true);
    if (!result.surfaced) throw new Error("expected daily draft");
    expect(result.quote.sourceSection).toBe("§1");
    expect(result.quote.text).toBe("Second safe daily line.");
    expect(result.draft).toContain('"Second safe daily line."');
    expect(result.draft).not.toContain("§2 line");
    expect(result.draft).not.toContain("borrowed line");
    expect(result.draft).not.toContain("|");
    expect(result.logRecord.status).toBe("drafted");
    expect(result.logRecord.drafted_at).toBe("2026-06-30T08:00:00.000Z");

    const records = readQuoteLog(logPath);
    expect(records).toHaveLength(2);
    expect(records[1].quote_hash).toBe(result.quote.quote_hash);
  });

  test("treats an empty log as no today draft", async () => {
    const tmp = makeTmpDir();
    const deckPath = join(tmp, "cyborg-quotes.md");
    const logPath = join(tmp, "missing-log.jsonl");
    writeFileSync(
      deckPath,
      quoteDeck(['- "Empty log safe line." — 2026-06-29 [you]']),
    );

    expect(existsSync(logPath)).toBe(false);
    const result = await surfaceTodaysDraft({
      deckPath,
      logPath,
      nowIso: "2026-06-30T08:00:00.000Z",
    });

    expect(result.surfaced).toBe(true);
    if (!result.surfaced) throw new Error("expected daily draft");
    expect(result.quote.text).toBe("Empty log safe line.");
    expect(readQuoteLog(logPath)).toHaveLength(1);
  });
});

describe("daily cadence telemetry", () => {
  test("quote_daily_surfaced telemetry is gated by XOS_98_TELEMETRY", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    let stored = "";
    const brain: BrainTelemetryWriter = {
      read: async (path) => ({
        ok: true,
        content: path === "brand-amplification/telemetry/events.jsonl" ? stored : null,
      }),
      write: async (path, content) => {
        stored = content;
        writes.push({ path, content });
        return { ok: true, path };
      },
    };

    const disabledTmp = makeTmpDir();
    const disabledDeck = join(disabledTmp, "cyborg-quotes.md");
    const disabledLog = join(disabledTmp, "quote-flywheel-log.jsonl");
    writeFileSync(
      disabledDeck,
      quoteDeck(['- "Telemetry off safe line." — 2026-06-29 [you]']),
    );

    const disabled = await surfaceTodaysDraft({
      deckPath: disabledDeck,
      logPath: disabledLog,
      brain,
      env: {},
      now: new Date("2026-06-30T08:00:00.000Z"),
    });
    expect(disabled.surfaced).toBe(true);
    if (!disabled.surfaced) throw new Error("expected disabled draft");
    expect(disabled.telemetry).toEqual({ emitted: false, reason: "disabled" });
    expect(writes).toHaveLength(0);

    const enabledTmp = makeTmpDir();
    const enabledDeck = join(enabledTmp, "cyborg-quotes.md");
    const enabledLog = join(enabledTmp, "quote-flywheel-log.jsonl");
    writeFileSync(
      enabledDeck,
      quoteDeck(['- "Telemetry on safe line." — 2026-06-29 [cyborg]']),
    );

    const enabled = await surfaceTodaysDraft({
      deckPath: enabledDeck,
      logPath: enabledLog,
      brain,
      env: { XOS_98_TELEMETRY: "1" },
      now: new Date("2026-06-30T09:00:00.000Z"),
    });

    expect(enabled.surfaced).toBe(true);
    if (!enabled.surfaced) throw new Error("expected enabled draft");
    expect(enabled.telemetry).toEqual({
      emitted: true,
      path: "brand-amplification/telemetry/events.jsonl",
    });
    expect(writes).toHaveLength(1);

    const events = stored.trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "quote_daily_surfaced",
      quote_hash: enabled.quote.quote_hash,
      source_section: "§1",
      mode: "DRAFT_ONLY",
      ts: "2026-06-30T09:00:00.000Z",
    });
  });
});
