import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approveQuoteRun,
  draftNextQuoteRun,
  emitQuoteTelemetry,
  getGraduationStatus,
  parsePostFreelyQuotes,
  quoteHash,
  readQuoteLog,
  selectNextQuote,
  selectNextQuoteFromDeckContent,
  type BrainTelemetryWriter,
  type QuoteLogRecord,
} from "../scripts/quote-selector";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "quote-flywheel-test-"));
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

describe("quote-selector safety gate", () => {
  test("parses only §1 POST FREELY and hard-excludes §2/§3 quote lines", () => {
    const deck = quoteDeck([
      '- "A safe line." — 2026-06-29 [you]',
    ]);

    const parsed = parsePostFreelyQuotes(deck);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe("A safe line.");
    expect(parsed[0].sourceSection).toBe("§1");

    const allCandidateText = parsed.map((quote) => quote.text).join("\n");
    expect(allCandidateText).not.toContain("§2 line");
    expect(allCandidateText).not.toContain("borrowed line");

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.quote.text).toBe("A safe line.");
      expect(selected.draft).toContain('"A safe line."');
      expect(selected.draft).not.toContain("|");
    }
  });

  test("terminates §1 at malformed and non-standard section boundaries", () => {
    const cases = [
      {
        name: "renamed §2 heading",
        boundary: "## HOLD until provisional",
        blocked: "Renamed heading IP quote must never post.",
      },
      {
        name: "different §2 heading level",
        boundary: "### §2 — HOLD until provisional",
        blocked: "Different heading level IP quote must never post.",
      },
      {
        name: "colon §2 heading",
        boundary: "## §2: HOLD until provisional",
        blocked: "Colon heading IP quote must never post.",
      },
      {
        name: "section ten heading",
        boundary: "## §10 — HOLD until patent review",
        blocked: "Section ten IP quote must never post.",
      },
    ];

    for (const { name, boundary, blocked } of cases) {
      const deck = [
        "# Cyborg Quotes",
        "",
        "## §1 — POST FREELY (universal wisdom)",
        "",
        '- "Safe boundary control." — 2026-06-29 [you]',
        "",
        boundary,
        "",
        `- "${blocked}" — 2026-06-29 [you]`,
        "",
        "## §3 — BORROWED (attribute; never post as original)",
        "",
        '- "Borrowed control quote." — someone [cyborg]',
      ].join("\n");

      const parsed = parsePostFreelyQuotes(deck);
      expect(parsed.map((quote) => quote.text), name).toEqual([
        "Safe boundary control.",
      ]);

      const selected = selectNextQuoteFromDeckContent(deck);
      expect(selected.ok, name).toBe(true);
      if (selected.ok) {
        expect(selected.quote.text, name).toBe("Safe boundary control.");
        expect(selected.draft, name).not.toContain(blocked);
      }
    }
  });

  test("fails closed when headingless §2 quotes sit inside the apparent §1 block", () => {
    const blocked = "Unique protected quote with no heading must never post.";
    const deck = [
      "# Cyborg Quotes",
      "",
      "## §1 — POST FREELY (universal wisdom)",
      "",
      `- "${blocked}" — 2026-06-29 [you]`,
      "",
      "## §3 — BORROWED (attribute; never post as original)",
      "",
      '- "Borrowed control quote." — someone [cyborg]',
    ].join("\n");

    expect(parsePostFreelyQuotes(deck)).toEqual([]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.reason).toBe("missing_protected_section_boundary");
    }
  });

  test("fails closed when a §2 heading exists only before §1 and §1 runs to EOF", () => {
    const blocked = "Trailing protected line after §1 must never post.";
    const deck = [
      "# Cyborg Quotes",
      "",
      "## §2 — HOLD until provisional filed — firewall + patent gate",
      "",
      '- "Earlier protected quote." — 2026-06-29 [you]',
      "",
      "## §1 — POST FREELY (universal wisdom)",
      "",
      `- "${blocked}" — 2026-06-29 [you]`,
    ].join("\n");

    expect(parsePostFreelyQuotes(deck)).toEqual([]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.reason).toBe("missing_protected_section_boundary");
    }
  });

  test("fails closed when §3 appears before the protected §2 boundary", () => {
    const blocked = "Protected line before a late §2 heading must never post.";
    const deck = [
      "# Cyborg Quotes",
      "",
      "## §1 — POST FREELY (universal wisdom)",
      "",
      `- "${blocked}" — 2026-06-29 [you]`,
      "",
      "## §3 — BORROWED (attribute; never post as original)",
      "",
      '- "Borrowed control quote." — someone [cyborg]',
      "",
      "## §2 — HOLD until provisional filed — firewall + patent gate",
      "",
      '- "Different protected quote." — 2026-06-29 [you]',
    ].join("\n");

    expect(parsePostFreelyQuotes(deck)).toEqual([]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.reason).toBe("ambiguous_post_freely_section");
    }
  });

  test("excludes protected quote text across smart-quote and punctuation variants", () => {
    const bled = "Do not share patent claim because it scales";
    const deck = [
      "# Cyborg Quotes",
      "",
      "## §1 — POST FREELY (universal wisdom)",
      "",
      `- "${bled}" — 2026-06-29 [you]`,
      '- "Safe normalized-control quote." — 2026-06-29 [cyborg]',
      "",
      "## §2 — HOLD until provisional filed — firewall + patent gate",
      "",
      "- “Do not share: patent claim, because it scales.” — 2026-06-29 [you]",
      "",
      "## §3 — BORROWED (attribute; never post as original)",
      "",
      '- "Borrowed control quote." — someone [cyborg]',
    ].join("\n");

    const parsed = parsePostFreelyQuotes(deck);
    expect(parsed.map((quote) => quote.text)).toEqual([
      "Safe normalized-control quote.",
    ]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.quote.text).toBe("Safe normalized-control quote.");
      expect(selected.draft).not.toContain(bled);
    }
  });

  test("selects a §1 quote from a canonical §1/§2/§3 deck", () => {
    const deck = quoteDeck([
      '- "Canonical safe line." — 2026-06-29 [you]',
    ]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.quote.text).toBe("Canonical safe line.");
    }
  });

  test("excludes a quote that appears in both a bled §1 position and §2", () => {
    const blocked = "Duplicated protected quote must never post.";
    const deck = [
      "# Cyborg Quotes",
      "",
      "## §1 — POST FREELY (universal wisdom)",
      "",
      `- "${blocked}" — 2026-06-29 [you]`,
      '- "Safe duplicate-control quote." — 2026-06-29 [you]',
      "",
      "## §2 — HOLD until provisional filed — firewall + patent gate",
      "",
      `- "  ${blocked}  " — 2026-06-29 [you]`,
      "",
      "## §3 — BORROWED (attribute; never post as original)",
      "",
      '- "Borrowed control quote." — someone [cyborg]',
    ].join("\n");

    const parsed = parsePostFreelyQuotes(deck);
    expect(parsed.map((quote) => quote.text)).toEqual([
      "Safe duplicate-control quote.",
    ]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.quote.text).toBe("Safe duplicate-control quote.");
      expect(selected.draft).not.toContain(blocked);
    }
  });

  test("fails closed when the deck has no clear §1 POST FREELY heading", () => {
    const deck = [
      "# Cyborg Quotes",
      "",
      "## §1 — universal wisdom",
      "",
      '- "Ambiguous heading quote must not post." — 2026-06-29 [you]',
      "",
      "## §2 — HOLD until provisional filed — firewall + patent gate",
      "",
      '- "Protected quote must not post." — 2026-06-29 [you]',
    ].join("\n");

    expect(parsePostFreelyQuotes(deck)).toEqual([]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.reason).toBe("missing_post_freely_section");
    }
  });

  test("fails closed when the §1 block has no following boundary", () => {
    const deck = [
      "# Cyborg Quotes",
      "",
      "## §1 — POST FREELY (universal wisdom)",
      "",
      '- "Unbounded quote must not post." — 2026-06-29 [you]',
    ].join("\n");

    expect(parsePostFreelyQuotes(deck)).toEqual([]);

    const selected = selectNextQuoteFromDeckContent(deck);
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.reason).toBe("missing_protected_section_boundary");
    }
  });
});

