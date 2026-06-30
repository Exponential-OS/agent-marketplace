/**
 * UserPromptSubmit hook for Linear bus pull + session-role heartbeat.
 *
 * Fail-safe contract: every exported and CLI entry point catches errors and
 * emits nothing on failure. This hook must never block or deny a prompt.
 *
 * XOS-120: also writes a session liveness heartbeat on every prompt and
 * appends role coverage to the additionalContext when roles are non-empty.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  getLinearBusHighWatermark,
  hasLinearDelta,
  queryLinearBusDelta,
  resolveLinearConfig,
  type LinearBusDelta,
  type LinearBusResult,
  type LinearConfig,
} from "../linear-bus.ts";
import {
  resolveRoles,
  resolveSessionDataRoot,
  writeSessionHeartbeat,
} from "../session-roles.ts";

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_COLD_START_WINDOW = "24h";
const HOOK_TIMEOUT_MS = 4_000;
const HEARTBEAT_BUDGET_MS = 500; // max time to spend on heartbeat write
const SUMMARY_ITEM_LIMIT = 8;

type Env = Record<string, string | undefined>;

export interface LinearBusHookInput {
  session_id: string;
  cwd?: string;
}

export interface LinearBusMarker {
  last_seen_at: string;
  updated_at?: string;
}

export interface LinearBusHookOptions {
  env?: Env;
  dataRoot?: string;
  fetchDelta?: (since: string, config: LinearConfig) => Promise<LinearBusResult>;
  now?: () => Date;
  /** Injectable for tests: override the heartbeat write. Defaults to writeSessionHeartbeat. */
  writeHeartbeat?: (opts: {
    sessionId: string;
    host: string;
    allRoles: string[];
    env: Env;
    dataRoot: string;
  }) => Promise<void>;
}

export async function runLinearBusPull(
  rawInput: string,
  options: LinearBusHookOptions = {},
): Promise<string | null> {
  try {
    return await runLinearBusPullUnsafe(rawInput, options);
  } catch {
    return null;
  }
}

export function resolveLinearBusDataRoot(env: Env = process.env): string {
  const configured = env.CLAUDE_PLUGIN_DATA?.trim();
  if (configured) return expandHome(configured, env);
  return join(env.HOME || homedir(), ".cyborg-state");
}

export function resolveLinearBusMarkerPath(
  sessionId: string,
  env: Env = process.env,
  dataRoot?: string,
): string {
  validateSessionId(sessionId);
  return join(dataRoot ?? resolveLinearBusDataRoot(env), "linear-bus", `${sessionId}.json`);
}

export function summarizeLinearBusDelta(delta: LinearBusDelta): string {
  const parts: string[] = [];
  const totalItems =
    delta.assignedIssues.length + delta.recentComments.length + delta.urgentIssues.length;
  let remaining = SUMMARY_ITEM_LIMIT;
  let displayed = 0;

  if (delta.assignedIssues.length > 0) {
    const visible = delta.assignedIssues.slice(0, remaining);
    remaining -= visible.length;
    displayed += visible.length;
    parts.push(
      `${delta.assignedIssues.length} assigned updated: ${visible.map(formatIssue).join("; ")}`,
    );
  }

  if (delta.recentComments.length > 0) {
    const visible = delta.recentComments.slice(0, remaining);
    remaining -= visible.length;
    displayed += visible.length;
    if (visible.length > 0) {
      parts.push(
        `${delta.recentComments.length} comment${delta.recentComments.length === 1 ? "" : "s"}: ${visible
          .map(formatComment)
          .join("; ")}`,
      );
    }
  }

  if (delta.urgentIssues.length > 0) {
    const visible = delta.urgentIssues.slice(0, remaining);
    remaining -= visible.length;
    displayed += visible.length;
    if (visible.length > 0) {
      parts.push(`${delta.urgentIssues.length} urgent: ${visible.map(formatIssue).join("; ")}`);
    }
  }

  const hidden = totalItems - displayed;
  if (hidden > 0) {
    parts.push(`+${hidden} more`);
  }

  return truncate(`BUS: ${parts.join(" | ")}`, 1800);
}

async function runLinearBusPullUnsafe(
  rawInput: string,
  options: LinearBusHookOptions,
): Promise<string | null> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const input = parseHookInput(rawInput);
  const dataRoot = options.dataRoot ?? resolveLinearBusDataRoot(env);
  const markerPath = resolveLinearBusMarkerPath(input.session_id, env, dataRoot);
  const since = resolveLastSeenAt(markerPath, env, now);
  const config = resolveLinearConfig(env, input.cwd ?? process.cwd(), markerPath);
  const fetchDelta = options.fetchDelta ?? queryLinearBusDelta;

  // XOS-120: Write session liveness heartbeat (fire-and-forget with 500ms cap).
  // Runs regardless of whether the bus delta has new items — the heartbeat is
  // the liveness signal, not the delta.
  const allRoles = resolveAllRoles(env);
  const heartbeatFn = options.writeHeartbeat ?? defaultWriteHeartbeat;
  // Start heartbeat — bounded by its internal 500ms timeout; don't let it
  // block the overall HOOK_TIMEOUT_MS budget
  const heartbeatPromise = heartbeatFn({
    sessionId: input.session_id,
    host: hostname(),
    allRoles,
    env,
    dataRoot,
  }).catch(() => undefined); // fail-open

  const result = await withTimeout(fetchDelta(since, config), HOOK_TIMEOUT_MS);

  // Await heartbeat within its own budget (already capped internally, but ensure
  // it doesn't leak past the overall hook window either)
  await Promise.race([heartbeatPromise, delay(HEARTBEAT_BUDGET_MS)]);

  if (!result.ok || !result.delta || !hasLinearDelta(result.delta)) {
    // Even with no delta, emit role context if this session has a non-trivial role set
    const rolesSummary = buildRolesSummary(input.session_id, allRoles, dataRoot);
    if (rolesSummary) {
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: rolesSummary,
        },
      });
    }
    return null;
  }

  const busSummary = summarizeLinearBusDelta(result.delta);
  const rolesSummary = buildRolesSummary(input.session_id, allRoles, dataRoot);
  const additionalContext = rolesSummary
    ? `${busSummary} | ${rolesSummary}`
    : busSummary;

  const lastSeenAt = maxTimestamp(since, getLinearBusHighWatermark(result.delta) ?? result.delta.queriedAt);
  writeMarker(markerPath, {
    last_seen_at: lastSeenAt,
    updated_at: now().toISOString(),
  });

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  });
}

