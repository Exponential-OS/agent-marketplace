import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const DEFAULT_DECK_PATH =
  "~/anand-career-os/WIP/branding-product/cyborg-quotes.md";
export const DEFAULT_STATE_DIR = "~/.brand-amplification-state";
export const DEFAULT_LOG_FILENAME = "quote-flywheel-log.jsonl";
export const DEFAULT_DEDUP_DAYS = 30;
export const GRADUATION_APPROVAL_THRESHOLD = 10;
export const TELEMETRY_PATH = "brand-amplification/telemetry/events.jsonl";

const DAY_MS = 24 * 60 * 60 * 1000;
const ENGINE_ID = "brand-amplification";
const SOURCE = "quote-flywheel";

export type QuoteProvenance = "you" | "cyborg";
export type QuoteLogStatus = "drafted" | "approved" | "posted";
export type QuoteTelemetryEvent =
  | "quote_drafted"
  | "quote_daily_surfaced"
  | "quote_approved"
  | "quote_posted";

export interface Quote {
  text: string;
  date: string;
  provenance: QuoteProvenance;
  sourceSection: "§1";
  lineNumber: number;
  quote_hash: string;
  sourcePath?: string;
}

export interface QuoteLogRecord {
  quote_hash: string;
  quote_text?: string;
  provenance?: QuoteProvenance;
  drafted_at: string;
  approved_at?: string;
  posted_at?: string;
  status: QuoteLogStatus;
  source?: "quote-flywheel";
}

export interface QuoteSelectionOptions {
  deckPath?: string;
  logPath?: string;
  dedupDays?: number;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface QuoteSelectionOk {
  ok: true;
  quote: Quote;
  draft: string;
  reason: "selected";
}

export interface QuoteSelectionSkip {
  ok: false;
  reason:
    | "missing_deck"
    | "missing_post_freely_section"
    | "missing_protected_section_boundary"
    | "ambiguous_post_freely_section"
    | "empty_post_freely_section"
    | "all_quotes_inside_dedup_window";
  message: string;
}

export type QuoteSelectionResult = QuoteSelectionOk | QuoteSelectionSkip;

export interface QuoteDraftRunOk extends QuoteSelectionOk {
  logRecord: QuoteLogRecord;
  approval: {
    quote_hash: string;
    command: string;
  };
}

export type QuoteDraftRunResult = QuoteDraftRunOk | QuoteSelectionSkip;

export interface GraduationStatus {
  approved_count: number;
  threshold: number;
  eligible: boolean;
}

export interface BrainTelemetryWriter {
  read(path: string): Promise<{ ok: boolean; content?: string | null }> | {
    ok: boolean;
    content?: string | null;
  };
  write(
    path: string,
    content: string,
    opts: {
      provenance: {
        who: string;
        why: string;
        source: string;
      };
      engine_id: string;
    },
  ): Promise<{ ok: boolean; path?: string; err?: string }> | {
    ok: boolean;
    path?: string;
    err?: string;
  };
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return `${homedir()}${path.slice(1)}`;
  return path;
}

export function resolveLocalPath(path: string): string {
  return resolve(expandHome(path));
}

export function getDeckPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CYBORG_QUOTES_DECK?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_DECK_PATH;
}

export function getStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.QUOTE_FLYWHEEL_STATE_DIR?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_STATE_DIR;
}

export function getLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.QUOTE_FLYWHEEL_LOG?.trim();
  return configured && configured.length > 0
    ? configured
    : `${getStateDir(env)}/${DEFAULT_LOG_FILENAME}`;
}

export function normalizeQuoteText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function stripSurroundingQuotes(text: string): string {
  const trimmed = text.trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];

  for (const [open, close] of quotePairs) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }

  return trimmed;
}

function normalizeQuoteMarksForSafety(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛‹›]/g, "'");
}

