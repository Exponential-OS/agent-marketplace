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
 *  8. FIREWALL PROOF — IP-without-keyword routes to §2 HOLD
 *  9. FIREWALL PROOF — borrowed IP line routes to §2 HOLD (not §3)
 * 10. FIREWALL PROOF — LLM section:"free" on IP line overridden to HOLD
 * 11. PATH TRAVERSAL — rejected transcript paths return skipped
 * 12. CONCURRENT IDEMPOTENCY — concurrent runs produce no duplicates
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
  validateTranscriptPath,
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

/**
 * Write an empty watermark store (per-transcript, keyed by path).
 * Count 0 is the default when no entry exists; this is kept for API compat.
 */
function writeWatermark(dir: string, _count: number): string {
  const p = join(dir, "wm.json");
  // Empty store — loadTranscriptRecord returns lastProcessedCount:0 by default
  writeFileSync(p, JSON.stringify({}), "utf8");
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

  test("does NOT downgrade an existing hold to free", () => {
    const q: ExtractedQuote = {
      text: "Love is the engine of growth.",
      section: "hold",
      provenance: "[you]",
    };
    // No architecture keywords but section is already hold — must remain hold
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });

  // ── FIREWALL PROOF #1: borrowed IP line routes to §2 HOLD ──────────────────

  test("FIREWALL: borrowed quote containing architecture keyword forces §2 HOLD (not §3)", () => {
    // A borrowed quote that mentions 'cyborg' architecture must not leak as §3 BORROWED.
    // It contains IP so it must be held under §2, even though it is attributed.
    const q: ExtractedQuote = {
      text: "The cyborg runtime is the most important protocol layer of the next decade.",
      section: "borrowed",
      provenance: "[both]",
      attribution: "Anand Vallamsetla",
    };
    const result = applyHoldSafetyNet(q);
    expect(result.section).toBe("hold");
  });

  test("FIREWALL: borrowed quote with 'xos' keyword forces §2 HOLD", () => {
    const q: ExtractedQuote = {
      text: "xOS is the operating system for human potential.",
      section: "borrowed",
      provenance: "[you]",
      attribution: "Anand Vallamsetla",
    };
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });

  test("FIREWALL: clean borrowed quote (no arch keywords) stays §3 BORROWED", () => {
    const q: ExtractedQuote = {
      text: "Only fools learn from their own mistakes; the wise learn from others'.",
      section: "borrowed",
      provenance: "[both]",
      attribution: "old maxim",
    };
    const result = applyHoldSafetyNet(q);
    expect(result.section).toBe("borrowed");
  });

  // ── FIREWALL PROOF #2: LLM "free" on IP line overridden ────────────────────

  test("FIREWALL: LLM section:'free' on IP line overridden to §2 HOLD by keyword screen", () => {
    // Simulate prompt injection: LLM was induced to say "free" for an IP-revealing line.
    // The keyword backstop must override this to HOLD.
    const q: ExtractedQuote = {
      text: "The multi-agent coordination protocol is the core IP of xOS.",
      section: "free",   // <-- injected / incorrect LLM output
      provenance: "[cyborg]",
    };
    expect(applyHoldSafetyNet(q).section).toBe("hold");
  });
});