/** Resolve the configured role set from env or fall back to generalist ["*"]. */
function resolveAllRoles(env: Env): string[] {
  const raw = env.LINEAR_SESSION_ROLES?.trim();
  if (!raw) return ["*"];
  const roles = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return roles.length > 0 ? roles : ["*"];
}

/**
 * Build a compact role-coverage summary for additionalContext.
 * Returns null for solo sessions — implicit (all roles = all roles; no sibling coordination).
 * Only emits when siblings are detected, to avoid noise in the default single-session case.
 */
function buildRolesSummary(sessionId: string, allRoles: string[], dataRoot: string): string | null {
  try {
    // Pass the known role universe (empty when generalist ["*"] — resolved inside resolveRoles)
    const known = allRoles.filter((r) => r !== "*");
    const resolved = resolveRoles(sessionId, known, dataRoot);
    if (resolved.isSolo) return null; // solo: suppress, implicit
    if (resolved.roles.length === 0) return "ROLES: none (all shed to dedicated sessions)";
    return `ROLES: ${resolved.roles.join(",")}`;
  } catch {
    return null;
  }
}

async function defaultWriteHeartbeat(opts: {
  sessionId: string;
  host: string;
  allRoles: string[];
  env: Env;
  dataRoot: string;
}): Promise<void> {
  await writeSessionHeartbeat(opts);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHookInput(rawInput: string): LinearBusHookInput {
  const parsed: unknown = JSON.parse(rawInput);
  if (!isRecord(parsed) || typeof parsed.session_id !== "string") {
    throw new Error("session_id missing");
  }
  validateSessionId(parsed.session_id);
  return {
    session_id: parsed.session_id,
    cwd: typeof parsed.cwd === "string" && parsed.cwd.trim() ? parsed.cwd : undefined,
  };
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error("invalid session_id");
  }
}

function resolveLastSeenAt(markerPath: string, env: Env, now: () => Date): string {
  try {
    if (!existsSync(markerPath)) return resolveColdStartSince(env, now());
    return readLastSeenAt(markerPath) ?? resolveColdStartSince(env, now());
  } catch {
    return resolveColdStartSince(env, now());
  }
}

function resolveColdStartSince(env: Env, now: Date): string {
  return new Date(now.getTime() - parseWindowMs(env.LINEAR_BUS_COLD_START_WINDOW)).toISOString();
}

function parseWindowMs(value: string | undefined): number {
  const fallbackMs = 24 * 60 * 60 * 1000;
  const raw = value?.trim() || DEFAULT_COLD_START_WINDOW;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs;

  const unit = match[2].toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

function readLastSeenAt(markerPath: string): string | null {
  const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
  if (!isRecord(parsed) || typeof parsed.last_seen_at !== "string") {
    return null;
  }
  if (Number.isNaN(Date.parse(parsed.last_seen_at))) {
    return null;
  }
  return parsed.last_seen_at;
}

function writeMarker(markerPath: string, marker: LinearBusMarker): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(
    markerPath,
    JSON.stringify({ ...readMarkerRecord(markerPath), ...marker }, null, 2) + "\n",
    "utf8",
  );
}

function readMarkerRecord(markerPath: string): Record<string, unknown> {
  try {
    if (!existsSync(markerPath)) return {};
    const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Linear bus hook timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatIssue(issue: { identifier: string; title: string }): string {
  return truncate(`${issue.identifier || "issue"} ${compact(issue.title)}`.trim(), 100);
}

function formatComment(comment: LinearBusDelta["recentComments"][number]): string {
  const author = compact(comment.user?.name || "comment");
  const body = compact(comment.body || "updated");
  return truncate(`${author} on ${comment.issue.identifier || "issue"}: ${body}`, 140);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function maxTimestamp(a: string, b: string): string {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (Number.isNaN(aTime)) return b;
  if (Number.isNaN(bTime)) return a;
  return new Date(Math.max(aTime, bTime)).toISOString();
}

function expandHome(value: string, env: Env): string {
  if (value === "~") return env.HOME || homedir();
  if (value.startsWith("~/")) return join(env.HOME || homedir(), value.slice(2));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readStdin(): Promise<string> {
  return process.stdin.isTTY ? "" : await Bun.stdin.text();
}

export async function runCli(): Promise<void> {
  try {
    const output = await runLinearBusPull(await readStdin());
    if (output) process.stdout.write(output + "\n");
  } catch {
    // Fail-safe: emit nothing.
  }
  process.exit(0);
}

if (import.meta.main) {
  await runCli();
}
