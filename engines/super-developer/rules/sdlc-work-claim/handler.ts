#!/usr/bin/env bun
/**
 * handler.ts - sdlc-work-claim enforcement.
 *
 * WHAT: before SDLC work proceeds, the Linear issue must be claimed by this
 * session as In Progress plus exactly one fresh SDLC-CLAIM comment. A different
 * live owner blocks the pipeline.
 *
 * MODES:
 *   1. PreToolUse hook (stdin JSON):
 *      Reads {tool_name, tool_input} and evaluates tool_input when it carries
 *      {action, ticket, session, branch?, host?, worktree?}.
 *   2. Direct invocation (arg JSON):
 *      Reads {action, ticket, session, branch?, host?, worktree?},
 *      returns the claim verdict JSON.
 */
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const SLUG = "sdlc-work-claim";
export const STALE_MIN = 30;
export const CLAIM_PREFIX = "🤖 SDLC-CLAIM";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const IN_PROGRESS_STATE = "In Progress";
const DONE_STATE = "Done";
const LOG_PATH = join(homedir(), ".cyborg-enforcement-log.jsonl");
const LINEAR_KEY_REMEDIATION =
  "export LINEAR_API_KEY=<key> (Linear → Settings → API → Personal API keys); cross-machine claim coordination cannot work without it.";

type Action = "check" | "claim" | "heartbeat" | "release" | "complete";
type Verdict = "PASS" | "BLOCK";
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ClaimInput {
  action?: unknown;
  ticket?: unknown;
  session?: unknown;
  branch?: unknown;
  host?: unknown;
  worktree?: unknown;
  summary?: unknown;
  findings?: unknown;
  pr_url?: unknown;
}

interface NormalizedInput {
  action: Action;
  ticket: string;
  session: string;
  branch?: string;
  host?: string;
  worktree?: string;
  summary?: string;
  findings?: string;
  pr_url?: string;
}

interface ClaimOutput {
  verdict: Verdict;
  action: string;
  ticket: string;
  owner_session: string | null;
  heartbeat_age_min: number | null;
  reclaimable: boolean;
  message: string;
}

interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

interface LinearWorkflowState {
  id: string;
  name: string;
}

