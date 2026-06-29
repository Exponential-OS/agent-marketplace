/**
 * session-roles.ts — XOS-120 solo-session role coverage + heartbeat liveness.
 *
 * Protocol:
 *   1. Solo session → owns ALL known roles by default (computed dynamically).
 *   2. Each session writes a heartbeat liveness marker (local primary; optional
 *      single-comment on a Linear issue as best-effort cross-machine broadcast).
 *   3. Effective role coverage is computed as: allRoles minus roles exclusively
 *      owned by OTHER LIVE dedicated sibling sessions. A dedicated session
 *      (all_roles ≠ ["*"]) never sheds its own roles. Roles auto-reclaim when
 *      a dedicated sibling goes stale.
 *
 * All public functions fail open: they never throw; they return a warn/error
 * string on non-fatal errors, preserving hook prompt safety.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STALE_MINUTES = 30;
const LINEAR_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes between Linear mutations
const HEARTBEAT_LINEAR_TIMEOUT_MS = 500; // hard cap on Linear write
const SESSION_DIR_SUFFIX = join("coordination", "sessions");
const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

type Env = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface SessionLivenessMarker {
  session_id: string;
  host: string;
  started_at: string;
  last_heartbeat_at: string;
  /** ["*"] = generalist (covers all roles). Specific list = dedicated session. */
  all_roles: string[];
  /** ID of the heartbeat comment on the LINEAR_COORDINATION_ISSUE_ID issue. */
  linear_comment_id?: string;
  /** ISO timestamp of last successful Linear mutation (persisted for throttle). */
  last_linear_mutation_at?: string;
}

export interface HeartbeatResult {
  ok: boolean;
  warn?: string;
}

export interface ResolvedRoles {
  /** Effective role set for this session at this moment. */
  roles: string[];
  /** True when no other live sessions are detected. */
  isSolo: boolean;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function resolveSessionDataRoot(env: Env = process.env): string {
  const configured = env.CLAUDE_PLUGIN_DATA?.trim();
  if (configured) return expandHome(configured, env);
  return join(env.HOME || homedir(), ".cyborg-state");
}

function resolveSessionDir(dataRoot: string): string {
  return join(dataRoot, SESSION_DIR_SUFFIX);
}

function resolveMarkerPath(sessionId: string, dataRoot: string): string {
  return join(resolveSessionDir(dataRoot), `${sessionId}.json`);
}

// ---------------------------------------------------------------------------
// Marker file I/O
// ---------------------------------------------------------------------------

function readMarkerFile(path: string): SessionLivenessMarker | null {
  try {
    if (!existsSync(path)) return null;
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(raw) || typeof raw.session_id !== "string") return null;
    return raw as unknown as SessionLivenessMarker;
  } catch {
    return null;
  }
}