function normalizeQuoteTextForSafety(text: string): string {
  return stripSurroundingQuotes(normalizeQuoteMarksForSafety(text))
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function quoteHash(
  text: string,
  provenance: QuoteProvenance,
): string {
  return createHash("sha256")
    .update(`${normalizeQuoteText(text)}\n${provenance}`)
    .digest("hex")
    .slice(0, 16);
}

interface ParsedQuoteLine {
  text: string;
  date: string;
  provenance: QuoteProvenance;
}

function parseQuoteLine(line: string): ParsedQuoteLine | null {
  const match = line.match(
    /^\s*-\s*(?<text>.+)\s+[—-]\s+(?<date>.*?)\s+\[(?<provenance>you|cyborg)\]\s*$/,
  );
  if (!match?.groups) return null;

  const text = stripSurroundingQuotes(match.groups.text);
  if (!text) return null;

  return {
    text,
    date: match.groups.date.trim(),
    provenance: match.groups.provenance as QuoteProvenance,
  };
}

function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

function markdownHeadingText(line: string): string {
  const match = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
  return match ? match[1].trim() : line.trim();
}

function isPostFreelyHeading(line: string): boolean {
  return (
    isMarkdownHeading(line) &&
    /§\s*1\b/i.test(line) &&
    /\bpost\s+freely\b/i.test(line)
  );
}

function isProtectedSectionHeading(line: string): boolean {
  if (!isMarkdownHeading(line)) return false;

  const heading = markdownHeadingText(line);
  return (
    /§\s*2\b/i.test(heading) ||
    /\bhold\b/i.test(heading) ||
    /\bpatent\b/i.test(heading) ||
    /\bprovisional\b/i.test(heading) ||
    /\bfirewall\b/i.test(heading)
  );
}

function isTrustedPostFreelyBoundaryHeading(line: string): boolean {
  return isProtectedSectionHeading(line);
}

function hasSectionMarker(line: string): boolean {
  return /§\s*\d+\b/i.test(line);
}

function sectionNumberFromMarkerLine(line: string): number | null {
  if (parseQuoteLine(line)) return null;

  const match = line.match(/§\s*(\d+)\b/i);
  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSectionBoundary(line: string): boolean {
  if (isMarkdownHeading(line)) return true;
  return hasSectionMarker(line);
}

interface PostFreelyBlock {
  headingLineIndex: number;
  startLineIndex: number;
  endLineIndex: number;
}

type PostFreelyParseResult =
  | { ok: true; quotes: Quote[] }
  | {
      ok: false;
      reason:
        | "missing_post_freely_section"
        | "missing_protected_section_boundary"
        | "ambiguous_post_freely_section"
        | "empty_post_freely_section";
      message: string;
    };

type PostFreelyBlockResult =
  | { ok: true; block: PostFreelyBlock }
  | {
      ok: false;
      reason:
        | "missing_protected_section_boundary"
        | "ambiguous_post_freely_section";
      message: string;
    };

function findProtectedSectionHeadingAfter(
  lines: string[],
  lineIndex: number,
): number | null {
  for (let i = lineIndex + 1; i < lines.length; i += 1) {
    if (isProtectedSectionHeading(lines[i])) return i;
  }

  return null;
}

function findPostFreelyBlock(lines: string[]): PostFreelyBlockResult {
  const headingLineIndexes: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (isPostFreelyHeading(lines[i])) {
      headingLineIndexes.push(i);
    }
  }

  if (headingLineIndexes.length !== 1) {
    return {
      ok: false,
      reason: "ambiguous_post_freely_section",
      message:
        "Quote deck skipped: §1 POST FREELY section is ambiguous.",
    };
  }

  const headingLineIndex = headingLineIndexes[0];
  const protectedHeadingIndex = findProtectedSectionHeadingAfter(
    lines,
    headingLineIndex,
  );
  if (protectedHeadingIndex === null) {
    return {
      ok: false,
      reason: "missing_protected_section_boundary",
      message:
        "Quote deck skipped: §1 POST FREELY lacks a following §2 HOLD/patent boundary.",
    };
  }

  for (let i = headingLineIndex + 1; i < lines.length; i += 1) {
    if (isSectionBoundary(lines[i])) {
      if (
        !isMarkdownHeading(lines[i]) ||
        !isTrustedPostFreelyBoundaryHeading(lines[i])
      ) {
        return {
          ok: false,
          reason: "ambiguous_post_freely_section",
          message:
            "Quote deck skipped: §1 POST FREELY does not terminate at a recognized §2 HOLD/patent safety boundary.",
        };
      }

      return {
        ok: true,
        block: {
          headingLineIndex,
          startLineIndex: headingLineIndex + 1,
          endLineIndex: i,
        },
      };
    }
  }

  return {
    ok: false,
    reason: "ambiguous_post_freely_section",
    message:
      "Quote deck skipped: §1 POST FREELY section is ambiguous or lacks a following boundary.",
  };
}

function countPostFreelyHeadings(lines: string[]): number {
  return lines.filter(isPostFreelyHeading).length;
}

function isInsidePostFreelyBlock(
  lineIndex: number,
  block: PostFreelyBlock,
): boolean {
  return lineIndex >= block.startLineIndex && lineIndex < block.endLineIndex;
}

function collectNonPostFreelyQuoteTexts(
  lines: string[],
  block: PostFreelyBlock,
): Set<string> {
  const excluded = new Set<string>();
  let inExplicitNonPostFreelySection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const sectionNumber = sectionNumberFromMarkerLine(line);

    if (sectionNumber !== null) {
      inExplicitNonPostFreelySection = sectionNumber !== 1;
    } else if (isMarkdownHeading(line)) {
      inExplicitNonPostFreelySection = !isPostFreelyHeading(line);
    }

    const parsed = parseQuoteLine(line);
    if (!parsed) continue;

    if (!isInsidePostFreelyBlock(i, block) || inExplicitNonPostFreelySection) {
      excluded.add(normalizeQuoteTextForSafety(parsed.text));
    }
  }

  return excluded;
}