interface LinearComment {
  id: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LinearIssue {
  id: string;
  identifier?: string;
  state: LinearWorkflowState | null;
  team?: {
    states?: {
      nodes?: LinearWorkflowState[];
    };
  } | null;
  comments: LinearComment[];
}

interface ParsedClaim {
  session: string;
  host: string;
  branch: string;
  worktree: string;
  started: string;
  heartbeat: string;
}

interface ClaimComment {
  comment: LinearComment;
  claim: ParsedClaim;
}

interface ProcessOptions {
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
  now?: Date;
  homeDir?: string;
}

function isoNow(now = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z");
}

function log(rec: Record<string, unknown>): void {
  try {
    appendFileSync(LOG_PATH, JSON.stringify({ ts: isoNow(), rule_slug: SLUG, ...rec }) + "\n");
  } catch {
    /* fail-open telemetry */
  }
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function blockOutput(
  action: string,
  ticket: string,
  ownerSession: string | null,
  heartbeatAgeMin: number | null,
  reclaimable: boolean,
  message: string
): ClaimOutput {
  return {
    verdict: "BLOCK",
    action,
    ticket,
    owner_session: ownerSession,
    heartbeat_age_min: heartbeatAgeMin,
    reclaimable,
    message,
  };
}

function passOutput(
  action: string,
  ticket: string,
  ownerSession: string | null,
  heartbeatAgeMin: number | null,
  reclaimable: boolean,
  message: string
): ClaimOutput {
  return {
    verdict: "PASS",
    action,
    ticket,
    owner_session: ownerSession,
    heartbeat_age_min: heartbeatAgeMin,
    reclaimable,
    message,
  };
}

function normalizeInput(raw: ClaimInput): { ok: true; input: NormalizedInput } | { ok: false; output: ClaimOutput } {
  const action = cleanString(raw.action);
  const ticket = cleanString(raw.ticket);
  const session = cleanString(raw.session);

  if (!action) {
    return {
      ok: false,
      output: blockOutput(
        "invalid",
        ticket ?? "",
        null,
        null,
        false,
        "WHAT: required field action is missing. HOW: pass JSON {action,ticket,session} with action one of check|claim|heartbeat|release|complete."
      ),
    };
  }
  if (!["check", "claim", "heartbeat", "release", "complete"].includes(action)) {
    return {
      ok: false,
      output: blockOutput(
        action,
        ticket ?? "",
        null,
        null,
        false,
        "WHAT: unsupported action '" + action + "'. HOW: use one of check|claim|heartbeat|release|complete."
      ),
    };
  }
  if (!ticket) {
    return {
      ok: false,
      output: blockOutput(
        action,
        "",
        null,
        null,
        false,
        "WHAT: required field ticket is missing. HOW: pass the Linear issue identifier, for example XOS-25."
      ),
    };
  }
  if (!session) {
    return {
      ok: false,
      output: blockOutput(
        action,
        ticket,
        null,
        null,
        false,
        "WHAT: required field session is missing. HOW: pass a stable session id before checking or claiming the ticket."
      ),
    };
  }

  return {
    ok: true,
    input: {
      action: action as Action,
      ticket,
      session,
      branch: cleanString(raw.branch),
      host: cleanString(raw.host),
      worktree: cleanString(raw.worktree),
      summary: cleanString(raw.summary),
      findings: cleanString(raw.findings),
      pr_url: cleanString(raw.pr_url),
    },
  };
}

function requireLinearApiKey(env: Record<string, string | undefined>): string {
  const apiKey = env["LINEAR_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("WHAT: LINEAR_API_KEY is unset. HOW: " + LINEAR_KEY_REMEDIATION);
  }
  return apiKey;
}

class LinearClient {
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;

  constructor(apiKey: string, fetchFn: FetchLike) {
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  private async request<T>(operationName: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await this.fetchFn(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ operationName, query, variables }),
    });

    const text = await response.text();
    let payload: { data?: T; errors?: Array<{ message?: string }> };
    try {
      payload = JSON.parse(text) as { data?: T; errors?: Array<{ message?: string }> };
    } catch (err) {
      throw new Error("Linear returned non-JSON response for " + operationName + ": " + String(err));
    }

    if (!response.ok || payload.errors?.length) {
      const graphErr = payload.errors?.map((e) => e.message ?? JSON.stringify(e)).join("; ");
      throw new Error("Linear GraphQL " + operationName + " failed: " + (graphErr || response.status + " " + response.statusText));
    }
    if (!payload.data) {
      throw new Error("Linear GraphQL " + operationName + " returned no data.");
    }
    return payload.data;
  }

