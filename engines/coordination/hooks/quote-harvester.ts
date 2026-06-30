#!/usr/bin/env bun
/**
 * quote-harvester.ts — Stop hook: auto-harvest quotable insights.
 *
 * Reads the session transcript via `transcript_path` in the Stop hook payload,
 * extracts aphoristic statements, routes them to one of three safety-gated
 * sections in ~/anand-career-os/WIP/branding-product/cyborg-quotes.md, and
 * deduplicates against existing entries.
 *
 * Safety routing (CRITICAL):
 *   §1 POST FREELY  — universal wisdom, safe to post now
 *   §2 HOLD         — reveals xOS/cyborg/agent architecture or IP thesis; NEVER post publicly yet
 *   §3 BORROWED     — attributed to named third parties
 *
 * Keyword safety net: even if the LLM classifies a quote as "free", if it
 * contains any architecture/IP keyword it is forced to §2 HOLD.
 *
 * Fail-safe contract:
 *   - Any unhandled error → exit 0 (never blocks session end)
 *   - Missing transcript / quotes file / LLM → silent no-op
 *   - Never writes to the quotes file if extraction returns nothing
 *
 * XOS-140
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────────

const QUOTES_PATH = join(
  homedir(),
  "anand-career-os/WIP/branding-product/cyborg-quotes.md",
);

const WATERMARK_PATH = join(
  homedir(),
  ".cyborg-state/coordination/quote-harvester-wm.json",
);

/** Minimum new messages (user+assistant pairs) since last harvest before we run. */
const MIN_NEW_MESSAGES = 4;

/** Maximum characters of conversation to send to the LLM for extraction. */
const MAX_CONTENT_CHARS = 8_000;

/** Section header strings as they appear in the file (without the trailing newline). */
const SECTION_HEADERS = {
  free: "## §1 — POST FREELY (universal wisdom)",
  hold: "## §2 — HOLD until provisional filed (~2026-Q3) — firewall + patent gate",
  borrowed: "## §3 — BORROWED (attribute; never post as original)",
} as const;

/**
 * Keywords that force a quote into §2 HOLD regardless of LLM classification.
 * Matched case-insensitively against the lower-cased quote text.
 */
const HOLD_KEYWORDS: string[] = [
  "xos",
  "xhuman",
  "xteam",
  "xfamily",
  "xcommunity",
  "cyborg",
  "co-dialectic",
  "co-intelligence",
  "codi",
  "the swarm",
  "session-role",
  "session role",
  "multi-agent",
  "love-physics",
  "love physics",
  "love-nudge",
  "love nudge",
  "productive gap",
  "tree of souls",
  "coordination engine",
  "career intelligence engine",
  "brand intelligence",
  "agent swarm",
  "agent marketplace",
  "skill system",
  "exponentialos",
  "thewhyman",
  "thewhycyborg",
  "fish-swarm",
  "whale and fish",
  "flash fish",
  "agent runtime",
  "ship-feature",
  "sdlc pipeline",
  "judge panel",
  "cross-family judge",
];

// ── Types ──────────────────────────────────────────────────────────────────────

export type Section = "free" | "hold" | "borrowed";

export interface ExtractedQuote {
  text: string;
  section: Section;
  provenance: string;    // "[you]" | "[cyborg]" | "[both]" | undefined for borrowed
  attribution?: string;  // for borrowed quotes only
}

export interface HarvestWatermark {
  lastProcessedCount: number;
  lastHarvestedAt: string;
}

export interface HarvestOptions {
  /** Injected for tests: override the LLM extraction call. */
  extractFn?: (content: string) => Promise<ExtractedQuote[]>;
  /** Override paths for testing. */
  quotesPath?: string;
  watermarkPath?: string;
  /** Override the current date string (YYYY-MM-DD). */
  today?: string;
}

export interface HarvestResult {
  skipped: boolean;
  skipReason?: string;
  extracted: number;
  appended: number;
}

// ── Payload parsing ────────────────────────────────────────────────────────────