function parsePostFreelyQuoteDeck(
  markdown: string,
  sourcePath?: string,
): PostFreelyParseResult {
  const lines = markdown.split(/\r?\n/);
  const postFreelyHeadingCount = countPostFreelyHeadings(lines);

  if (postFreelyHeadingCount === 0) {
    return {
      ok: false,
      reason: "missing_post_freely_section",
      message:
        "Quote deck skipped: missing clear §1 POST FREELY safety-gate section.",
    };
  }

  const blockResult = findPostFreelyBlock(lines);
  if (!blockResult.ok) {
    return {
      ok: false,
      reason: blockResult.reason,
      message: blockResult.message,
    };
  }

  const block = blockResult.block;
  const excludedQuoteTexts = collectNonPostFreelyQuoteTexts(lines, block);
  const quotes: Quote[] = [];

  for (let i = block.startLineIndex; i < block.endLineIndex; i += 1) {
    const parsed = parseQuoteLine(lines[i]);
    if (!parsed) continue;

    if (excludedQuoteTexts.has(normalizeQuoteTextForSafety(parsed.text))) {
      continue;
    }

    quotes.push({
      text: parsed.text,
      date: parsed.date,
      provenance: parsed.provenance,
      sourceSection: "§1",
      lineNumber: i + 1,
      quote_hash: quoteHash(parsed.text, parsed.provenance),
      sourcePath,
    });
  }

  if (quotes.length === 0) {
    return {
      ok: false,
      reason: "empty_post_freely_section",
      message:
        "Quote deck skipped: §1 POST FREELY exists but has no eligible [you]/[cyborg] quote lines.",
    };
  }

  return { ok: true, quotes };
}

export function hasPostFreelySection(markdown: string): boolean {
  return markdown.split(/\r?\n/).some(isPostFreelyHeading);
}

export function parsePostFreelyQuotes(
  markdown: string,
  sourcePath?: string,
): Quote[] {
  try {
    const parsed = parsePostFreelyQuoteDeck(markdown, sourcePath);
    return parsed.ok ? parsed.quotes : [];
  } catch {
    return [];
  }
}

export function parseQuoteLog(content: string): QuoteLogRecord[] {
  const records: QuoteLogRecord[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as Partial<QuoteLogRecord>;
      if (
        typeof parsed.quote_hash !== "string" ||
        typeof parsed.drafted_at !== "string" ||
        !["drafted", "approved", "posted"].includes(String(parsed.status))
      ) {
        continue;
      }
      records.push(parsed as QuoteLogRecord);
    } catch {
      continue;
    }
  }

  return records;
}

export function readQuoteLog(logPath = getLogPath()): QuoteLogRecord[] {
  const resolvedLogPath = resolveLocalPath(logPath);
  if (!existsSync(resolvedLogPath)) return [];
  return parseQuoteLog(readFileSync(resolvedLogPath, "utf8"));
}

export function appendQuoteLogRecord(
  record: QuoteLogRecord,
  logPath = getLogPath(),
): void {
  const resolvedLogPath = resolveLocalPath(logPath);
  mkdirSync(dirname(resolvedLogPath), { recursive: true });
  appendFileSync(resolvedLogPath, `${JSON.stringify(record)}\n`);
}

