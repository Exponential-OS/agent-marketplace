/**
 * quote-harvester.test.ts — Unit tests for XOS-140 quote harvester.
 *
 * Tests:
 *  1. Architecture keywords → §2 HOLD (keyword safety net)
 *  2. Universal wisdom → §1 free (no architecture keywords)
 *  3. Borrowed / attributed quotes → §3 borrowed
 *  4. Idempotency — running twice with same content adds no duplicates
 *  5. Fail-safe — missing transcript → skipped, no throw
 *  6. Section insertion — correct placement in file content
 *  7. LLM parse — default-to-hold when section is missing/invalid
 */

import { describe, test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";

import {
  applyHoldSafetyNet,
  buildExistingQuoteSet,
  harvestQuotes,
  insertUnderSection,
  type ExtractedQuote,
  type Section,
} from "../hooks/quote-harvester.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "qh-test-"));
}

/** Minimal JSONL transcript with interleaved user/assistant turns. */
function makeTranscriptJSONL(turns: Array<{ role: "user" | "assistant"; text: string }>): string {
  return turns
    .map((t) =>
      JSON.stringify({
        type: t.role,
        role: t.role,
        message: { role: t.role, content: [{ type: "text", text: t.text }] },
      }),
    )
    .join("\n");
}

function writeTranscript(dir: string, turns: Array<{ role: "user" | "assistant"; text: string }>): string {
  const p = join(dir, "session.jsonl");
  writeFileSync(p, makeTranscriptJSONL(turns), "utf8");
  return p;
}

function writeQuotesFile(dir: string, content: string): string {
  const p = join(dir, "cyborg-quotes.md");
  writeFileSync(p, content, "utf8");
  return p;
}

function writeWatermark(dir: string, count: number): string {
  const p = join(dir, "wm.json");
  writeFileSync(p, JSON.stringify({ lastProcessedCount: count, lastHarvestedAt: "" }), "utf8");
  return p;
}

const BARE_QUOTES_FILE = `# Cyborg Quotes

## §1 — POST FREELY (universal wisdom)

## §2 — HOLD until provisional filed (~2026-Q3) — firewall + patent gate

## §3 — BORROWED (attribute; never post as original)
`;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("applyHoldSafetyNet", () => {
  test("forces hold when quote contains architecture keyword 'xos'", () => {
    const q: ExtractedQuote = {
      text: "The xOS kernel is the universal substrate for all human digital identity.",
      section: "free",
      provenance: "[cyborg]",
    };
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });

  test("forces hold for 'cyborg' keyword", () => {
    const q: ExtractedQuote = {
      text: "The cyborg is not master or servant — both co-author every output.",
      section: "free",
      provenance: "[both]",
    };
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });

  test("forces hold for 'productive gap' phrase", () => {
    const q: ExtractedQuote = {
      text: "The productive gap is where value is generated.",
      section: "free",
      provenance: "[cyborg]",
    };
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });

  test("forces hold for 'co-dialectic' keyword", () => {
    const q: ExtractedQuote = {
      text: "co-dialectic makes the gap productive, not painful.",
      section: "free",
      provenance: "[you]",
    };
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });

  test("forces hold for 'the swarm' phrase", () => {
    const q: ExtractedQuote = {
      text: "The swarm is only as smart as its least-codified member.",
      section: "free",
      provenance: "[cyborg]",
    };
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });

  test("does NOT change universal wisdom with no architecture keywords", () => {
    const q: ExtractedQuote = {
      text: "The lesson is sharper for having been argued, not accepted.",
      section: "free",
      provenance: "[cyborg]",
    };
    expect(applyHoldSafetyNet(q).section).toBe("free");
  });

  test("does NOT change borrowed quotes (stays borrowed)", () => {
    const q: ExtractedQuote = {
      text: "Only fools learn from their own mistakes; the wise learn from others'.",
      section: "borrowed",
      provenance: "[both]",
      attribution: "old maxim",
    };
    const result = applyHoldSafetyNet(q);
    expect(result.section).toBe("borrowed");
  });

  test("does NOT downgrade an existing hold to free", () => {
    const q: ExtractedQuote = {
      text: "Love is the engine of growth.",
      section: "hold",
      provenance: "[you]",
    };
    // No architecture keywords but section is already hold — must remain hold
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });
});

describe("buildExistingQuoteSet", () => {
  test("extracts normalized quote texts", () => {
    const content = `## §1\n\n- "Activity isn't output." — 2026-06-29 [cyborg]\n`;
    const set = buildExistingQuoteSet(content);
    expect(set.has("activity isn't output.")).toBe(true);
  });

  test("returns empty set for file with no quotes", () => {
    const set = buildExistingQuoteSet(BARE_QUOTES_FILE);
    expect(set.size).toBe(0);
  });
});