describe("quote-selector rotation and log behavior", () => {
  test("selects the least-recently-used §1 quote and excludes the dedup window", () => {
    const deck = quoteDeck([
      '- "Oldest safe line." — 2026-06-29 [you]',
      '- "Recent safe line." — 2026-06-29 [you]',
      '- "Middle safe line." — 2026-06-29 [cyborg]',
    ]);

    const records: QuoteLogRecord[] = [
      {
        quote_hash: quoteHash("Oldest safe line.", "you"),
        drafted_at: "2026-05-01T00:00:00.000Z",
        approved_at: "2026-05-01T00:00:00.000Z",
        status: "approved",
      },
      {
        quote_hash: quoteHash("Recent safe line.", "you"),
        drafted_at: "2026-06-29T00:00:00.000Z",
        approved_at: "2026-06-29T00:00:00.000Z",
        status: "approved",
      },
      {
        quote_hash: quoteHash("Middle safe line.", "cyborg"),
        drafted_at: "2026-05-15T00:00:00.000Z",
        approved_at: "2026-05-15T00:00:00.000Z",
        status: "approved",
      },
    ];

    const selected = selectNextQuoteFromDeckContent(deck, records, {
      now: new Date("2026-06-30T00:00:00.000Z"),
      dedupDays: 30,
    });

    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.quote.text).toBe("Oldest safe line.");
      expect(selected.quote.text).not.toBe("Recent safe line.");
    }
  });

  test("returns a safe skip when every §1 quote is inside the dedup window", () => {
    const deck = quoteDeck([
      '- "Recent safe line." — 2026-06-29 [you]',
    ]);
    const selected = selectNextQuoteFromDeckContent(
      deck,
      [
        {
          quote_hash: quoteHash("Recent safe line.", "you"),
          drafted_at: "2026-06-29T00:00:00.000Z",
          status: "drafted",
        },
      ],
      {
        now: new Date("2026-06-30T00:00:00.000Z"),
        dedupDays: 30,
      },
    );

    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.reason).toBe("all_quotes_inside_dedup_window");
    }
  });

  test("missing deck returns a safe skip instead of throwing", () => {
    const tmp = makeTmpDir();
    const selected = selectNextQuote({
      deckPath: join(tmp, "missing-cyborg-quotes.md"),
      logPath: join(tmp, "quote-flywheel-log.jsonl"),
    });

    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.reason).toBe("missing_deck");
      expect(selected.message).toContain("does not exist");
    }
  });

  test("draft and approval runs append local JSONL state without posting", () => {
    const tmp = makeTmpDir();
    const deckPath = join(tmp, "cyborg-quotes.md");
    const logPath = join(tmp, "quote-flywheel-log.jsonl");
    writeFileSync(
      deckPath,
      quoteDeck(['- "Local state safe line." — 2026-06-29 [cyborg]']),
    );

    const drafted = draftNextQuoteRun({
      deckPath,
      logPath,
      now: new Date("2026-06-30T08:00:00.000Z"),
    });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) throw new Error("expected draft");
    expect(drafted.approval.command).toContain("approve");

    let records = readQuoteLog(logPath);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("drafted");
    expect(records[0].posted_at).toBeUndefined();

    const approved = approveQuoteRun(drafted.quote.quote_hash, {
      logPath,
      now: new Date("2026-06-30T08:01:00.000Z"),
    });
    expect(approved.ok).toBe(true);
    expect(approved.reason).toBe("approved");

    records = readQuoteLog(logPath);
    expect(records).toHaveLength(2);
    expect(records[1].status).toBe("approved");
    expect(records[1].approved_at).toBe("2026-06-30T08:01:00.000Z");
    expect(records[1].posted_at).toBeUndefined();

    const rawLog = readFileSync(logPath, "utf8");
    expect(rawLog).not.toContain("linkedin.com");
  });
});

