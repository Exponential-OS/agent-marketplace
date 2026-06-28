import {
  defaultEventsPath,
  emitEvent,
  isXos98TelemetryEnabled,
  ts,
} from "../telemetry/events";

export interface CoverLetterGeneratedInput {
  standalone: boolean;
  company: string;
  role: string;
}

export interface CoverLetterGeneratedEvent {
  event: "cover_letter_generated";
  standalone: boolean;
  company: string;
  role: string;
  ts: string;
}

export interface EmitCoverLetterGeneratedOptions {
  env?: Record<string, string | undefined>;
  eventsPath?: string;
  now?: Date;
}

export interface EmitCoverLetterGeneratedResult {
  written: boolean;
  event: CoverLetterGeneratedEvent;
  path?: string;
}

export { isXos98TelemetryEnabled };

export function defaultCoverLetterEventsPath(env: Record<string, string | undefined> = process.env): string {
  return defaultEventsPath(env);
}

export function buildCoverLetterGeneratedEvent(
  input: CoverLetterGeneratedInput,
  now: Date = new Date(),
): CoverLetterGeneratedEvent {
  const company = input.company.trim();
  const role = input.role.trim();

  if (!company) throw new Error("company is required");
  if (!role) throw new Error("role is required");

  return {
    event: "cover_letter_generated",
    standalone: Boolean(input.standalone),
    company,
    role,
    ts: ts(now),
  };
}

export function emitCoverLetterGenerated(
  input: CoverLetterGeneratedInput,
  options: EmitCoverLetterGeneratedOptions = {},
): EmitCoverLetterGeneratedResult {
  const env = options.env ?? process.env;
  const event = buildCoverLetterGeneratedEvent(input, options.now);
  return emitEvent(event, { env, eventsPath: options.eventsPath });
}

async function readCliInput(): Promise<string> {
  const arg = process.argv[2];
  if (arg !== undefined && arg !== "-") return arg;
  return (await Bun.stdin.text()).trim();
}

if (import.meta.main) {
  try {
    const raw = await readCliInput();
    if (!raw) throw new Error("Usage: events.ts '<json>'");
    const input = JSON.parse(raw) as CoverLetterGeneratedInput;
    const result = emitCoverLetterGenerated(input);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