interface StopPayload {
  stop_hook_active?: boolean;
  session_id?: string;
  transcript_path?: string;
  transcriptPath?: string;
  session_transcript_path?: string;
  [key: string]: unknown;
}

function parsePayload(raw: string): StopPayload {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as StopPayload;
    }
  } catch {
    // ignore
  }
  return {};
}

function resolveTranscriptPath(payload: StopPayload): string | null {
  const tp =
    payload.transcript_path ??
    payload.transcriptPath ??
    payload.session_transcript_path;
  if (typeof tp === "string" && tp.trim()) return tp.trim();
  return null;
}

// ── Transcript parsing ─────────────────────────────────────────────────────────

interface TranscriptRow {
  role?: string;
  type?: string;
  isSidechain?: boolean;
  message?: { content?: unknown; role?: string };
  content?: unknown;
  text?: unknown;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: string; text: string } =>
          typeof c === "object" &&
          c !== null &&
          (c as Record<string, unknown>).type === "text",
      )
      .map((c) => c.text)
      .join("\n");
  }
  if (typeof content === "object" && content !== null) {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
  }
  return "";
}

interface ParsedMessage {
  role: "user" | "assistant";
  text: string;
}

function parseTranscript(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: TranscriptRow;
    try {
      row = JSON.parse(trimmed) as TranscriptRow;
    } catch {
      continue;
    }
    // Skip sidechain (subagent) messages
    if (row.isSidechain) continue;

    const role = row.role ?? row.message?.role ?? row.type;
    if (role !== "user" && role !== "assistant") continue;

    const content =
      row.message?.content ?? row.content ?? row.text ?? "";
    const text = textFromContent(content);
    if (text.trim()) {
      messages.push({
        role: role as "user" | "assistant",
        text: text.trim(),
      });
    }
  }
  return messages;
}

function buildConversationExcerpt(
  messages: ParsedMessage[],
  fromIndex: number,
  maxChars: number,
): string {
  const delta = messages.slice(fromIndex);
  const parts: string[] = [];
  let total = 0;
  for (const m of delta) {
    const line = `[${m.role.toUpperCase()}]: ${m.text}`;
    if (total + line.length > maxChars) {
      // Truncate the line to fit
      const remaining = maxChars - total;
      if (remaining > 100) {
        parts.push(line.slice(0, remaining) + "…");
      }
      break;
    }
    parts.push(line);
    total += line.length + 1;
  }
  return parts.join("\n\n");
}

// ── Watermark ──────────────────────────────────────────────────────────────────