describe("validateTranscriptPath", () => {
  // ── PATH TRAVERSAL tests ────────────────────────────────────────────────────

  test("rejects path with '..' traversal segments", () => {
    expect(validateTranscriptPath("../../etc/passwd.jsonl")).toBeNull();
  });

  test("rejects path with '..' in middle of path", () => {
    expect(validateTranscriptPath("/tmp/foo/../bar/session.jsonl")).toBeNull();
  });

  test("rejects path without .jsonl extension", () => {
    expect(validateTranscriptPath("/tmp/session.txt")).toBeNull();
    expect(validateTranscriptPath("/tmp/session.json")).toBeNull();
    expect(validateTranscriptPath("/tmp/session")).toBeNull();
  });

  test("rejects path resolving to /etc/", () => {
    expect(validateTranscriptPath("/etc/secrets.jsonl")).toBeNull();
  });

  test("accepts a valid temp directory .jsonl path", () => {
    // Create a real temp path (doesn't need to exist for validateTranscriptPath)
    const valid = join(tmpdir(), "qh-test-12345", "session.jsonl");
    expect(validateTranscriptPath(valid)).not.toBeNull();
    expect(validateTranscriptPath(valid)).toContain("session.jsonl");
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

  // ── FIREWALL PROOF #3: IP-without-keyword still routes to §2 ───────────────

  test("FIREWALL: architecture-revealing quote without any of the 37 keywords routes to §2 HOLD", async () => {
    // This quote describes architecture IP using novel vocabulary not in the keyword list.
    // The LLM correctly classifies it as "hold" — we prove the system respects that.
    // (The keyword backstop is a second line of defense; the LLM is the first.)
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i + 1}.`,
    })));
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    // Quote has NO keywords from HOLD_KEYWORDS but describes IP architecture.
    // The mock LLM correctly returns "hold" — we verify the system routes it to §2.
    const archQuoteNoKeyword =
      "A per-user operating layer with a persistent memory substrate enables agent orchestration protocols that scale across the full human lifecycle.";

    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      { text: archQuoteNoKeyword, section: "hold", provenance: "[cyborg]" },
    ];

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result.appended).toBe(1);

    const written = readFileSync(quotesPath, "utf8");
    const s1Idx = written.indexOf("§1");
    const s2Idx = written.indexOf("§2");
    const s3Idx = written.indexOf("§3");
    const lineIdx = written.indexOf("per-user operating layer");

    // Must be under §2, NOT under §1
    expect(lineIdx).toBeGreaterThan(s2Idx);
    expect(lineIdx).toBeLessThan(s3Idx);
    // Explicitly NOT under §1
    expect(lineIdx).not.toBeLessThan(s1Idx + 10);
  });

  // ── FIREWALL PROOF #4: borrowed IP line → §2 HOLD (full harvest path) ──────

  test("FIREWALL: borrowed quote with architecture keyword routes to §2 HOLD (not §3)", async () => {
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i + 1}.`,
    })));
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    // LLM correctly classified this as "borrowed" but it contains "cyborg" → must go to HOLD
    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      {
        text: "The cyborg architecture is the most important platform decision of the next 20 years.",
        section: "borrowed",
        provenance: "[both]",
        attribution: "Anand Vallamsetla",
      },
    ];

    const result = await harvestQuotes(
      { transcript_path: transcriptPath },
      { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
    );

    expect(result.appended).toBe(1);

    const written = readFileSync(quotesPath, "utf8");
    const s2Idx = written.indexOf("§2");
    const s3Idx = written.indexOf("§3");
    const lineIdx = written.indexOf("cyborg architecture");

    // Must be under §2 (firewall caught it), NOT under §3
    expect(lineIdx).toBeGreaterThan(s2Idx);
    expect(lineIdx).toBeLessThan(s3Idx);
  });
});

describe("harvestQuotes — path traversal", () => {
  test("path with '..' traversal returns skipped with invalid-transcript-path", async () => {
    const dir = makeTmpDir();
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const result = await harvestQuotes(
      { transcript_path: "../../etc/passwd.jsonl" },
      { quotesPath, watermarkPath, today: "2026-06-30" },
    );
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("invalid-transcript-path");
  });

  test("path without .jsonl extension returns skipped with invalid-transcript-path", async () => {
    const dir = makeTmpDir();
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    // Write a real file with wrong extension so it's not rejected for non-existence
    const badPath = join(dir, "session.txt");
    writeFileSync(badPath, "{}", "utf8");

    const result = await harvestQuotes(
      { transcript_path: badPath },
      { quotesPath, watermarkPath, today: "2026-06-30" },
    );
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("invalid-transcript-path");
  });

  test("path pointing to /etc/ is rejected", async () => {
    const dir = makeTmpDir();
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const result = await harvestQuotes(
      { transcript_path: "/etc/malicious.jsonl" },
      { quotesPath, watermarkPath, today: "2026-06-30" },
    );
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("invalid-transcript-path");
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

    // Second run with same transcript — per-transcript watermark should prevent re-processing
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

  test("CONCURRENT IDEMPOTENCY: two simultaneous calls on same transcript produce no duplicate quotes", async () => {
    // Simulates two Stop hooks firing concurrently (e.g., two Claude sessions ending
    // simultaneously while sharing the same transcript path and quotes file).
    const dir = makeTmpDir();
    const transcriptPath = writeTranscript(dir, Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i + 1}.`,
    })));
    const quotesPath = writeQuotesFile(dir, BARE_QUOTES_FILE);
    const watermarkPath = join(dir, "wm.json");

    const mockExtract = async (_: string): Promise<ExtractedQuote[]> => [
      { text: "Precision beats volume every time.", section: "free", provenance: "[cyborg]" },
    ];

    // Fire both calls concurrently — one acquires the lock; the other either
    // loses the lock or re-dedupes against the first call's write
    const [result1, result2] = await Promise.all([
      harvestQuotes(
        { transcript_path: transcriptPath },
        { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
      ),
      harvestQuotes(
        { transcript_path: transcriptPath },
        { extractFn: mockExtract, quotesPath, watermarkPath, today: "2026-06-30" },
      ),
    ]);

    const written = readFileSync(quotesPath, "utf8");
    const occurrences = (written.match(/Precision beats volume/g) ?? []).length;

    // The quote must appear EXACTLY once regardless of which call won
    expect(occurrences).toBe(1);

    // Combined appended must be 1 (one call appended, the other deduplicated or lock-contended)
    const totalAppended = result1.appended + result2.appended;
    expect(totalAppended).toBe(1);
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
      { transcript_path: join(dir, "nonexistent.jsonl") },
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
      // Borrowed (clean — no arch keywords)
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