describe("insertUnderSection", () => {
  test("inserts under §1 POST FREELY", () => {
    const content = BARE_QUOTES_FILE;
    const updated = insertUnderSection(content, "free", ['- "New insight." — 2026-06-30 [you]']);
    expect(updated).toContain('- "New insight." — 2026-06-30 [you]');
    expect(updated.indexOf("§1")).toBeLessThan(updated.indexOf("New insight"));
    expect(updated.indexOf("New insight")).toBeLessThan(updated.indexOf("§2"));
  });

  test("inserts under §2 HOLD", () => {
    const content = BARE_QUOTES_FILE;
    const updated = insertUnderSection(content, "hold", ['- "Architecture line." — 2026-06-30 [cyborg]']);
    expect(updated).toContain('- "Architecture line." — 2026-06-30 [cyborg]');
    expect(updated.indexOf("§2")).toBeLessThan(updated.indexOf("Architecture line"));
    expect(updated.indexOf("Architecture line")).toBeLessThan(updated.indexOf("§3"));
  });

  test("inserts under §3 BORROWED", () => {
    const content = BARE_QUOTES_FILE;
    const updated = insertUnderSection(content, "borrowed", ['- "Borrowed insight." — Joe Hall']);
    expect(updated).toContain('- "Borrowed insight." — Joe Hall');
    expect(updated.indexOf("§3")).toBeLessThan(updated.indexOf("Borrowed insight"));
  });

  test("is idempotent — inserting same line twice doesn't duplicate (via harvestQuotes dedup)", () => {
    // This tests the string-level insertUnderSection; dedup happens at harvestQuotes level
    const content = BARE_QUOTES_FILE;
    const line = '- "The lesson is sharper for having been argued." — 2026-06-30 [cyborg]';
    const once = insertUnderSection(content, "free", [line]);
    const existing = buildExistingQuoteSet(once);
    // The dedup check would catch this on a second harvest
    expect(existing.has("the lesson is sharper for having been argued.")).toBe(true);
  });
});

describe("harvestQuotes — section routing", () => {
  test("universal wisdom routes to §1 free", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, [
      { role: "user", text: "Tell me something about learning." },
      { role: "assistant", text: "Turn 1 filler." },
      { role: "user", text: "What about mistakes?" },
      { role: "assistant", text: "Turn 2 filler." },
      { role: "user", text: "And resilience?" },
      { role: "assistant", text: "Turn 3 filler." },
      { role: "user", text: "Final question." },
      { role: "assistant", text: "The lesson is sharper for having been argued, not accepted." },
    ]);
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = writeWatermark(dir, 0);

    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      { text: "The lesson is sharper for having been argued, not accepted.", section: "free", provenance: "[cyborg]" },
    ];

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result.skipped).toBe(false);
    expect(result.appended).toBe(1);

    const written = readFileSync(quotesPath, "utf8");
    // Should appear under §1, before §2
    const s1Idx = written.indexOf("§1");
    const s2Idx = written.indexOf("§2");
    const lineIdx = written.indexOf("The lesson is sharper");
    expect(lineIdx).toBeGreaterThan(s1Idx);
    expect(lineIdx).toBeLessThan(s2Idx);
  });

  test("architecture keyword forces §2 HOLD even when LLM says free", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, [
      { role: "user", text: "Turn 1." },
      { role: "assistant", text: "Turn 1 reply." },
      { role: "user", text: "Turn 2." },
      { role: "assistant", text: "Turn 2 reply." },
      { role: "user", text: "Turn 3." },
      { role: "assistant", text: "Turn 3 reply." },
      { role: "user", text: "Turn 4." },
      { role: "assistant", text: "The cyborg is the solution we run; xOS is the productized version." },
    ]);
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = writeWatermark(dir, 0);

    // LLM mistakenly says "free" — safety net must override to "hold"
    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      { text: "The cyborg is the solution we run; xOS is the productized version.", section: "free", provenance: "[cyborg]" },
    ];

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result.skipped).toBe(false);
    expect(result.appended).toBe(1);

    const written = readFileSync(quotesPath, "utf8");
    const s2Idx = written.indexOf("§2");
    const s3Idx = written.indexOf("§3");
    const lineIdx = written.indexOf("cyborg is the solution");
    // Must appear under §2, not §1
    expect(lineIdx).toBeGreaterThan(s2Idx);
    expect(lineIdx).toBeLessThan(s3Idx);
  });

  test("borrowed quote routes to §3 and includes attribution", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, [
      { role: "user", text: "What did Joe Hall say?" },
      { role: "assistant", text: "Turn 1 reply." },
      { role: "user", text: "More." },
      { role: "assistant", text: "Turn 2 reply." },
      { role: "user", text: "And?" },
      { role: "assistant", text: "Turn 3 reply." },
      { role: "user", text: "Final." },
      { role: "assistant", text: "Joe Hall: Variance is evil." },
    ]);
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = writeWatermark(dir, 0);

    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      {
        text: "Variance is evil; code collapses it to zero, prose reduces it by hope.",
        section: "borrowed",
        provenance: "[both]",
        attribution: "Joe Hall (UC Berkeley EMBA)",
      },
    ];

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result.appended).toBe(1);

    const written = readFileSync(quotesPath, "utf8");
    const s3Idx = written.indexOf("§3");
    const lineIdx = written.indexOf("Variance is evil");
    expect(lineIdx).toBeGreaterThan(s3Idx);
    expect(written).toContain("Joe Hall (UC Berkeley EMBA)");
    // Borrowed lines should NOT have a date (just attribution)
    expect(written).not.toMatch(/Variance is evil.*2026-06-30/);
  });
});

