import {
  draftNextQuoteRun,
  emitQuoteTelemetry,
  getLogPath,
  readQuoteLog,
  type BrainTelemetryWriter,
  type QuoteDraftRunOk,
  type QuoteLogRecord,
  type QuoteSelectionOptions,
  type QuoteSelectionSkip,
} from "./quote-selector";

export interface DailyCadenceCheckOk {
  surfaced: true;
  reason: "not_surfaced_today";
}

export interface DailyCadenceCheckAlreadySurfaced {
  surfaced: false;
  reason: "already_surfaced_today";
  existing: QuoteLogRecord;
}

export type DailyCadenceCheckResult =
  | DailyCadenceCheckOk
  | DailyCadenceCheckAlreadySurfaced;

export interface DailyCadenceOptions extends QuoteSelectionOptions {
  brain?: BrainTelemetryWriter;
  nowIso?: string;
}

export type DailyDraftSurfaced = Omit<QuoteDraftRunOk, "reason"> & {
  surfaced: true;
  reason: "daily_draft_surfaced";
  telemetry: Awaited<ReturnType<typeof emitQuoteTelemetry>>;
};

export type DailyDraftAlreadySurfaced = DailyCadenceCheckAlreadySurfaced;

export type DailyDraftSkipped = QuoteSelectionSkip & {
  surfaced: false;
};

export type DailyDraftResult =
  | DailyDraftSurfaced
  | DailyDraftAlreadySurfaced
  | DailyDraftSkipped;

function isoCalendarDateOrNull(value: string): string | null {
  // Defense-in-depth: shouldSurfaceToday is exported + may be called with
  // hand-built records that bypass parseQuoteLog's string validation. A legacy
  // record missing drafted_at must yield null (treated as "not today"), never a
  // TypeError crash.
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  return match ? match[1] : null;
}

export function isoCalendarDate(value: string): string {
  const date = isoCalendarDateOrNull(value);
  if (!date) {
    throw new Error(`Expected ISO date or timestamp, got: ${value}`);
  }
  return date;
}

// "Calendar day" is the UTC day: drafted_at is stored via now.toISOString()
// (quote-selector), and todayIso is likewise a UTC ISO timestamp, so the prefix
// comparison is internally consistent. Near UTC-midnight a draft-only surface
// could appear in two adjacent local days (or one local day spans two UTC days);
// for a DRAFT-only feature the worst case is one extra draft to approve — never a
// post, leak, or data loss. Local-day semantics are a post-graduation refinement.
export function shouldSurfaceToday(
  logRecords: QuoteLogRecord[],
  todayIso: string,
): DailyCadenceCheckResult {
  const today = isoCalendarDate(todayIso);

  for (const record of logRecords) {
    if (isoCalendarDateOrNull(record.drafted_at) === today) {
      return {
        surfaced: false,
        reason: "already_surfaced_today",
        existing: record,
      };
    }
  }

  return {
    surfaced: true,
    reason: "not_surfaced_today",
  };
}

function resolveNow(options: DailyCadenceOptions): Date {
  if (options.now) return options.now;
  if (options.nowIso) {
    const parsed = new Date(options.nowIso);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Expected ISO date or timestamp, got: ${options.nowIso}`);
    }
    return parsed;
  }
  return new Date();
}

export async function surfaceTodaysDraft(
  options: DailyCadenceOptions = {},
): Promise<DailyDraftResult> {
  const env = options.env ?? process.env;
  const logPath = options.logPath ?? getLogPath(env);
  const now = resolveNow(options);
  const records = readQuoteLog(logPath);
  const todayCheck = shouldSurfaceToday(records, now.toISOString());

  if (!todayCheck.surfaced) return todayCheck;

  const drafted = draftNextQuoteRun({
    ...options,
    env,
    logPath,
    now,
  });

  if (!drafted.ok) {
    return {
      ...drafted,
      surfaced: false,
    };
  }

  const telemetry = await emitQuoteTelemetry(
    "quote_daily_surfaced",
    {
      quote_hash: drafted.quote.quote_hash,
      provenance: drafted.quote.provenance,
      source_section: drafted.quote.sourceSection,
      drafted_at: drafted.logRecord.drafted_at,
      mode: "DRAFT_ONLY",
    },
    {
      brain: options.brain,
      env,
      now,
    },
  );

  return {
    ...drafted,
    surfaced: true,
    reason: "daily_draft_surfaced",
    telemetry,
  };
}

function parseCliArgs(args: string[]): DailyCadenceOptions {
  const options: DailyCadenceOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--deck") {
      options.deckPath = args[++i];
    } else if (arg === "--log") {
      options.logPath = args[++i];
    } else if (arg === "--dedup-days") {
      const parsed = Number.parseInt(args[++i] ?? "", 10);
      if (Number.isFinite(parsed)) options.dedupDays = parsed;
    } else if (arg === "--now") {
      options.nowIso = args[++i];
    }
  }

  return options;
}

async function main(): Promise<void> {
  const result = await surfaceTodaysDraft(parseCliArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