function writeMarkerFile(path: string, marker: SessionLivenessMarker): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(marker, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// readActiveSessions
// ---------------------------------------------------------------------------

/**
 * Scans the session directory for all live session markers, excluding
 * sessions whose last_heartbeat_at is older than stalenessMinutes.
 */
export function readActiveSessions(
  dataRoot: string,
  stalenessMinutes: number = DEFAULT_STALE_MINUTES,
): SessionLivenessMarker[] {
  try {
    const sessionDir = resolveSessionDir(dataRoot);
    if (!existsSync(sessionDir)) return [];
    const files = readdirSync(sessionDir).filter((f: string) => f.endsWith(".json"));
    const cutoff = Date.now() - stalenessMinutes * 60 * 1000;
    const active: SessionLivenessMarker[] = [];
    for (const file of files) {
      const marker = readMarkerFile(join(sessionDir, file));
      if (!marker) continue;
      const hbTime = Date.parse(marker.last_heartbeat_at);
      if (Number.isNaN(hbTime) || hbTime < cutoff) continue;
      active.push(marker);
    }
    return active;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// isSoloSession
// ---------------------------------------------------------------------------

/**
 * Returns true iff this session is the only live session (no live siblings).
 */
export function isSoloSession(
  sessionId: string,
  dataRoot: string,
  stalenessMinutes: number = DEFAULT_STALE_MINUTES,
): boolean {
  const active = readActiveSessions(dataRoot, stalenessMinutes);
  return !active.some((m) => m.session_id !== sessionId);
}

// ---------------------------------------------------------------------------
// detectRoleOwner
// ---------------------------------------------------------------------------

/**
 * Returns the session_id of the live DEDICATED session that claims this role,
 * or null if covered by a generalist session or unclaimed.
 *
 * A "dedicated" session is one whose all_roles does NOT contain "*".
 */
export function detectRoleOwner(
  role: string,
  dataRoot: string,
  stalenessMinutes: number = DEFAULT_STALE_MINUTES,
): string | null {
  const active = readActiveSessions(dataRoot, stalenessMinutes);
  for (const m of active) {
    if (!isDedicated(m.all_roles)) continue; // skip generalists
    if (m.all_roles.includes(role)) return m.session_id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// resolveRoles
// ---------------------------------------------------------------------------

/**
 * Computes the effective role set for this session dynamically.
 *
 * Rules:
 *  - Generalist (all_roles = ["*"]): covers allRoles MINUS roles exclusively
 *    claimed by live DEDICATED sibling sessions.
 *  - Dedicated (all_roles ≠ ["*"]): returns all_roles unchanged — a dedicated
 *    session NEVER sheds its own configured roles.
 *  - Two dedicated sessions claiming the same role: both keep it (no flatline).
 */
export function resolveRoles(
  sessionId: string,
  allRoles: string[],
  dataRoot: string,
  stalenessMinutes: number = DEFAULT_STALE_MINUTES,
): ResolvedRoles {
  // Read current marker to determine whether this is a generalist or dedicated session
  const markerPath = resolveMarkerPath(sessionId, dataRoot);
  const marker = readMarkerFile(markerPath);
  const myRoles = marker?.all_roles ?? ["*"];

  if (isDedicated(myRoles)) {
    // Dedicated sessions keep their own roles unconditionally
    const solo = isSoloSession(sessionId, dataRoot, stalenessMinutes);
    return { roles: myRoles, isSolo: solo };
  }

  // Generalist ("*") session: shed roles to live dedicated siblings
  const active = readActiveSessions(dataRoot, stalenessMinutes);
  const siblings = active.filter((m) => m.session_id !== sessionId);
  const solo = siblings.length === 0;

  // Collect roles claimed by dedicated siblings
  const dedicatedClaimed = new Set<string>();
  for (const s of siblings) {
    if (!isDedicated(s.all_roles)) continue;
    for (const r of s.all_roles) dedicatedClaimed.add(r);
  }

  const effective = allRoles.filter((r) => !dedicatedClaimed.has(r));
  return { roles: effective, isSolo: solo };
}

// ---------------------------------------------------------------------------
// writeSessionHeartbeat
// ---------------------------------------------------------------------------

/**
 * Writes/updates the local session marker and optionally posts a heartbeat
 * comment to a Linear issue (fire-and-forget with 500 ms cap).
 *
 * Never throws. Returns a HeartbeatResult with ok=false and warn on errors.
 */
export async function writeSessionHeartbeat(opts: {
  sessionId: string;
  host?: string;
  allRoles?: string[];
  env?: Env;
  dataRoot?: string;
}): Promise<HeartbeatResult> {
  try {
    return await writeSessionHeartbeatUnsafe(opts);
  } catch (err) {
    return { ok: false, warn: `writeSessionHeartbeat: ${String(err)}` };
  }
}

async function writeSessionHeartbeatUnsafe(opts: {
  sessionId: string;
  host?: string;
  allRoles?: string[];
  env?: Env;
  dataRoot?: string;
}): Promise<HeartbeatResult> {
  const env = opts.env ?? process.env;
  const dataRoot = opts.dataRoot ?? resolveSessionDataRoot(env);
  const markerPath = resolveMarkerPath(opts.sessionId, dataRoot);
  const now = new Date().toISOString();

  // Read existing marker to preserve fields (linear_comment_id, started_at, etc.)
  const existing = readMarkerFile(markerPath);

  const marker: SessionLivenessMarker = {
    session_id: opts.sessionId,
    host: opts.host ?? existing?.host ?? "unknown",
    started_at: existing?.started_at ?? now,
    last_heartbeat_at: now,
    all_roles: opts.allRoles ?? existing?.all_roles ?? ["*"],
    linear_comment_id: existing?.linear_comment_id,
    last_linear_mutation_at: existing?.last_linear_mutation_at,
  };

  // Write local marker first (always, regardless of Linear success)
  writeMarkerFile(markerPath, marker);

  // Optionally write to Linear bus (fail-open)
  // Note: writeLinearHeartbeat persists linear_comment_id and last_linear_mutation_at
  // back to the marker file directly; we don't need to re-write here.
  const linearWarn = await writeLinearHeartbeat(marker, env, dataRoot);

  return { ok: true, ...(linearWarn ? { warn: linearWarn } : {}) };
}

// ---------------------------------------------------------------------------
// Linear heartbeat write (optional, fail-open)
// ---------------------------------------------------------------------------

async function writeLinearHeartbeat(
  marker: SessionLivenessMarker,
  env: Env,
  dataRoot: string,
): Promise<string | null> {
  const apiKey = env.LINEAR_API_KEY?.trim();
  const issueId = env.LINEAR_COORDINATION_ISSUE_ID?.trim();
  if (!apiKey || !issueId) return null;

  // Throttle: only write if ≥ LINEAR_THROTTLE_MS since last mutation
  if (marker.last_linear_mutation_at) {
    const lastMs = Date.parse(marker.last_linear_mutation_at);
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < LINEAR_THROTTLE_MS) {
      return null; // within throttle window, skip
    }
  }

  const body = formatHeartbeatBody(marker);

  try {
    let commentId: string | null = null;

    if (marker.linear_comment_id) {
      // Update existing comment
      await withLinearTimeout(updateLinearComment(apiKey, marker.linear_comment_id, body));
    } else {
      // Create new comment, store ID in marker
      commentId = await withLinearTimeout(createLinearComment(apiKey, issueId, body));
    }

    // Persist updates back to marker file (using the caller-supplied dataRoot)
    const markerPath = resolveMarkerPath(marker.session_id, dataRoot);
    const updated = readMarkerFile(markerPath) ?? marker;
    if (commentId) updated.linear_comment_id = commentId;
    updated.last_linear_mutation_at = new Date().toISOString();
    writeMarkerFile(markerPath, updated);

    return null; // success
  } catch (err) {
    return `Linear heartbeat write: ${String(err)}`;
  }
}

function formatHeartbeatBody(marker: SessionLivenessMarker): string {
  const roles = marker.all_roles.join(",");
  return `🤖 Session alive: ${marker.session_id}@${marker.host} | roles: ${roles} | last: ${marker.last_heartbeat_at}`;
}

async function createLinearComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<string> {
  const mutation = `mutation CreateHeartbeat($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment { id }
    }
  }`;
  const res = await postLinear(apiKey, mutation, { issueId, body });
  const id = res?.data?.commentCreate?.comment?.id;
  if (typeof id !== "string" || !id) throw new Error("createLinearComment: no comment id returned");
  return id;
}

async function updateLinearComment(
  apiKey: string,
  commentId: string,
  body: string,
): Promise<void> {
  const mutation = `mutation UpdateHeartbeat($id: String!, $body: String!) {
    commentUpdate(id: $id, input: { body: $body }) {
      success
    }
  }`;
  await postLinear(apiKey, mutation, { id: commentId, body });
}

async function postLinear(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear HTTP ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Linear: non-JSON response");
  }
  if (!isRecord(json)) throw new Error("Linear: unexpected response shape");
  if (isRecord(json.errors)) throw new Error(`Linear errors: ${JSON.stringify(json.errors)}`);
  return json as Record<string, unknown>;
}

async function withLinearTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Linear heartbeat timeout")),
          HEARTBEAT_LINEAR_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDedicated(allRoles: string[]): boolean {
  return !allRoles.includes("*");
}

function expandHome(value: string, env: Env): string {
  if (value === "~") return env.HOME || homedir();
  if (value.startsWith("~/")) return join(env.HOME || homedir(), value.slice(2));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