function latestActivityMs(record: QuoteLogRecord): number {
  const iso = record.posted_at ?? record.approved_at ?? record.drafted_at;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function latestLogByHash(
  records: QuoteLogRecord[],
): Map<string, QuoteLogRecord> {
  const latest = new Map<string, QuoteLogRecord>();

  for (const record of records) {
    const current = latest.get(record.quote_hash);
    if (!current || latestActivityMs(record) > latestActivityMs(current)) {
      latest.set(record.quote_hash, record);
    }
  }

  return latest;
}

export function buildLinkedInDraft(quote: Quote): string {
  const attribution =
    quote.provenance === "you"
      ? "A note from my working journal."
      : "A co-authored note from my working journal.";

  return [
    "A small operating rule I keep coming back to:",
    "",
    `"${quote.text}"`,
    "",
    attribution,
    "",
    "Daily cadence beats occasional intensity.",
    "",
    "#xOS #AI #BuildInPublic",
  ].join("\n");
}

export function selectNextQuoteFromDeckContent(
  markdown: string,
  logRecords: QuoteLogRecord[] = [],
  options: QuoteSelectionOptions = {},
): QuoteSelectionResult {
  let parsedQuotes: PostFreelyParseResult;
  try {
    parsedQuotes = parsePostFreelyQuoteDeck(markdown, options.deckPath);
  } catch {
    return {
      ok: false,
      reason: "ambiguous_post_freely_section",
      message: "Quote deck skipped: §1 POST FREELY parsing failed closed.",
    };
  }

  if (!parsedQuotes.ok) {
    return {
      ok: false,
      reason: parsedQuotes.reason,
      message: parsedQuotes.message,
    };
  }

  const quotes = parsedQuotes.quotes;
  const now = options.now ?? new Date();
  const dedupDays = options.dedupDays ?? DEFAULT_DEDUP_DAYS;
  const cutoffMs = now.getTime() - dedupDays * DAY_MS;
  const latest = latestLogByHash(logRecords);

  const candidates = quotes
    .map((quote, index) => {
      const latestRecord = latest.get(quote.quote_hash);
      return {
        quote,
        index,
        lastActivityMs: latestRecord
          ? latestActivityMs(latestRecord)
          : Number.NEGATIVE_INFINITY,
      };
    })
    .filter(({ lastActivityMs }) => lastActivityMs < cutoffMs)
    .sort((a, b) => {
      if (a.lastActivityMs !== b.lastActivityMs) {
        return a.lastActivityMs - b.lastActivityMs;
      }
      return a.index - b.index;
    });

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "all_quotes_inside_dedup_window",
      message: `Quote deck skipped: every §1 quote was used within the ${dedupDays}-day dedup window.`,
    };
  }

  const quote = candidates[0].quote;
  return {
    ok: true,
    reason: "selected",
    quote,
    draft: buildLinkedInDraft(quote),
  };
}

export function selectNextQuote(
  options: QuoteSelectionOptions = {},
): QuoteSelectionResult {
  const env = options.env ?? process.env;
  const deckPath = resolveLocalPath(options.deckPath ?? getDeckPath(env));

  if (!existsSync(deckPath)) {
    return {
      ok: false,
      reason: "missing_deck",
      message: `Quote deck skipped: ${deckPath} does not exist.`,
    };
  }

  const logPath = options.logPath ?? getLogPath(env);
  const markdown = readFileSync(deckPath, "utf8");
  const logRecords = readQuoteLog(logPath);

  return selectNextQuoteFromDeckContent(markdown, logRecords, {
    ...options,
    deckPath,
  });
}

export function createDraftRecord(
  quote: Quote,
  now = new Date(),
): QuoteLogRecord {
  return {
    quote_hash: quote.quote_hash,
    quote_text: quote.text,
    provenance: quote.provenance,
    drafted_at: now.toISOString(),
    status: "drafted",
    source: SOURCE,
  };
}

export function draftNextQuoteRun(
  options: QuoteSelectionOptions = {},
): QuoteDraftRunResult {
  const now = options.now ?? new Date();
  const selected = selectNextQuote({ ...options, now });
  if (!selected.ok) return selected;

  const env = options.env ?? process.env;
  const logPath = options.logPath ?? getLogPath(env);
  const logRecord = createDraftRecord(selected.quote, now);
  appendQuoteLogRecord(logRecord, logPath);

  return {
    ...selected,
    logRecord,
    approval: {
      quote_hash: selected.quote.quote_hash,
      command: `bun scripts/quote-selector.ts approve ${selected.quote.quote_hash}`,
    },
  };
}