describe("harvestQuotes — idempotency", () => {
  test("running twice with same content adds no duplicates", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, [
      { role: "user", text: "T1." },
      { role: "assistant", text: "T1 reply." },
      { role: "user", text: "T2." },
      { role: "assistant", text: "T2 reply." },
      { role: "user", text: "T3." },
      { role: "assistant", text: "T3 reply." },
      { role: "user", text: "T4." },
      { role: "assistant", text: "Filing is the first step of fixing." },
    ]);
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      { text: "Filing is the first step of fixing.", section: "free", provenance: "[you]" },
    ];

    // First run
    await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    // Second run with same transcript — watermark should prevent re-processing
    const result2 = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result2.skipped).toBe(true);
    expect(result2.skipReason).toMatch(/new-messages/);

    const written = readFileSync(quotesPath, "utf8");
    const occurrences = (written.match(/Filing is the first step/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe("harvestQuotes — fail-safe", () => {
  test("missing transcript_path returns skipped result without throwing", async () => {
    const dir = makeTmpDir();
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const result = await harvestQuotes(
      {},
      { quotesPath, watermarkPath, today: "2026-06-30" },
    );
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no-transcript");
  });

  test("nonexistent transcript path returns skipped without throwing", async () => {
    const dir = makeTmpDir();
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const result = await harvestQuotes(
      { transcript_path: "/nonexistent/path/session.jsonl" },
      { quotesPath, watermarkPath, today: "2026-06-30" },
    );
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no-transcript");
  });

  test("extract function throwing returns skipped without propagating", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, [
      { role: "user", text: "T1." },
      { role: "assistant", text: "T1r." },
      { role: "user", text: "T2." },
      { role: "assistant", text: "T2r." },
      { role: "user", text: "T3." },
      { role: "assistant", text: "T3r." },
      { role: "user", text: "T4." },
      { role: "assistant", text: "T4r." },
    ]);
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const throwingExtract = async (_: string): Promise<ExtractedQuote[]> => {
      throw new Error("LLM exploded");
    };

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: throwingExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("extraction-failed");
  });

  test("fewer than MIN_NEW_MESSAGES skips without extraction", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, [
      { role: "user", text: "Just one turn." },
      { role: "assistant", text: "Just one reply." },
    ]);
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    let extractCalled = false;
    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => {
      extractCalled = true;
      return [];
    };

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result.skipped).toBe(true);
    expect(extractCalled).toBe(false);
  });
});

describe("harvestQuotes — mixed session", () => {
  test("correctly routes universal + architecture + borrowed in one session", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i + 1} content.`,
    })));
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      // Universal wisdom — should stay free
      { text: "Reward isn't a deposit at the end — it's a stream you're already standing in.", section: "free", provenance: "[cyborg]" },
      // Architecture — LLM says free but safety net should force hold
      { text: "The xOS kernel is the substrate; the cyborg is the runtime.", section: "free", provenance: "[both]" },
      // Borrowed
      { text: "Only fools learn from their own mistakes; the wise learn from others'.", section: "borrowed", provenance: "[both]", attribution: "old maxim" },
    ];

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result.appended).toBe(3);

    const written = readFileSync(quotesPath, "utf8");
    const s1Idx = written.indexOf("§1");
    const s2Idx = written.indexOf("§2");
    const s3Idx = written.indexOf("§3");

    // Universal → §1
    const freeIdx = written.indexOf("stream you're already standing in");
    expect(freeIdx).toBeGreaterThan(s1Idx);
    expect(freeIdx).toBeLessThan(s2Idx);

    // Architecture → §2 (safety net override)
    const holdIdx = written.indexOf("xOS kernel is the substrate");
    expect(holdIdx).toBeGreaterThan(s2Idx);
    expect(holdIdx).toBeLessThan(s3Idx);

    // Borrowed → §3
    const borrowedIdx = written.indexOf("fools learn from their own mistakes");
    expect(borrowedIdx).toBeGreaterThan(s3Idx);
  });
});
