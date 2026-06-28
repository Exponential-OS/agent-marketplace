import {
  emitEvent,
  isXos98TelemetryEnabled,
  readTelemetryState,
  ts,
  writeTelemetryState,
  type EmitEventResult,
  type TelemetryEvent,
  type TelemetryStateOptions,
} from "./events";

export const VOW_KINDS = ["applied", "screen", "interview", "offer", "confirmed_browser_submit"] as const;
export const ACTIVE_USER_TIME_BUCKETS = ["lt_5m", "5_15m", "15_60m", "60m_plus"] as const;

export type VowKind = (typeof VOW_KINDS)[number];
export type ActiveUserTimeBucket = (typeof ACTIVE_USER_TIME_BUCKETS)[number];

export interface NsmOptions extends TelemetryStateOptions {
  now?: Date;
}

export interface ValidatedOutwardWinEvent extends TelemetryEvent {
  event: "validated_outward_win";
  kind: VowKind;
  ts: string;
}

export interface ActiveUserTimeEvent extends TelemetryEvent {
  event: "active_user_time";
  seconds_bucket: ActiveUserTimeBucket;
  ts: string;
}

export interface BrowserSubmitResultInput {
  submitted?: boolean;
  confirmation_id?: string;
}

export interface MaybeEmitResult<T extends TelemetryEvent> {
  written: boolean;
  event?: T;
  path?: string;
  reason?: string;
}

export function buildValidatedOutwardWinEvent(
  input: { kind: VowKind },
  now: Date = new Date(),
): ValidatedOutwardWinEvent {
  assertVowKind(input.kind);
  return { event: "validated_outward_win", kind: input.kind, ts: ts(now) };
}

export function buildActiveUserTimeEvent(
  input: { seconds: number },
  now: Date = new Date(),
): ActiveUserTimeEvent {
  return {
    event: "active_user_time",
    seconds_bucket: activeUserTimeBucket(input.seconds),
    ts: ts(now),
  };
}

export function activeUserTimeBucket(seconds: number): ActiveUserTimeBucket {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 5 * 60) return "lt_5m";
  if (safeSeconds < 15 * 60) return "5_15m";
  if (safeSeconds < 60 * 60) return "15_60m";
  return "60m_plus";
}

export function vowKindFromApplicationStatus(status: string): VowKind | undefined {
  const normalized = status.trim().toUpperCase();
  if (normalized === "APPLIED" || normalized === "APPLY") return "applied";
  if (normalized === "SCREEN" || normalized === "SCREENING" || normalized === "SCREEN_SCHEDULED") return "screen";
  if (normalized === "INTERVIEW" || normalized === "INTERVIEWING") return "interview";
  if (normalized === "OFFER" || normalized === "OFFERED") return "offer";
  return undefined;
}

export function emitValidatedOutwardWin(
  input: { kind: VowKind },
  options: NsmOptions = {},
): EmitEventResult<ValidatedOutwardWinEvent> {
  const event = buildValidatedOutwardWinEvent(input, options.now);
  return emitEvent(event, options);
}

export function emitApplyTrackerValidatedOutwardWin(
  input: { status: string },
  options: NsmOptions = {},
): MaybeEmitResult<ValidatedOutwardWinEvent> {
  const kind = vowKindFromApplicationStatus(input.status);
  if (!kind) return { written: false, reason: "not_vow_status" };
  return emitValidatedOutwardWin({ kind }, options);
}

export function emitBrowserSubmitConfirmedVow(
  input: BrowserSubmitResultInput,
  options: NsmOptions = {},
): MaybeEmitResult<ValidatedOutwardWinEvent> {
  if (!input.submitted || !input.confirmation_id?.trim()) {
    return { written: false, reason: "not_confirmed" };
  }
  return emitValidatedOutwardWin({ kind: "confirmed_browser_submit" }, options);
}

export function emitActiveUserTime(
  input: { seconds: number },
  options: NsmOptions = {},
): EmitEventResult<ActiveUserTimeEvent> {
  const event = buildActiveUserTimeEvent(input, options.now);
  return emitEvent(event, options);
}

export function recordSessionStart(options: NsmOptions = {}): { written: boolean; path?: string } {
  const env = options.env ?? process.env;
  if (!isXos98TelemetryEnabled(env)) return { written: false };

  const state = readTelemetryState(options);
  const path = writeTelemetryState({
    ...state,
    session_started_at_ms: (options.now ?? new Date()).getTime(),
  }, options);
  return { written: true, path };
}

export function emitActiveUserTimeFromRecordedSession(
  options: NsmOptions = {},
): MaybeEmitResult<ActiveUserTimeEvent> {
  const env = options.env ?? process.env;
  if (!isXos98TelemetryEnabled(env)) return { written: false, reason: "disabled" };

  const state = readTelemetryState(options);
  if (typeof state.session_started_at_ms !== "number") {
    return { written: false, reason: "missing_session_start" };
  }

  const now = options.now ?? new Date();
  const seconds = Math.max(0, Math.floor((now.getTime() - state.session_started_at_ms) / 1000));
  const result = emitActiveUserTime({ seconds }, options);
  if (result.written) {
    const { session_started_at_ms: _sessionStartedAtMs, ...nextState } = state;
    writeTelemetryState(nextState, options);
  }
  return result;
}

function assertVowKind(value: string): asserts value is VowKind {
  if (!(VOW_KINDS as readonly string[]).includes(value)) {
    throw new Error(`kind must be one of ${VOW_KINDS.join(", ")}`);
  }
}

async function readCliInput(): Promise<Record<string, unknown>> {
  const raw = process.argv[3] !== undefined && process.argv[3] !== "-"
    ? process.argv[3]
    : (await Bun.stdin.text()).trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

if (import.meta.main) {
  try {
    const command = process.argv[2];
    const input = await readCliInput();
    let result: unknown;

    if (command === "vow") {
      result = emitValidatedOutwardWin({ kind: String(input.kind) as VowKind });
    } else if (command === "apply-status") {
      result = emitApplyTrackerValidatedOutwardWin({ status: String(input.status ?? "") });
    } else if (command === "browser-submit") {
      result = emitBrowserSubmitConfirmedVow({
        submitted: Boolean(input.submitted),
        confirmation_id: typeof input.confirmation_id === "string" ? input.confirmation_id : undefined,
      });
    } else if (command === "active-user-time") {
      result = emitActiveUserTime({ seconds: Number(input.seconds ?? 0) });
    } else if (command === "session-start") {
      result = recordSessionStart();
    } else if (command === "session-stop") {
      result = emitActiveUserTimeFromRecordedSession();
    } else {
      throw new Error("Usage: nsm.ts <vow|apply-status|browser-submit|active-user-time|session-start|session-stop> '<json>'");
    }

    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