export function approveQuoteRun(
  quoteHashToApprove: string,
  options: QuoteSelectionOptions = {},
): {
  ok: boolean;
  reason: "approved" | "already_approved" | "draft_not_found";
  record?: QuoteLogRecord;
  graduation?: GraduationStatus;
  message?: string;
} {
  const env = options.env ?? process.env;
  const logPath = options.logPath ?? getLogPath(env);
  const records = readQuoteLog(logPath);
  const latest = latestLogByHash(records).get(quoteHashToApprove);

  if (!latest) {
    return {
      ok: false,
      reason: "draft_not_found",
      message: `No drafted quote found for hash ${quoteHashToApprove}.`,
    };
  }

  if (latest.status === "approved") {
    return {
      ok: true,
      reason: "already_approved",
      record: latest,
      graduation: getGraduationStatus(records),
    };
  }

  const approvedRecord: QuoteLogRecord = {
    ...latest,
    approved_at: (options.now ?? new Date()).toISOString(),
    status: "approved",
    source: SOURCE,
  };
  appendQuoteLogRecord(approvedRecord, logPath);

  const updatedRecords = [...records, approvedRecord];
  return {
    ok: true,
    reason: "approved",
    record: approvedRecord,
    graduation: getGraduationStatus(updatedRecords),
  };
}

export function getGraduationStatus(
  records: QuoteLogRecord[],
  threshold = GRADUATION_APPROVAL_THRESHOLD,
): GraduationStatus {
  const approvedRuns = new Set<string>();

  for (const record of records) {
    if (record.status !== "approved" && record.status !== "posted") continue;
    const approvalKey =
      record.approved_at ?? `${record.quote_hash}:${record.drafted_at}`;
    approvedRuns.add(`${record.quote_hash}:${approvalKey}`);
  }

  return {
    approved_count: approvedRuns.size,
    threshold,
    eligible: approvedRuns.size >= threshold,
  };
}

export function isTelemetryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = (env.XOS_98_TELEMETRY ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

export async function emitQuoteTelemetry(
  event: QuoteTelemetryEvent,
  payload: Record<string, unknown>,
  options: {
    brain?: BrainTelemetryWriter;
    env?: NodeJS.ProcessEnv;
    now?: Date;
  } = {},
): Promise<
  | { emitted: true; path: string }
  | { emitted: false; reason: "disabled" | "missing_brain" | "write_failed" }
> {
  const env = options.env ?? process.env;
  if (!isTelemetryEnabled(env)) {
    return { emitted: false, reason: "disabled" };
  }

  if (!options.brain) {
    return { emitted: false, reason: "missing_brain" };
  }

  const priorResult = await options.brain.read(TELEMETRY_PATH);
  const prior = priorResult.ok && priorResult.content
    ? priorResult.content
    : "";
  const line = JSON.stringify({
    event,
    ...payload,
    ts: (options.now ?? new Date()).toISOString(),
  });

  const writeResult = await options.brain.write(
    TELEMETRY_PATH,
    `${prior}${line}\n`,
    {
      provenance: {
        who: ENGINE_ID,
        why: "quote flywheel local telemetry event",
        source: SOURCE,
      },
      engine_id: ENGINE_ID,
    },
  );

  if (!writeResult.ok) {
    return { emitted: false, reason: "write_failed" };
  }

  return { emitted: true, path: TELEMETRY_PATH };
}

function parseCliArgs(args: string[]): {
  command: string;
  positional: string[];
  options: QuoteSelectionOptions;
} {
  const remaining = [...args];
  let command = "select";
  if (remaining[0] && !remaining[0].startsWith("--")) {
    command = remaining.shift() ?? "select";
  }

  const positional: string[] = [];
  const options: QuoteSelectionOptions = {};

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === "--approve") {
      command = "approve";
      positional.push(remaining[++i] ?? "");
    } else if (arg === "--deck") {
      options.deckPath = remaining[++i];
    } else if (arg === "--log") {
      options.logPath = remaining[++i];
    } else if (arg === "--dedup-days") {
      const parsed = Number.parseInt(remaining[++i] ?? "", 10);
      if (Number.isFinite(parsed)) options.dedupDays = parsed;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, options };
}

async function main(): Promise<void> {
  const { command, positional, options } = parseCliArgs(
    process.argv.slice(2),
  );

  if (command === "approve") {
    const quoteHashToApprove = positional[0];
    if (!quoteHashToApprove) {
      console.error("Missing quote hash to approve.");
      process.exit(2);
    }
    console.log(JSON.stringify(approveQuoteRun(quoteHashToApprove, options), null, 2));
    return;
  }

  if (command === "graduation") {
    const logPath = options.logPath ?? getLogPath(options.env ?? process.env);
    console.log(JSON.stringify(getGraduationStatus(readQuoteLog(logPath)), null, 2));
    return;
  }

  console.log(JSON.stringify(draftNextQuoteRun(options), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