function loadWatermark(wmPath: string): HarvestWatermark {
  try {
    if (existsSync(wmPath)) {
      const raw = readFileSync(wmPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<HarvestWatermark>;
      return {
        lastProcessedCount: parsed.lastProcessedCount ?? 0,
        lastHarvestedAt: parsed.lastHarvestedAt ?? "",
      };
    }
  } catch {
    // ignore
  }
  return { lastProcessedCount: 0, lastHarvestedAt: "" };
}

function saveWatermark(wmPath: string, wm: HarvestWatermark): void {
  try {
    mkdirSync(dirname(wmPath), { recursive: true });
    writeFileSync(wmPath, JSON.stringify(wm, null, 2), "utf8");
  } catch {
    // fail-safe: watermark write failure is non-fatal
  }
}

// ── Safety net ─────────────────────────────────────────────────────────────────

/**
 * Force §2 HOLD if the quote text contains architecture/IP keywords,
 * regardless of what the LLM classified it as.
 */
export function applyHoldSafetyNet(quote: ExtractedQuote): ExtractedQuote {
  if (quote.section !== "free") return quote; // already hold or borrowed — don't downgrade
  const lower = quote.text.toLowerCase();
  for (const kw of HOLD_KEYWORDS) {
    if (lower.includes(kw)) {
      return { ...quote, section: "hold" };
    }
  }
  return quote;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

// Quote character class using only hex/unicode escapes (no literal quote chars
// that could be mangled by editor smart-quote conversion):
// \x22 = U+0022 straight double quote, \u201C = left curly, \u201D = right curly, \u201E = low-9
const QUOTE_LINE_RE = /^-\s+[\x22\u201C\u201D\u201E]([^\x22\u201C\u201D\u201E]+)[\x22\u201C\u201D\u201E]/;

/**
 * Build a normalized set of existing quote texts for deduplication.
 * Normalization: lowercase, strip surrounding quotes and punctuation,
 * collapse whitespace.
 *
 * Handles both straight quotes ("...") and curly/smart quotes.
 */
export function buildExistingQuoteSet(fileContent: string): Set<string> {
  const set = new Set<string>();
  for (const line of fileContent.split("\n")) {
    const match = QUOTE_LINE_RE.exec(line.trim());
    if (match?.[1]) {
      set.add(normalizeQuote(match[1]));
    }
  }
  return set;
}

// Curly single-quote → straight apostrophe (U+2018, U+2019, U+201A, U+201B)
const CURLY_SQUOTE_RE = /[\u2018\u2019\u201A\u201B]/g;
// Any double-quote variant → strip (U+0022, U+201C, U+201D, U+201E)
const ANY_DQUOTE_RE = /[\x22\u201C\u201D\u201E]/g;

function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    // Normalize curly single quotes to straight apostrophe (\x27 = U+0027)
    .replace(CURLY_SQUOTE_RE, `\x27`)
    // Strip all double-quote variants
    .replace(ANY_DQUOTE_RE, ``)
    .replace(/\s+/g, ` `)
    .trim();
}

function isDuplicate(quote: ExtractedQuote, existing: Set<string>): boolean {
  return existing.has(normalizeQuote(quote.text));
}

// ── File append ────────────────────────────────────────────────────────────────

/**
 * Format a quote for appending to the deck.
 * §1/§2: - "text" — YYYY-MM-DD [provenance]
 * §3:     - "text" — Attribution Name
 */
function formatQuoteLine(quote: ExtractedQuote, today: string): string {
  const text = quote.text.replace(/[\x22\u201C\u201D\u201E]/, ``).replace(/[\x22\u201C\u201D\u201E]$/, ``).trim();
  if (quote.section === "borrowed") {
    const attr = quote.attribution?.trim() ?? "unknown";
    return `- "${text}" — ${attr}`;
  }
  const prov = quote.provenance?.trim() ?? "[cyborg]";
  return `- "${text}" — ${today} ${prov}`;
}

/**
 * Append `newLines` under the given section header in the file content.
 * Returns the updated content string.
 *
 * The section header is followed by optional italic subtitle lines,
 * then bullet entries, then a blank line before the next ## header (or EOF).
 * New entries are inserted just before that trailing blank line + next header.
 */
export function insertUnderSection(
  content: string,
  sectionKey: Section,
  newLines: string[],
): string {
  if (newLines.length === 0) return content;

  const header = SECTION_HEADERS[sectionKey];
  const headerIdx = content.indexOf(header);
  if (headerIdx === -1) {
    // Section not found — append at end of file
    return content.trimEnd() + "\n\n" + newLines.join("\n") + "\n";
  }

  // Find the end of this section: the next ## header or EOF
  const afterHeader = headerIdx + header.length;
  const nextSectionIdx = content.indexOf("\n## §", afterHeader);
  const sectionEnd =
    nextSectionIdx !== -1 ? nextSectionIdx : content.length;

  const before = content.slice(0, sectionEnd);
  const after = content.slice(sectionEnd);

  // Insert new lines at end of section (before the gap + next section)
  const inserted = before.trimEnd() + "\n" + newLines.join("\n") + "\n";
  return inserted + after;
}

// ── LLM extraction ─────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT_PREFIX = `You are a quote harvester for a co-intelligence dialectic session.
Scan the conversation excerpt and extract only genuinely aphoristic, insightful, or quotable statements.
Skip mechanical instructions, debugging output, code, and routine exchanges.

CLASSIFICATION RULES — SAFETY CRITICAL:
- "free": Universal human wisdom about learning, growth, teams, leadership, communication, motivation. Safe to post publicly NOW.
- "hold": ANYTHING that reveals the architecture, design, strategy, or IP of an AI agent system — including references to: xOS, xHumanOS, xTeamOS, co-dialectic, cyborg, the swarm, session-roles, multi-agent coordination, the productive-gap thesis, love-physics thesis, the Tree of Souls model, or how the AI system is built. Route to HOLD — NEVER post publicly. DEFAULT TO HOLD when uncertain between free and hold.
- "borrowed": Directly quoting or clearly paraphrasing a named third party. Must include their name.

Provenance:
- "[you]" = clearly the human's original voice
- "[cyborg]" = clearly from the AI or co-authored synthesis
- "[both]" = cannot distinguish

Output ONLY valid JSON array, no prose, no markdown fences:
[{"text":"quote","section":"free|hold|borrowed","provenance":"[you]|[cyborg]|[both]","attribution":"Name if borrowed"}]

If no quotable statements found, output exactly: []

CONVERSATION EXCERPT:
`;

async function runLlmExtraction(content: string): Promise<ExtractedQuote[]> {
  const prompt = EXTRACTION_PROMPT_PREFIX + content;
  // Write prompt to a temp file to avoid shell quoting issues
  const tmpPath = join(
    homedir(),
    `.cyborg-state/coordination/qh-prompt-${Date.now()}.txt`,
  );
  try {
    mkdirSync(dirname(tmpPath), { recursive: true });
    writeFileSync(tmpPath, prompt, "utf8");

    // Try Gemini Flash first (separate quota, fast)
    const geminiResult = await tryLlmCall([
      "gemini",
      "-m",
      "gemini-2.5-flash",
      "--yolo",
      "-p",
      "@" + tmpPath,
    ]);
    if (geminiResult !== null) return parseExtractedQuotes(geminiResult);

    // Fallback: claude
    const claudeResult = await tryLlmCall(["claude", "-p", "@" + tmpPath]);
    if (claudeResult !== null) return parseExtractedQuotes(claudeResult);
  } finally {
    try {
      // Best-effort cleanup of temp prompt file
      await Bun.spawn(["rm", "-f", tmpPath]).exited.catch(() => {});
    } catch {
      // ignore cleanup errors
    }
  }
  return [];
}

async function tryLlmCall(argv: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 30_000),
    );
    const result = await Promise.race([
      proc.exited.then(async () => {
        const out = await new Response(proc.stdout).text();
        return out.trim() || null;
      }),
      timeout,
    ]);
    if (result === null) {
      proc.kill();
    }
    return result;
  } catch {
    return null;
  }
}

function parseExtractedQuotes(raw: string): ExtractedQuote[] {
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    const results: ExtractedQuote[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const q = item as Record<string, unknown>;
      const text = typeof q.text === "string" ? q.text.trim() : "";
      if (!text) continue;
      const section: Section = validateSection(q.section) ?? "hold"; // default-to-hold
      const provenance = typeof q.provenance === "string" ? q.provenance : "[cyborg]";
      const attribution = typeof q.attribution === "string" ? q.attribution : undefined;
      results.push({ text, section, provenance, attribution });
    }
    return results;
  } catch {
    return [];
  }
}

function validateSection(raw: unknown): Section | null {
  if (raw === "free" || raw === "hold" || raw === "borrowed") return raw;
  return null;
}

// ── Core harvest logic ─────────────────────────────────────────────────────────

/**
 * Main harvest function. Testable: all I/O can be injected via options.
 */
export async function harvestQuotes(
  payload: StopPayload,
  options: HarvestOptions = {},
): Promise<HarvestResult> {
  const quotesPath = options.quotesPath ?? QUOTES_PATH;
  const watermarkPath = options.watermarkPath ?? WATERMARK_PATH;
  const today =
    options.today ?? new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const extractFn = options.extractFn ?? runLlmExtraction;

  // 1. Resolve transcript
  const transcriptPath = resolveTranscriptPath(payload);
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { skipped: true, skipReason: "no-transcript", extracted: 0, appended: 0 };
  }

  let transcriptRaw: string;
  try {
    transcriptRaw = readFileSync(transcriptPath, "utf8");
  } catch {
    return { skipped: true, skipReason: "transcript-unreadable", extracted: 0, appended: 0 };
  }

  // 2. Parse transcript
  const messages = parseTranscript(transcriptRaw);
  if (messages.length === 0) {
    return { skipped: true, skipReason: "empty-transcript", extracted: 0, appended: 0 };
  }

  // 3. Check watermark — skip if not enough new messages
  const wm = loadWatermark(watermarkPath);
  const newMessageCount = messages.length - wm.lastProcessedCount;
  if (newMessageCount < MIN_NEW_MESSAGES) {
    return {
      skipped: true,
      skipReason: `only-${newMessageCount}-new-messages`,
      extracted: 0,
      appended: 0,
    };
  }

  // 4. Build conversation excerpt from new messages
  const excerpt = buildConversationExcerpt(
    messages,
    wm.lastProcessedCount,
    MAX_CONTENT_CHARS,
  );
  if (!excerpt.trim()) {
    return { skipped: true, skipReason: "empty-excerpt", extracted: 0, appended: 0 };
  }

  // 5. LLM extraction
  let rawQuotes: ExtractedQuote[];
  try {
    rawQuotes = await extractFn(excerpt);
  } catch {
    return { skipped: true, skipReason: "extraction-failed", extracted: 0, appended: 0 };
  }

  if (rawQuotes.length === 0) {
    // Still update watermark so we don't re-process the same content
    saveWatermark(watermarkPath, {
      lastProcessedCount: messages.length,
      lastHarvestedAt: new Date().toISOString(),
    });
    return { skipped: false, extracted: 0, appended: 0 };
  }

  // 6. Apply keyword safety net
  const safeQuotes = rawQuotes.map(applyHoldSafetyNet);

  // 7. Load existing quotes for dedup
  let existingContent = "";
  let existingSet = new Set<string>();
  if (existsSync(quotesPath)) {
    try {
      existingContent = readFileSync(quotesPath, "utf8");
      existingSet = buildExistingQuoteSet(existingContent);
    } catch {
      // fail-safe: if we can't read, proceed with empty set (may produce dups)
    }
  }

  // 8. Filter duplicates and group by section
  const toAppend: ExtractedQuote[] = [];
  for (const q of safeQuotes) {
    if (!isDuplicate(q, existingSet)) {
      toAppend.push(q);
    }
  }

  if (toAppend.length === 0) {
    saveWatermark(watermarkPath, {
      lastProcessedCount: messages.length,
      lastHarvestedAt: new Date().toISOString(),
    });
    return { skipped: false, extracted: rawQuotes.length, appended: 0 };
  }

  // 9. Insert into file by section
  const bySection: Record<Section, string[]> = {
    free: [],
    hold: [],
    borrowed: [],
  };
  for (const q of toAppend) {
    bySection[q.section].push(formatQuoteLine(q, today));
  }

  let updatedContent = existingContent;
  for (const section of (["free", "hold", "borrowed"] as Section[])) {
    if (bySection[section].length > 0) {
      updatedContent = insertUnderSection(updatedContent, section, bySection[section]);
    }
  }

  try {
    mkdirSync(dirname(quotesPath), { recursive: true });
    writeFileSync(quotesPath, updatedContent, "utf8");
  } catch {
    return { skipped: true, skipReason: "write-failed", extracted: rawQuotes.length, appended: 0 };
  }

  // 10. Update watermark
  saveWatermark(watermarkPath, {
    lastProcessedCount: messages.length,
    lastHarvestedAt: new Date().toISOString(),
  });

  return { skipped: false, extracted: rawQuotes.length, appended: toAppend.length };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  try {
    if (process.stdin.isTTY) return "";
    return await Bun.stdin.text();
  } catch {
    return "";
  }
}

export async function runCli(): Promise<void> {
  try {
    const raw = await readStdin();
    const payload = parsePayload(raw);
    await harvestQuotes(payload);
    // No output — Stop hooks that return nothing allow the session to end normally
  } catch {
    // Fail-safe: any error, exit 0 and never block session end
  }
  process.exit(0);
}

// Run if called directly
if (import.meta.main) {
  await runCli();
}