describe("quote-selector graduation helper", () => {
  test("requires 10 approved quote runs before eligibility", () => {
    const approvedRecords = Array.from({ length: 10 }, (_, index) => ({
      quote_hash: `quote-${index}`,
      drafted_at: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      approved_at: `2026-06-${String(index + 1).padStart(2, "0")}T00:01:00.000Z`,
      status: "approved" as const,
    }));

    expect(getGraduationStatus(approvedRecords.slice(0, 9))).toEqual({
      approved_count: 9,
      threshold: 10,
      eligible: false,
    });
    expect(getGraduationStatus(approvedRecords)).toEqual({
      approved_count: 10,
      threshold: 10,
      eligible: true,
    });
  });
});

describe("quote-selector local telemetry", () => {
  test("quote telemetry is gated off unless XOS_98_TELEMETRY is enabled", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    let stored = "";
    const brain: BrainTelemetryWriter = {
      read: async (path) => ({ ok: true, content: path === "brand-amplification/telemetry/events.jsonl" ? stored : null }),
      write: async (path, content) => {
        stored = content;
        writes.push({ path, content });
        return { ok: true, path };
      },
    };

    const disabled = await emitQuoteTelemetry(
      "quote_drafted",
      { quote_hash: "abc123" },
      {
        brain,
        env: {},
        now: new Date("2026-06-30T00:00:00.000Z"),
      },
    );
    expect(disabled).toEqual({ emitted: false, reason: "disabled" });
    expect(writes).toHaveLength(0);

    const drafted = await emitQuoteTelemetry(
      "quote_drafted",
      { quote_hash: "abc123" },
      {
        brain,
        env: { XOS_98_TELEMETRY: "yes" },
        now: new Date("2026-06-30T00:00:00.000Z"),
      },
    );
    expect(drafted).toEqual({
      emitted: true,
      path: "brand-amplification/telemetry/events.jsonl",
    });

    const approved = await emitQuoteTelemetry(
      "quote_approved",
      { quote_hash: "abc123" },
      {
        brain,
        env: { XOS_98_TELEMETRY: "1" },
        now: new Date("2026-06-30T00:01:00.000Z"),
      },
    );
    expect(approved.emitted).toBe(true);

    const events = stored.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual([
      "quote_drafted",
      "quote_approved",
    ]);
    expect(writes.every((write) => write.path === "brand-amplification/telemetry/events.jsonl")).toBe(true);
  });
});
