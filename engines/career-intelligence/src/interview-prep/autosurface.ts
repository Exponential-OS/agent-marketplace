import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { emitEvent } from "../telemetry/events";

export const INTERVIEW_PREP_SURFACED_EVENT = "interview_prep_surfaced";
export const INTERVIEW_PREP_CANONICAL_DIR = "career-intelligence/projects/interview-prep";

export type InterviewPrepTrigger = "status_change" | "calendar";

export interface InterviewPrepAutosurfaceInput {
  company: string;
  role: string;
  tracker_id: string | number;
  status_updated_at: string;
  status?: string;
  stage?: string;
  interviewers?: string[] | string;
  date?: string;
  jd_path?: string;
}

export interface InterviewPrepInvocation {
  skill: "interview-prep";
  payload: {
    company: string;
    role: string;
    stage: "panel_interview";
    interviewers?: string[];
    date?: string;
    jd_path?: string;
  };
}

export interface InterviewPrepSurfacedEvent {
  event: typeof INTERVIEW_PREP_SURFACED_EVENT;
  trigger: InterviewPrepTrigger;
  company: string;
  role: string;
  tracker_id: string;
  status_updated_at: string;
  prep_doc_path: string;
  dedupe_key: string;
  ts: string;
}

export interface InterviewPrepAutosurfaceOptions {
  careerHome?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface InterviewPrepAutosurfaceResult {
  action: "invoke_interview_prep" | "skip";
  reason?: "not_interview_transition" | "prep_doc_exists" | "already_surfaced";
  prep_doc_path: string;
  dedupe_key: string;
  invocation?: InterviewPrepInvocation;
  confirmation?: string;
  event_emitted: boolean;
  event?: InterviewPrepSurfacedEvent;
}

export function interviewPrepRelativePath(company: string): string {
  return `${INTERVIEW_PREP_CANONICAL_DIR}/prep-${safeCompanyFileToken(company)}.md`;
}

export function interviewPrepDedupeKey(input: InterviewPrepAutosurfaceInput): string {
  return [
    String(input.tracker_id).trim(),
    input.company.trim(),
    input.role.trim(),
    input.status_updated_at.trim(),
  ].join(":");
}

export function surfaceInterviewPrepOnStatusChange(
  input: InterviewPrepAutosurfaceInput,
  opts: InterviewPrepAutosurfaceOptions = {},
): InterviewPrepAutosurfaceResult {
  validateInput(input);

  const company = input.company.trim();
  const role = input.role.trim();
  const status = input.status?.trim().toUpperCase();
  const stage = input.stage?.trim();
  const tracker_id = String(input.tracker_id).trim();
  const status_updated_at = input.status_updated_at.trim();
  const prep_doc_path = interviewPrepRelativePath(company);
  const dedupe_key = interviewPrepDedupeKey({ ...input, company, role, tracker_id, status_updated_at });
  const careerHome = opts.careerHome ?? process.env.CAREER_HOME ?? process.env.CAREER_OS_HOME ?? process.cwd();
  const absolutePrepDocPath = resolve(careerHome, prep_doc_path);
  const eventLogPath = defaultEventLogPath(careerHome);

  const base = {
    prep_doc_path,
    dedupe_key,
    event_emitted: false,
  };

  if (status !== "INTERVIEWING" || stage !== "panel_interview") {
    return { action: "skip", reason: "not_interview_transition", ...base };
  }

  if (existsSync(absolutePrepDocPath)) {
    return { action: "skip", reason: "prep_doc_exists", ...base };
  }

  if (eventAlreadyRecorded(eventLogPath, dedupe_key)) {
    return { action: "skip", reason: "already_surfaced", ...base };
  }

  const invocation: InterviewPrepInvocation = {
    skill: "interview-prep",
    payload: {
      company,
      role,
      stage: "panel_interview",
    },
  };
  const interviewers = normalizeInterviewers(input.interviewers);
  if (interviewers.length > 0) invocation.payload.interviewers = interviewers;
  if (input.date?.trim()) invocation.payload.date = input.date.trim();
  if (input.jd_path?.trim()) invocation.payload.jd_path = input.jd_path.trim();

  const event = buildInterviewPrepSurfacedEvent({
    company,
    role,
    tracker_id,
    status_updated_at,
    prep_doc_path,
    dedupe_key,
    now: opts.now,
  });
  const event_emitted = appendEventOnce(eventLogPath, event, opts.env ?? process.env);

  return {
    action: "invoke_interview_prep",
    prep_doc_path,
    dedupe_key,
    invocation,
    confirmation: `Interview prep surfaced: ${prep_doc_path}`,
    event_emitted,
    event,
  };
}

function buildInterviewPrepSurfacedEvent(args: {
  company: string;
  role: string;
  tracker_id: string;
  status_updated_at: string;
  prep_doc_path: string;
  dedupe_key: string;
  now?: Date;
}): InterviewPrepSurfacedEvent {
  return {
    event: INTERVIEW_PREP_SURFACED_EVENT,
    trigger: "status_change",
    company: args.company,
    role: args.role,
    tracker_id: args.tracker_id,
    status_updated_at: args.status_updated_at,
    prep_doc_path: args.prep_doc_path,
    dedupe_key: args.dedupe_key,
    ts: (args.now ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

function appendEventOnce(
  path: string,
  event: InterviewPrepSurfacedEvent,
  env: Record<string, string | undefined>,
): boolean {
  try {
    if (eventAlreadyRecorded(path, event.dedupe_key)) return false;
    return emitEvent(event, { env, eventsPath: path }).written;
  } catch {
    return false;
  }
}

function eventAlreadyRecorded(path: string, dedupeKey: string): boolean {
  if (!existsSync(path)) return false;

  try {
    const lines = readFileSync(path, "utf-8").split("\n");
    return lines.some((line) => {
      if (!line.trim()) return false;
      try {
        const rec = JSON.parse(line) as { event?: unknown; dedupe_key?: unknown };
        return rec.event === INTERVIEW_PREP_SURFACED_EVENT && rec.dedupe_key === dedupeKey;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function defaultEventLogPath(careerHome: string): string {
  return join(careerHome, "brain", "sessions", "events.jsonl");
}

function normalizeInterviewers(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function safeCompanyFileToken(company: string): string {
  return company.trim().replace(/[\\/]+/g, "-");
}

function validateInput(input: InterviewPrepAutosurfaceInput): void {
  const required: Array<keyof InterviewPrepAutosurfaceInput> = [
    "company",
    "role",
    "tracker_id",
    "status_updated_at",
  ];
  const missing = required.filter((field) => String(input[field] ?? "").trim() === "");
  if (missing.length > 0) {
    throw new Error(`missing required field(s): ${missing.join(", ")}`);
  }
}