  async issueByIdentifier(identifier: string): Promise<LinearIssue> {
    const query = `
      query IssueByIdentifier($identifier: String!, $after: String) {
        issue(id: $identifier) {
          id
          identifier
          state { id name }
          team { states { nodes { id name } } }
          comments(first: 100, after: $after) {
            nodes { id body createdAt updatedAt }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;

    const comments: LinearComment[] = [];
    let issueCore: Omit<LinearIssue, "comments"> | null = null;
    let after: string | null = null;

    do {
      const data = await this.request<{
        issue: (Omit<LinearIssue, "comments"> & {
          comments: {
            nodes: LinearComment[];
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          };
        }) | null;
      }>("IssueByIdentifier", query, { identifier, after });

      if (!data.issue) {
        throw new Error(
          "WHAT: Linear issue " +
            identifier +
            " was not found. HOW: create or identify the Linear ticket before running the SDLC pipeline."
        );
      }

      issueCore = {
        id: data.issue.id,
        identifier: data.issue.identifier,
        state: data.issue.state,
        team: data.issue.team,
      };
      comments.push(...(data.issue.comments.nodes ?? []));
      after = data.issue.comments.pageInfo?.hasNextPage ? data.issue.comments.pageInfo.endCursor ?? null : null;
    } while (after);

    return { ...issueCore, comments };
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const issue = await this.issueByIdentifier(issueId);
    if (issue.state?.name === stateName) return;
    const state = issue.team?.states?.nodes?.find((s) => s.name === stateName);
    if (!state) {
      throw new Error(
        "WHAT: Linear issue " +
          (issue.identifier ?? issue.id) +
          " has no workflow state named " +
          stateName +
          ". HOW: add that state in Linear or intentionally update the sdlc-work-claim state name."
      );
    }

    const query = `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id state { id name } }
        }
      }
    `;
    const data = await this.request<{ issueUpdate: { success: boolean } }>("IssueUpdate", query, {
      id: issue.id,
      input: { stateId: state.id },
    });
    if (!data.issueUpdate.success) {
      throw new Error("WHAT: Linear did not move issue " + issue.id + " to " + stateName + ". HOW: retry after checking Linear permissions.");
    }
  }

  async createComment(issueId: string, body: string): Promise<LinearComment> {
    const query = `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id body createdAt updatedAt }
        }
      }
    `;
    const data = await this.request<{ commentCreate: { success: boolean; comment: LinearComment } }>("CommentCreate", query, {
      input: { issueId, body },
    });
    if (!data.commentCreate.success) {
      throw new Error("WHAT: Linear did not create the SDLC claim comment. HOW: retry after checking Linear comment permissions.");
    }
    return data.commentCreate.comment;
  }

  async updateComment(commentId: string, body: string): Promise<LinearComment> {
    const query = `
      mutation CommentUpdate($id: String!, $input: CommentUpdateInput!) {
        commentUpdate(id: $id, input: $input) {
          success
          comment { id body createdAt updatedAt }
        }
      }
    `;
    const data = await this.request<{ commentUpdate: { success: boolean; comment: LinearComment } }>("CommentUpdate", query, {
      id: commentId,
      input: { body },
    });
    if (!data.commentUpdate.success) {
      throw new Error("WHAT: Linear did not update the SDLC claim comment. HOW: retry after checking Linear comment permissions.");
    }
    return data.commentUpdate.comment;
  }
}

function parseClaimBody(body: string): ParsedClaim | null {
  if (!body.startsWith(CLAIM_PREFIX)) return null;
  const re =
    /^🤖 SDLC-CLAIM session=(.*?) host=(.*?) branch=(.*?) worktree=(.*?) started=(.*?) heartbeat=(\S+)\s*$/u;
  const match = body.match(re);
  if (!match) return null;
  return {
    session: match[1],
    host: match[2],
    branch: match[3],
    worktree: match[4],
    started: match[5],
    heartbeat: match[6],
  };
}

function activeClaimComments(issue: LinearIssue): ClaimComment[] {
  return issue.comments
    .map((comment) => {
      const claim = parseClaimBody(comment.body);
      return claim ? { comment, claim } : null;
    })
    .filter((value): value is ClaimComment => value !== null);
}

function sortedClaimComments(issue: LinearIssue): ClaimComment[] {
  return activeClaimComments(issue).sort((a, b) => {
    const aCreated = Date.parse(a.comment.createdAt ?? a.claim.started);
    const bCreated = Date.parse(b.comment.createdAt ?? b.claim.started);
    if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) return aCreated - bCreated;
    return a.comment.id.localeCompare(b.comment.id);
  });
}

function canonicalClaim(issue: LinearIssue): ClaimComment | null {
  return sortedClaimComments(issue)[0] ?? null;
}

function heartbeatAgeMin(claim: ParsedClaim | null, now: Date): number | null {
  if (!claim) return null;
  const heartbeatMs = Date.parse(claim.heartbeat);
  if (!Number.isFinite(heartbeatMs)) return STALE_MIN;
  return Math.max(0, Math.floor((now.getTime() - heartbeatMs) / 60000));
}

function isLive(claim: ParsedClaim | null, now: Date): boolean {
  const age = heartbeatAgeMin(claim, now);
  return age !== null && age < STALE_MIN;
}

function isHeldByDifferentLiveSession(issue: LinearIssue, session: string, now: Date): ClaimComment | null {
  if (issue.state?.name !== IN_PROGRESS_STATE) return null;
  const current = canonicalClaim(issue);
  if (!current) return null;
  if (current.claim.session === session) return null;
  return isLive(current.claim, now) ? current : null;
}

function ownerLabel(claim: ParsedClaim): string {
  return claim.session + " host=" + claim.host + " branch=" + claim.branch;
}

function claimBody(input: NormalizedInput, started: string, heartbeat: string): string {
  return (
    CLAIM_PREFIX +
    " session=" +
    input.session +
    " host=" +
    (input.host ?? "") +
    " branch=" +
    (input.branch ?? "") +
    " worktree=" +
    (input.worktree ?? "") +
    " started=" +
    started +
    " heartbeat=" +
    heartbeat
  );
}

function safeMarkerName(session: string): string {
  return session.replace(/[^A-Za-z0-9_.-]/g, "_") + ".json";
}

function activeMarkerDir(options: ProcessOptions): string {
  return join(options.homeDir ?? homedir(), ".ship-feature", "active");
}

function activeMarkerPath(input: NormalizedInput, options: ProcessOptions): string {
  return join(activeMarkerDir(options), safeMarkerName(input.session));
}

function writeActiveMarker(input: NormalizedInput, started: string, options: ProcessOptions): void {
  const dir = activeMarkerDir(options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    activeMarkerPath(input, options),
    JSON.stringify(
      {
        ticket: input.ticket,
        session: input.session,
        branch: input.branch ?? "",
        started,
      },
      null,
      2
    ) + "\n"
  );
}

function removeActiveMarker(input: NormalizedInput, options: ProcessOptions): void {
  rmSync(activeMarkerPath(input, options), { force: true });
}

function releasedBody(original: string, input: NormalizedInput, now: Date): string {
  return "RELEASED: " + original + " released_by=" + input.session + " released=" + isoNow(now);
}

function completedBody(input: NormalizedInput): string {
  return (
    "✅ Completed by session " +
    input.session +
    " on " +
    (input.host ?? "") +
    ". Fixed: " +
    (input.summary ?? "") +
    ". PR: " +
    (input.pr_url ?? "") +
    ". Findings: " +
    (input.findings ?? "") +
    "."
  );
}

async function neutralizeDuplicateClaims(client: LinearClient, issue: LinearIssue, keepId: string, input: NormalizedInput, now: Date): Promise<void> {
  for (const claim of sortedClaimComments(issue)) {
    if (claim.comment.id === keepId) continue;
    await client.updateComment(claim.comment.id, releasedBody(claim.comment.body, input, now));
  }
}

async function checkClaim(client: LinearClient, input: NormalizedInput, now: Date): Promise<ClaimOutput> {
  const issue = await client.issueByIdentifier(input.ticket);
  const current = canonicalClaim(issue);
  const age = heartbeatAgeMin(current?.claim ?? null, now);
  const stale = Boolean(current && !isLive(current.claim, now));
  const held = issue.state?.name === IN_PROGRESS_STATE && current;

  if (held && current.claim.session !== input.session && isLive(current.claim, now)) {
    return blockOutput(
      input.action,
      input.ticket,
      current.claim.session,
      age,
      false,
      "WHAT: ticket " +
        input.ticket +
        " is claimed by live session " +
        ownerLabel(current.claim) +
        " with heartbeat age " +
        age +
        "min. HOW: pick another ticket; or if you confirm it's dead — no new commits on its branch — reclaim with action=claim."
    );
  }

  if (current && stale) {
    return passOutput(
      input.action,
      input.ticket,
      current.claim.session,
      age,
      true,
      "PASS: reclaimable: stale claim by " + current.claim.session + " (" + age + "min). Confirm no new commits on its branch, then reclaim with action=claim."
    );
  }

  if (held && current.claim.session === input.session) {
    return passOutput(
      input.action,
      input.ticket,
      input.session,
      age,
      false,
      "PASS: ticket " + input.ticket + " is claimed by this session with heartbeat age " + age + "min."
    );
  }

  if (current && issue.state?.name !== IN_PROGRESS_STATE) {
    return passOutput(
      input.action,
      input.ticket,
      current.claim.session,
      age,
      false,
      "PASS: claim marker exists, but Linear state is '" + (issue.state?.name ?? "none") + "', not In Progress; the ticket is not actively claimed by the SDLC rule."
    );
  }

  return passOutput(input.action, input.ticket, null, null, false, "PASS: ticket " + input.ticket + " is unclaimed and available.");
}

async function claimTicket(client: LinearClient, input: NormalizedInput, now: Date, options: ProcessOptions): Promise<ClaimOutput> {
  const initial = await client.issueByIdentifier(input.ticket);
  const liveOther = isHeldByDifferentLiveSession(initial, input.session, now);
  if (liveOther) {
    const age = heartbeatAgeMin(liveOther.claim, now);
    return blockOutput(
      input.action,
      input.ticket,
      liveOther.claim.session,
      age,
      false,
      "WHAT: ticket " +
        input.ticket +
        " is claimed by live session " +
        ownerLabel(liveOther.claim) +
        " with heartbeat age " +
        age +
        "min. HOW: pick another ticket; or if you confirm it's dead — no new commits on its branch — reclaim with action=claim."
    );
  }

  const missing = ["branch", "host", "worktree"].filter((key) => !input[key as "branch" | "host" | "worktree"]);
  if (missing.length > 0) {
    return blockOutput(
      input.action,
      input.ticket,
      canonicalClaim(initial)?.claim.session ?? null,
      heartbeatAgeMin(canonicalClaim(initial)?.claim ?? null, now),
      false,
      "WHAT: cannot claim ticket " +
        input.ticket +
        " because " +
        missing.join(", ") +
        " " +
        (missing.length === 1 ? "is" : "are") +
        " missing. HOW: pass branch, host, and worktree in the JSON payload before starting the SDLC pipeline."
    );
  }

  const guard = await client.issueByIdentifier(input.ticket);
  const guardOther = isHeldByDifferentLiveSession(guard, input.session, now);
  if (guardOther) {
    const age = heartbeatAgeMin(guardOther.claim, now);
    return blockOutput(
      input.action,
      input.ticket,
      guardOther.claim.session,
      age,
      false,
      "WHAT: lost the cross-machine claim race for " +
        input.ticket +
        " to " +
        ownerLabel(guardOther.claim) +
        " with heartbeat age " +
        age +
        "min. HOW: stop this pipeline and pick another ticket; do not steal a live claim."
    );
  }

  await client.updateIssueState(guard.id, IN_PROGRESS_STATE);

  const beforeWrite = await client.issueByIdentifier(input.ticket);
  const beforeWriteOther = isHeldByDifferentLiveSession(beforeWrite, input.session, now);
  if (beforeWriteOther) {
    const age = heartbeatAgeMin(beforeWriteOther.claim, now);
    return blockOutput(
      input.action,
      input.ticket,
      beforeWriteOther.claim.session,
      age,
      false,
      "WHAT: lost the cross-machine claim race for " +
        input.ticket +
        " to " +
        ownerLabel(beforeWriteOther.claim) +
        " with heartbeat age " +
        age +
        "min. HOW: stop this pipeline and pick another ticket; do not steal a live claim."
    );
  }

  const existing = canonicalClaim(beforeWrite);
  const existingAge = heartbeatAgeMin(existing?.claim ?? null, now);
  const started = existing?.claim.session === input.session ? existing.claim.started : isoNow(now);
  const body = claimBody(input, started, isoNow(now));
  if (existing) {
    await client.updateComment(existing.comment.id, body);
  } else {
    await client.createComment(beforeWrite.id, body);
  }

  const finalIssue = await client.issueByIdentifier(input.ticket);
  const finalClaim = canonicalClaim(finalIssue);
  if (!finalClaim) {
    return blockOutput(
      input.action,
      input.ticket,
      null,
      null,
      false,
      "WHAT: Linear did not contain an active SDLC-CLAIM comment after claim write. HOW: retry claim; if it repeats, inspect Linear comments and API permissions."
    );
  }

  await neutralizeDuplicateClaims(client, finalIssue, finalClaim.comment.id, input, now);

  const finalAge = heartbeatAgeMin(finalClaim.claim, now);
  if (finalClaim.claim.session !== input.session && isLive(finalClaim.claim, now)) {
    return blockOutput(
      input.action,
      input.ticket,
      finalClaim.claim.session,
      finalAge,
      false,
      "WHAT: lost the cross-machine claim race for " +
        input.ticket +
        " to " +
        ownerLabel(finalClaim.claim) +
        " with heartbeat age " +
        finalAge +
        "min. HOW: stop this pipeline and pick another ticket; do not steal a live claim."
    );
  }

  const reclaimed =
    existing && existing.claim.session !== input.session && existingAge !== null && existingAge >= STALE_MIN
      ? " Previous stale claim by " + existing.claim.session + " (" + existingAge + "min) was reclaimed."
      : "";
  writeActiveMarker(input, finalClaim.claim.started, options);
  return passOutput(input.action, input.ticket, input.session, 0, false, "PASS: ticket " + input.ticket + " is claimed by this session." + reclaimed);
}

async function heartbeatTicket(client: LinearClient, input: NormalizedInput, now: Date): Promise<ClaimOutput> {
  const issue = await client.issueByIdentifier(input.ticket);
  const current = canonicalClaim(issue);
  const age = heartbeatAgeMin(current?.claim ?? null, now);
  const heldByThis = issue.state?.name === IN_PROGRESS_STATE && current?.claim.session === input.session;
  if (!current || !heldByThis) {
    return passOutput(
      input.action,
      input.ticket,
      current?.claim.session ?? null,
      age,
      Boolean(current && !isLive(current.claim, now)),
      current
        ? "WARN: heartbeat not updated because ticket " + input.ticket + " is held by " + ownerLabel(current.claim) + ", not session " + input.session + ". Run claim first if reclaimable."
        : "WARN: heartbeat not updated because ticket " + input.ticket + " has no SDLC-CLAIM comment. Run claim before heartbeat."
    );
  }

  await client.updateComment(current.comment.id, claimBody(input, current.claim.started, isoNow(now)));
  return passOutput(input.action, input.ticket, input.session, 0, false, "PASS: heartbeat refreshed for ticket " + input.ticket + ".");
}

async function releaseTicket(client: LinearClient, input: NormalizedInput, now: Date, options: ProcessOptions): Promise<ClaimOutput> {
  const issue = await client.issueByIdentifier(input.ticket);
  const claims = sortedClaimComments(issue);
  const current = claims[0] ?? null;
  const age = heartbeatAgeMin(current?.claim ?? null, now);
  if (!current) {
    removeActiveMarker(input, options);
    return passOutput(input.action, input.ticket, null, null, false, "PASS: ticket " + input.ticket + " had no active SDLC-CLAIM comment to release.");
  }

  const releasable = claims.filter((claim) => claim.claim.session === input.session || !isLive(claim.claim, now));
  const liveOther = claims.find((claim) => claim.claim.session !== input.session && isLive(claim.claim, now));
  if (liveOther && releasable.length === 0) {
    const otherAge = heartbeatAgeMin(liveOther.claim, now);
    return blockOutput(
      input.action,
      input.ticket,
      liveOther.claim.session,
      otherAge,
      false,
      "WHAT: ticket " +
        input.ticket +
        " is claimed by live session " +
        ownerLabel(liveOther.claim) +
        " with heartbeat age " +
        otherAge +
        "min, so session " +
        input.session +
        " cannot release it. HOW: ask the owner to release it, or wait until the heartbeat is stale."
    );
  }

  for (const claim of releasable) {
    await client.updateComment(claim.comment.id, releasedBody(claim.comment.body, input, now));
  }

  const releasedOwner = releasable[0]?.claim.session ?? current.claim.session;
  removeActiveMarker(input, options);
  return passOutput(
    input.action,
    input.ticket,
    releasedOwner,
    age,
    false,
    releasedOwner === input.session
      ? "PASS: released SDLC claim for ticket " + input.ticket + " held by this session."
      : "PASS: released stale SDLC claim for ticket " + input.ticket + " held by " + releasedOwner + "."
  );
}

async function completeTicket(client: LinearClient, input: NormalizedInput, options: ProcessOptions): Promise<ClaimOutput> {
  const missing = ["host", "summary"].filter((key) => !input[key as "host" | "summary"]);
  if (missing.length > 0) {
    return blockOutput(
      input.action,
      input.ticket,
      null,
      null,
      false,
      "WHAT: cannot complete ticket " +
        input.ticket +
        " because " +
        missing.join(", ") +
        " " +
        (missing.length === 1 ? "is" : "are") +
        " missing. HOW: pass host and summary in the JSON payload when closing the SDLC pipeline."
    );
  }

  const issue = await client.issueByIdentifier(input.ticket);
  await client.createComment(issue.id, completedBody(input));
  await client.updateIssueState(issue.id, DONE_STATE);
  removeActiveMarker(input, options);
  return passOutput(input.action, input.ticket, input.session, null, false, "PASS: completed ticket " + input.ticket + " and moved it to Done.");
}

export async function processInput(raw: ClaimInput, options: ProcessOptions = {}): Promise<ClaimOutput> {
  const normalized = normalizeInput(raw);
  if (!normalized.ok) return normalized.output;

  try {
    const apiKey = requireLinearApiKey(options.env ?? process.env);
    const client = new LinearClient(apiKey, options.fetch ?? fetch);
    const now = options.now ?? new Date();
    const input = normalized.input;

    if (input.action === "check") return await checkClaim(client, input, now);
    if (input.action === "claim") return await claimTicket(client, input, now, options);
    if (input.action === "heartbeat") return await heartbeatTicket(client, input, now);
    if (input.action === "release") return await releaseTicket(client, input, now, options);
    return await completeTicket(client, input, options);
  } catch (err) {
    return blockOutput(
      normalized.input.action,
      normalized.input.ticket,
      null,
      null,
      false,
      String(err instanceof Error ? err.message : err) +
        (String(err).includes("HOW:") ? "" : " HOW: fix the Linear issue, API key, network, or permission problem named here, then retry.")
    );
  }
}

function emit(output: ClaimOutput): void {
  process.stdout.write(JSON.stringify(output) + "\n");
}

function exitFor(output: ClaimOutput, mode: string): never {
  log({
    mode,
    action: output.action,
    ticket: output.ticket,
    verdict: output.verdict,
    owner_session: output.owner_session,
    heartbeat_age_min: output.heartbeat_age_min,
    reclaimable: output.reclaimable,
  });
  emit(output);
  if (output.verdict === "BLOCK") process.stderr.write(output.message + "\n");
  process.exit(output.verdict === "BLOCK" ? 1 : 0);
}

async function runDirect(argRaw: string): Promise<void> {
  let raw: ClaimInput;
  try {
    raw = JSON.parse(argRaw) as ClaimInput;
  } catch (err) {
    exitFor(
      blockOutput(
        "invalid",
        "",
        null,
        null,
        false,
        "WHAT: argv[2] is not valid JSON. HOW: pass JSON {action,ticket,session,branch?,host?,worktree?}; parser error: " + String(err)
      ),
      "direct"
    );
  }

  exitFor(await processInput(raw), "direct");
}

async function runPreToolUse(): Promise<void> {
  const raw = process.stdin.isTTY ? "" : await Bun.stdin.text();
  if (!raw) return;

  let payload: HookPayload | ClaimInput;
  try {
    payload = JSON.parse(raw) as HookPayload | ClaimInput;
  } catch {
    log({ mode: "pretooluse", skip: "invalid-json" });
    return;
  }

  const hookInput =
    "tool_input" in payload && payload.tool_input && typeof payload.tool_input === "object"
      ? (payload.tool_input as ClaimInput)
      : (payload as ClaimInput);

  if (!("action" in hookInput) && !("ticket" in hookInput) && !("session" in hookInput)) return;
  exitFor(await processInput(hookInput), "pretooluse");
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  if (argVal && argVal !== "-") {
    await runDirect(argVal);
    return;
  }
  await runPreToolUse();
}

if (import.meta.main) {
  main().catch((err) => {
    const output = blockOutput(
      "error",
      "",
      null,
      null,
      false,
      "WHAT: sdlc-work-claim crashed before it could enforce the claim. HOW: fix this handler/runtime error before continuing SDLC work: " + String(err)
    );
    log({ mode: "error", verdict: output.verdict, error: String(err) });
    emit(output);
    process.stderr.write(output.message + "\n");
    process.exit(1);
  });
}
