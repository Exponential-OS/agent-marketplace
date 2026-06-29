/**
 * linear-bus.ts - Linear GraphQL pull adapter for work-kernel.
 *
 * Uses the Linear GraphQL API directly. If LINEAR_API_KEY is unset or the
 * network/API response fails, all operations fail open: they return a WARN/error
 * result and do not throw, preserving hook prompt safety.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve as resolvePath, sep } from "node:path";

const WARN_PREFIX = "[work-kernel][linear] WARN";
const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const DEFAULT_LINEAR_TEAM = "";
const DEFAULT_LINEAR_PROJECT: string | null = null;
const CONFIG_CACHE_KEY = "linear_config_cache";
const CONFIG_CACHE_VERSION = 1;

type Env = Record<string, string | undefined>;

export interface LinearConfig {
  apiKey: string | null;
  teamName: string;
  projectName: string | null;
  endpoint?: string;
}

export interface LinearUser {
  id?: string;
  name?: string;
  email?: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url?: string;
  priority?: number;
  priorityLabel?: string;
  createdAt?: string;
  updatedAt?: string;
  state?: {
    name?: string;
    type?: string;
  };
  team?: {
    name?: string;
    key?: string;
  };
  assignee?: LinearUser;
  creator?: LinearUser;
}

export interface LinearIssueSummary {
  id: string;
  identifier: string;
  title: string;
  url?: string;
}

export interface LinearComment {
  id: string;
  body: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  user?: LinearUser;
  issue: LinearIssueSummary;
  source: "assigned" | "owned" | "assigned+owned";
}

export interface LinearBusDelta {
  since: string;
  queriedAt: string;
  teamName: string;
  projectName?: string | null;
  viewer?: LinearUser;
  assignedIssues: LinearIssue[];
  recentComments: LinearComment[];
  urgentIssues: LinearIssue[];
}

export interface LinearBusResult {
  ok: boolean;
  delta?: LinearBusDelta;
  err?: string;
  warn?: string;
}

export interface LinearIssuesResult {
  ok: boolean;
  issues?: LinearIssue[];
  err?: string;
  warn?: string;
}

export interface LinearCommentsResult {
  ok: boolean;
  comments?: LinearComment[];
  err?: string;
  warn?: string;
}

type LinearGraphqlResult<T> =
  | { ok: true; data: T }
  | { ok: false; err: string; warn?: string };

interface LinearConnection<T> {
  nodes?: T[];
}

interface RawLinearUser {
  id?: unknown;
  name?: unknown;
  email?: unknown;
}

interface RawLinearIssue {
  id?: unknown;
  identifier?: unknown;
  title?: unknown;
  url?: unknown;
  priority?: unknown;
  priorityLabel?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  state?: unknown;
  team?: unknown;
  assignee?: unknown;
  creator?: unknown;
  comments?: LinearConnection<RawLinearComment>;
}

interface RawLinearComment {
  id?: unknown;
  body?: unknown;
  url?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  user?: unknown;
}

interface LinearBusGraphqlData {
  viewer?: RawLinearUser & {
    assignedIssues?: LinearConnection<RawLinearIssue>;
    assignedCommentIssues?: LinearConnection<RawLinearIssue>;
    ownedCommentIssues?: LinearConnection<RawLinearIssue>;
  };
  urgentIssues?: LinearConnection<RawLinearIssue>;
}

interface LinearWipGoalTarget {
  teamName: string;
  projectName: string | null;
}

interface LinearWipGoalRoute extends LinearWipGoalTarget {
  wip: string;
}

interface LinearWipGoalMap {
  default: LinearWipGoalTarget;
  routes: LinearWipGoalRoute[];
}

interface LinearWipGoalMapRead {
  map: LinearWipGoalMap;
  manifestPath: string;
}

interface LinearConfigCache {
  version: number;
  cwd: string;
  resolved: LinearWipGoalTarget;
  map?: LinearWipGoalMap;
  manifestPath?: string;
  cachedAt: string;
}

const ISSUE_FIELDS = `
fragment LinearBusIssueFields on Issue {
  id
  identifier
  title
  url
  priority
  priorityLabel
  createdAt
  updatedAt
  state {
    name
    type
  }
  team {
    name
    key
  }
  assignee {
    id
    name
    email
  }
  creator {
    id
    name
    email
  }
}`;

const COMMENT_ISSUE_FIELDS = `
fragment LinearBusCommentIssueFields on Issue {
  id
  identifier
  title
  url
  assignee {
    id
    name
    email
  }
  creator {
    id
    name
    email
  }
  comments(filter: { updatedAt: { gt: $since } }, first: 10, orderBy: updatedAt) {
    nodes {
      id
      body
      url
      createdAt
      updatedAt
      user {
        id
        name
        email
      }
    }
  }
}`;

export const LINEAR_BUS_QUERY = `
query LinearBusDelta($since: DateTimeOrDuration!, $teamName: String!) {
  viewer {
    id
    name
    email
    assignedIssues(filter: { updatedAt: { gt: $since } }, first: 25, orderBy: updatedAt) {
      nodes {
        ...LinearBusIssueFields
      }
    }
    assignedCommentIssues: assignedIssues(
      filter: { comments: { updatedAt: { gt: $since } } }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
    ownedCommentIssues: createdIssues(
      filter: { comments: { updatedAt: { gt: $since } } }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
  }
  urgentIssues: issues(
    filter: {
      createdAt: { gt: $since }
      priority: { eq: 1 }
      team: { name: { eq: $teamName } }
    }
    first: 25
    orderBy: createdAt
  ) {
    nodes {
      ...LinearBusIssueFields
    }
  }
}
${ISSUE_FIELDS}
${COMMENT_ISSUE_FIELDS}`;

const LINEAR_BUS_QUERY_WITH_PROJECT = `
query LinearBusDelta($since: DateTimeOrDuration!, $teamName: String!, $project: String!) {
  viewer {
    id
    name
    email
    assignedIssues(
      filter: {
        updatedAt: { gt: $since }
        project: { name: { eq: $project } }
      }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusIssueFields
      }
    }
    assignedCommentIssues: assignedIssues(
      filter: {
        comments: { updatedAt: { gt: $since } }
        project: { name: { eq: $project } }
      }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
    ownedCommentIssues: createdIssues(
      filter: {
        comments: { updatedAt: { gt: $since } }
        project: { name: { eq: $project } }
      }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
  }
  urgentIssues: issues(
    filter: {
      createdAt: { gt: $since }
      priority: { eq: 1 }
      team: { name: { eq: $teamName } }
      project: { name: { eq: $project } }
    }
    first: 25
    orderBy: createdAt
  ) {
    nodes {
      ...LinearBusIssueFields
    }
  }
}
${ISSUE_FIELDS}
${COMMENT_ISSUE_FIELDS}`;

const LINEAR_ASSIGNED_ISSUES_QUERY = `
query LinearViewerAssignedIssues($since: DateTimeOrDuration!) {
  viewer {
    assignedIssues(filter: { updatedAt: { gt: $since } }, first: 25, orderBy: updatedAt) {
      nodes {
        ...LinearBusIssueFields
      }
    }
  }
}
${ISSUE_FIELDS}`;

const LINEAR_ASSIGNED_ISSUES_QUERY_WITH_PROJECT = `
query LinearViewerAssignedIssues($since: DateTimeOrDuration!, $project: String!) {
  viewer {
    assignedIssues(
      filter: {
        updatedAt: { gt: $since }
        project: { name: { eq: $project } }
      }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusIssueFields
      }
    }
  }
}
${ISSUE_FIELDS}`;

const LINEAR_RECENT_COMMENTS_QUERY = `
query LinearRecentComments($since: DateTimeOrDuration!) {
  viewer {
    assignedCommentIssues: assignedIssues(
      filter: { comments: { updatedAt: { gt: $since } } }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
    ownedCommentIssues: createdIssues(
      filter: { comments: { updatedAt: { gt: $since } } }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
  }
}
${COMMENT_ISSUE_FIELDS}`;

const LINEAR_RECENT_COMMENTS_QUERY_WITH_PROJECT = `
query LinearRecentComments($since: DateTimeOrDuration!, $project: String!) {
  viewer {
    assignedCommentIssues: assignedIssues(
      filter: {
        comments: { updatedAt: { gt: $since } }
        project: { name: { eq: $project } }
      }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
    ownedCommentIssues: createdIssues(
      filter: {
        comments: { updatedAt: { gt: $since } }
        project: { name: { eq: $project } }
      }
      first: 25
      orderBy: updatedAt
    ) {
      nodes {
        ...LinearBusCommentIssueFields
      }
    }
  }
}
${COMMENT_ISSUE_FIELDS}`;

const LINEAR_URGENT_ISSUES_QUERY = `
query LinearUrgentIssues($since: DateTimeOrDuration!, $teamName: String!) {
  urgentIssues: issues(
    filter: {
      createdAt: { gt: $since }
      priority: { eq: 1 }
      team: { name: { eq: $teamName } }
    }
    first: 25
    orderBy: createdAt
  ) {
    nodes {
      ...LinearBusIssueFields
    }
  }
}
${ISSUE_FIELDS}`;

const LINEAR_URGENT_ISSUES_QUERY_WITH_PROJECT = `
query LinearUrgentIssues($since: DateTimeOrDuration!, $teamName: String!, $project: String!) {
  urgentIssues: issues(
    filter: {
      createdAt: { gt: $since }
      priority: { eq: 1 }
      team: { name: { eq: $teamName } }
      project: { name: { eq: $project } }
    }
    first: 25
    orderBy: createdAt
  ) {
    nodes {
      ...LinearBusIssueFields
    }
  }
}
${ISSUE_FIELDS}`;

/**
 * resolveLinearConfig - resolves Linear auth and filters from env or workspace WIP map.
 * LINEAR_TEAM/LINEAR_PROJECT are explicit overrides. Without them, the resolver
 * reads ~/.codialectic/context.json -> workspace_root -> workspace.manifest.yaml.
 */
export function resolveLinearConfig(
  env: Env = process.env,
  cwd: string = process.cwd(),
  statePath?: string,
): LinearConfig {
  const apiKey = env.LINEAR_API_KEY?.trim() || null;
  const envTeam = env.LINEAR_TEAM?.trim();
  const envProject = env.LINEAR_PROJECT?.trim();

  if (envTeam || envProject) {
    return {
      apiKey,
      teamName: envTeam || DEFAULT_LINEAR_TEAM,
      projectName: envProject || DEFAULT_LINEAR_PROJECT,
    };
  }

  const normalizedCwd = normalizePathForMatch(cwd, env);
  const cached = readLinearConfigCache(statePath);
  if (cached?.map) {
    const resolved = resolveWipGoalTarget(cached.map, normalizedCwd, env);
    if (
      cached.cwd !== normalizedCwd ||
      cached.resolved.teamName !== resolved.teamName ||
      cached.resolved.projectName !== resolved.projectName
    ) {
      writeLinearConfigCache(statePath, {
        ...cached,
        cwd: normalizedCwd,
        resolved,
        cachedAt: new Date().toISOString(),
      });
    }
    return { apiKey, ...resolved };
  }
  if (cached && cached.cwd === normalizedCwd) {
    return { apiKey, ...cached.resolved };
  }

  const readMap = readWorkspaceWipGoalMap(env);
  if (!readMap) {
    const resolved = genericLinearTarget();
    writeLinearConfigCache(statePath, {
      version: CONFIG_CACHE_VERSION,
      cwd: normalizedCwd,
      resolved,
      cachedAt: new Date().toISOString(),
    });
    return { apiKey, ...resolved };
  }

  const resolved = resolveWipGoalTarget(readMap.map, normalizedCwd, env);
  writeLinearConfigCache(statePath, {
    version: CONFIG_CACHE_VERSION,
    cwd: normalizedCwd,
    resolved,
    map: readMap.map,
    manifestPath: readMap.manifestPath,
    cachedAt: new Date().toISOString(),
  });
  return { apiKey, ...resolved };
}

function genericLinearTarget(): LinearWipGoalTarget {
  return { teamName: DEFAULT_LINEAR_TEAM, projectName: DEFAULT_LINEAR_PROJECT };
}

function readWorkspaceWipGoalMap(env: Env): LinearWipGoalMapRead | null {
  try {
    const contextPath = join(env.HOME || homedir(), ".codialectic", "context.json");
    const context = JSON.parse(readFileSync(contextPath, "utf8"));
    if (!isRecord(context) || typeof context.workspace_root !== "string") return null;

    const workspaceRoot = expandHomePath(context.workspace_root, env);
    const manifestPath = join(workspaceRoot, "workspace.manifest.yaml");
    const map = parseWipGoalMap(readFileSync(manifestPath, "utf8"));
    return map ? { map, manifestPath } : null;
  } catch {
    return null;
  }
}

function parseWipGoalMap(content: string): LinearWipGoalMap | null {
  try {
    const lines = content.split(/\r?\n/);
    const startIndex = lines.findIndex((line) => /^\s*wip_goal_map\s*:/.test(line));
    if (startIndex < 0) return null;

    const baseIndent = leadingSpaces(lines[startIndex]);
    let defaultTarget: LinearWipGoalTarget | null = null;
    const routes: LinearWipGoalRoute[] = [];

    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      if (leadingSpaces(line) <= baseIndent && /^\S/.test(line)) break;

      if (/^\s*default\s*:/.test(line)) {
        const parsed = parseFlowObject(line);
        if (parsed) defaultTarget = flowTarget(parsed);
        continue;
      }

      if (/^\s*-\s*\{/.test(line)) {
        const parsed = parseFlowObject(line);
        const wip = typeof parsed?.wip === "string" ? parsed.wip.trim() : "";
        if (!parsed || !wip) continue;
        routes.push({ wip, ...flowTarget(parsed) });
      }
    }

    if (!defaultTarget) return null;
    return { default: defaultTarget, routes };
  } catch {
    return null;
  }
}

function parseFlowObject(line: string): Record<string, string | null> | null {
  const match = line.match(/\{([^}]*)\}/);
  if (!match) return null;

  const result: Record<string, string | null> = {};
  const pairRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(null|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,}]+)/g;
  let pair: RegExpExecArray | null;
  while ((pair = pairRe.exec(match[1])) !== null) {
    const key = pair[1];
    const rawValue = pair[2].trim();
    if (rawValue === "null") {
      result[key] = null;
    } else if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      result[key] = parseQuotedValue(rawValue);
    } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      result[key] = rawValue.slice(1, -1).replace(/\\'/g, "'");
    } else {
      result[key] = rawValue.trim();
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function parseQuotedValue(value: string): string {
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(1, -1);
  }
}

function flowTarget(values: Record<string, string | null>): LinearWipGoalTarget {
  return {
    teamName: flowString(values.team) || DEFAULT_LINEAR_TEAM,
    projectName: flowProject(values.project),
  };
}

function flowString(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function flowProject(value: string | null | undefined): string | null {
  const project = flowString(value);
  return project || null;
}

function resolveWipGoalTarget(
  map: LinearWipGoalMap,
  normalizedCwd: string,
  env: Env,
): LinearWipGoalTarget {
  let bestRoute: LinearWipGoalRoute | null = null;
  let bestLength = -1;

  for (const route of map.routes) {
    const routePath = normalizePathForMatch(route.wip, env);
    if (isPathPrefix(routePath, normalizedCwd) && routePath.length > bestLength) {
      bestRoute = route;
      bestLength = routePath.length;
    }
  }

  if (!bestRoute) return map.default;
  return { teamName: bestRoute.teamName, projectName: bestRoute.projectName };
}

function isPathPrefix(prefix: string, value: string): boolean {
  return value === prefix || value.startsWith(prefix + sep);
}

function normalizePathForMatch(value: string, env: Env): string {
  try {
    return stripTrailingSep(normalize(resolvePath(expandHomePath(value || process.cwd(), env))));
  } catch {
    return stripTrailingSep(normalize(resolvePath(process.cwd())));
  }
}

function expandHomePath(value: string, env: Env): string {
  const home = env.HOME || homedir();
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

function stripTrailingSep(value: string): string {
  let result = value;
  while (result.length > 1 && result.endsWith(sep)) {
    result = result.slice(0, -1);
  }
  return result;
}

function leadingSpaces(value: string): number {
  return value.match(/^ */)?.[0].length ?? 0;
}

function readLinearConfigCache(statePath: string | undefined): LinearConfigCache | null {
  if (!statePath) return null;
  try {
    if (!existsSync(statePath)) return null;
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (!isRecord(state)) return null;
    const cache = state[CONFIG_CACHE_KEY];
    if (!isRecord(cache) || cache.version !== CONFIG_CACHE_VERSION) return null;
    const resolved = parseCachedTarget(cache.resolved);
    if (!resolved || typeof cache.cwd !== "string") return null;

    return {
      version: CONFIG_CACHE_VERSION,
      cwd: cache.cwd,
      resolved,
      map: parseCachedMap(cache.map),
      manifestPath: typeof cache.manifestPath === "string" ? cache.manifestPath : undefined,
      cachedAt: typeof cache.cachedAt === "string" ? cache.cachedAt : "",
    };
  } catch {
    return null;
  }
}

function parseCachedTarget(value: unknown): LinearWipGoalTarget | null {
  if (!isRecord(value)) return null;
  const teamName = typeof value.teamName === "string" ? value.teamName : DEFAULT_LINEAR_TEAM;
  const projectName =
    typeof value.projectName === "string" && value.projectName.trim()
      ? value.projectName
      : null;
  return { teamName, projectName };
}

function parseCachedMap(value: unknown): LinearWipGoalMap | undefined {
  if (!isRecord(value)) return undefined;
  const defaultTarget = parseCachedTarget(value.default);
  if (!defaultTarget || !Array.isArray(value.routes)) return undefined;

  const routes: LinearWipGoalRoute[] = [];
  for (const route of value.routes) {
    if (!isRecord(route) || typeof route.wip !== "string" || !route.wip.trim()) continue;
    const target = parseCachedTarget(route);
    if (!target) continue;
    routes.push({ wip: route.wip, ...target });
  }

  return { default: defaultTarget, routes };
}

function writeLinearConfigCache(statePath: string | undefined, cache: LinearConfigCache): void {
  if (!statePath) return;
  try {
    const state = readStateRecord(statePath);
    state[CONFIG_CACHE_KEY] = cache;
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {
    // Fail-safe: config cache persistence must never affect prompt execution.
  }
}

function readStateRecord(statePath: string): Record<string, unknown> {
  try {
    if (!existsSync(statePath)) return {};
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function hasLinearDelta(delta: LinearBusDelta): boolean {
  return (
    delta.assignedIssues.length > 0 ||
    delta.recentComments.length > 0 ||
    delta.urgentIssues.length > 0
  );
}

export function getLinearBusHighWatermark(delta: LinearBusDelta): string | null {
  const dates: string[] = [];
  for (const issue of delta.assignedIssues) {
    if (issue.updatedAt) dates.push(issue.updatedAt);
    if (issue.createdAt) dates.push(issue.createdAt);
  }
  for (const comment of delta.recentComments) {
    if (comment.updatedAt) dates.push(comment.updatedAt);
    if (comment.createdAt) dates.push(comment.createdAt);
  }
  for (const issue of delta.urgentIssues) {
    if (issue.createdAt) dates.push(issue.createdAt);
    if (issue.updatedAt) dates.push(issue.updatedAt);
  }

  let max = 0;
  for (const value of dates) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed) && parsed > max) max = parsed;
  }
  return max > 0 ? new Date(max).toISOString() : null;
}

/**
 * queryLinearBusDelta - fetch the session bus delta in one GraphQL request.
 */
export async function queryLinearBusDelta(
  since: string,
  config: LinearConfig = resolveLinearConfig(),
): Promise<LinearBusResult> {
  if (!isValidTimestamp(since)) {
    return { ok: false, err: "Invalid since timestamp." };
  }

  if (!config.teamName) {
    return queryLinearBusDeltaWithoutTeam(since, config);
  }

  const projectName = resolvedProjectName(config);
  const result = await linearGraphql<LinearBusGraphqlData>(
    projectName ? LINEAR_BUS_QUERY_WITH_PROJECT : LINEAR_BUS_QUERY,
    withProjectVariable({ since, teamName: config.teamName }, projectName),
    config,
  );
  if (!result.ok) return { ok: false, err: result.err, warn: result.warn };

  return {
    ok: true,
    delta: normalizeBusDelta(result.data, since, config.teamName, projectName),
  };
}

async function queryLinearBusDeltaWithoutTeam(
  since: string,
  config: LinearConfig,
): Promise<LinearBusResult> {
  const [assignedResult, commentsResult] = await Promise.all([
    queryViewerAssignedIssues(since, config),
    queryRecentComments(since, config),
  ]);

  if (!assignedResult.ok) {
    return {
      ok: false,
      err: assignedResult.err ?? "Linear assigned issue query failed.",
      warn: assignedResult.warn,
    };
  }
  if (!commentsResult.ok) {
    return {
      ok: false,
      err: commentsResult.err ?? "Linear comments query failed.",
      warn: commentsResult.warn,
    };
  }

  return {
    ok: true,
    delta: {
      since,
      queriedAt: new Date().toISOString(),
      teamName: config.teamName,
      projectName: resolvedProjectName(config),
      assignedIssues: assignedResult.issues ?? [],
      recentComments: commentsResult.comments ?? [],
      urgentIssues: [],
    },
  };
}

/**
 * queryViewerAssignedIssues - fetch viewer assigned issues updated since timestamp.
 */
export async function queryViewerAssignedIssues(
  since: string,
  config: LinearConfig = resolveLinearConfig(),
): Promise<LinearIssuesResult> {
  if (!isValidTimestamp(since)) {
    return { ok: false, err: "Invalid since timestamp." };
  }

  const projectName = resolvedProjectName(config);
  const result = await linearGraphql<{ viewer?: { assignedIssues?: LinearConnection<RawLinearIssue> } }>(
    projectName ? LINEAR_ASSIGNED_ISSUES_QUERY_WITH_PROJECT : LINEAR_ASSIGNED_ISSUES_QUERY,
    withProjectVariable({ since }, projectName),
    config,
  );
  if (!result.ok) return { ok: false, err: result.err, warn: result.warn };

  return {
    ok: true,
    issues: sortIssues(nodes(result.data.viewer?.assignedIssues).map(mapIssue)),
  };
}

/**
 * queryRecentComments - fetch comments on viewer assigned or owned issues since timestamp.
 */
export async function queryRecentComments(
  since: string,
  config: LinearConfig = resolveLinearConfig(),
): Promise<LinearCommentsResult> {
  if (!isValidTimestamp(since)) {
    return { ok: false, err: "Invalid since timestamp." };
  }

  const projectName = resolvedProjectName(config);
  const result = await linearGraphql<{
    viewer?: {
      assignedCommentIssues?: LinearConnection<RawLinearIssue>;
      ownedCommentIssues?: LinearConnection<RawLinearIssue>;
    };
  }>(
    projectName ? LINEAR_RECENT_COMMENTS_QUERY_WITH_PROJECT : LINEAR_RECENT_COMMENTS_QUERY,
    withProjectVariable({ since }, projectName),
    config,
  );
  if (!result.ok) return { ok: false, err: result.err, warn: result.warn };

  return {
    ok: true,
    comments: sortComments(
      dedupeComments([
        ...commentsFromIssues(nodes(result.data.viewer?.assignedCommentIssues), "assigned"),
        ...commentsFromIssues(nodes(result.data.viewer?.ownedCommentIssues), "owned"),
      ]),
    ),
  };
}

/**
 * queryNewUrgentIssues - fetch new Urgent issues for the configured team since timestamp.
 * If no team is configured, the urgent sub-query is skipped.
 */
export async function queryNewUrgentIssues(
  since: string,
  config: LinearConfig = resolveLinearConfig(),
): Promise<LinearIssuesResult> {
  if (!isValidTimestamp(since)) {
    return { ok: false, err: "Invalid since timestamp." };
  }
  if (!config.teamName) {
    return { ok: true, issues: [] };
  }

  const projectName = resolvedProjectName(config);
  const result = await linearGraphql<{ urgentIssues?: LinearConnection<RawLinearIssue> }>(
    projectName ? LINEAR_URGENT_ISSUES_QUERY_WITH_PROJECT : LINEAR_URGENT_ISSUES_QUERY,
    withProjectVariable({ since, teamName: config.teamName }, projectName),
    config,
  );
  if (!result.ok) return { ok: false, err: result.err, warn: result.warn };

  return {
    ok: true,
    issues: sortIssues(nodes(result.data.urgentIssues).map(mapIssue)),
  };
}

function resolvedProjectName(config: LinearConfig): string | null {
  return config.projectName?.trim() || null;
}

function withProjectVariable(
  variables: Record<string, unknown>,
  projectName: string | null,
): Record<string, unknown> {
  return projectName ? { ...variables, project: projectName } : variables;
}

async function linearGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  config: LinearConfig,
): Promise<LinearGraphqlResult<T>> {
  if (!config.apiKey) {
    return {
      ok: false,
      err: "LINEAR_API_KEY env var is not set.",
      warn: `${WARN_PREFIX}: LINEAR_API_KEY is unset - Linear bus pull disabled.`,
    };
  }

  try {
    const response = await fetch(config.endpoint ?? LINEAR_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: config.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, err: "Linear GraphQL returned a non-JSON response." };
    }

    if (!isRecord(payload)) {
      return { ok: false, err: "Linear GraphQL returned an invalid response." };
    }

    const graphqlErrors = formatGraphqlErrors(payload.errors);
    if (!response.ok) {
      return {
        ok: false,
        err: graphqlErrors || `Linear GraphQL HTTP ${response.status}.`,
      };
    }
    if (graphqlErrors) {
      return { ok: false, err: graphqlErrors };
    }

    return { ok: true, data: (payload.data ?? {}) as T };
  } catch (e: unknown) {
    return {
      ok: false,
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

function normalizeBusDelta(
  data: LinearBusGraphqlData,
  since: string,
  teamName: string,
  projectName: string | null,
): LinearBusDelta {
  const assignedIssues = dedupeIssues(nodes(data.viewer?.assignedIssues).map(mapIssue));
  const recentComments = dedupeComments([
    ...commentsFromIssues(nodes(data.viewer?.assignedCommentIssues), "assigned"),
    ...commentsFromIssues(nodes(data.viewer?.ownedCommentIssues), "owned"),
  ]);
  const urgentIssues = dedupeIssues(nodes(data.urgentIssues).map(mapIssue));

  return {
    since,
    queriedAt: new Date().toISOString(),
    teamName,
    projectName,
    viewer: mapUser(data.viewer),
    assignedIssues: sortIssues(assignedIssues),
    recentComments: sortComments(recentComments),
    urgentIssues: sortIssues(urgentIssues),
  };
}

function commentsFromIssues(
  issues: RawLinearIssue[],
  source: "assigned" | "owned",
): LinearComment[] {
  const comments: LinearComment[] = [];
  for (const issue of issues) {
    const summary = mapIssueSummary(issue);
    for (const comment of nodes(issue.comments)) {
      comments.push(mapComment(comment, summary, source));
    }
  }
  return comments;
}

function mapIssue(raw: RawLinearIssue): LinearIssue {
  return {
    id: asString(raw.id),
    identifier: asString(raw.identifier),
    title: asString(raw.title),
    url: asOptionalString(raw.url),
    priority: asOptionalNumber(raw.priority),
    priorityLabel: asOptionalString(raw.priorityLabel),
    createdAt: asOptionalString(raw.createdAt),
    updatedAt: asOptionalString(raw.updatedAt),
    state: mapNamedType(raw.state),
    team: mapTeam(raw.team),
    assignee: mapUser(raw.assignee),
    creator: mapUser(raw.creator),
  };
}

function mapIssueSummary(raw: RawLinearIssue): LinearIssueSummary {
  return {
    id: asString(raw.id),
    identifier: asString(raw.identifier),
    title: asString(raw.title),
    url: asOptionalString(raw.url),
  };
}

function mapComment(
  raw: RawLinearComment,
  issue: LinearIssueSummary,
  source: "assigned" | "owned",
): LinearComment {
  return {
    id: asString(raw.id),
    body: asString(raw.body),
    url: asOptionalString(raw.url),
    createdAt: asOptionalString(raw.createdAt),
    updatedAt: asOptionalString(raw.updatedAt),
    user: mapUser(raw.user),
    issue,
    source,
  };
}

function mapUser(raw: unknown): LinearUser | undefined {
  if (!isRecord(raw)) return undefined;
  const user: LinearUser = {
    id: asOptionalString(raw.id),
    name: asOptionalString(raw.name),
    email: asOptionalString(raw.email),
  };
  return user.id || user.name || user.email ? user : undefined;
}

function mapNamedType(raw: unknown): LinearIssue["state"] | undefined {
  if (!isRecord(raw)) return undefined;
  const state = {
    name: asOptionalString(raw.name),
    type: asOptionalString(raw.type),
  };
  return state.name || state.type ? state : undefined;
}

function mapTeam(raw: unknown): LinearIssue["team"] | undefined {
  if (!isRecord(raw)) return undefined;
  const team = {
    name: asOptionalString(raw.name),
    key: asOptionalString(raw.key),
  };
  return team.name || team.key ? team : undefined;
}

function nodes<T>(connection: LinearConnection<T> | undefined): T[] {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

function dedupeIssues(issues: LinearIssue[]): LinearIssue[] {
  const seen = new Map<string, LinearIssue>();
  for (const issue of issues) {
    const key = issue.id || issue.identifier || issue.title;
    if (!seen.has(key)) seen.set(key, issue);
  }
  return [...seen.values()];
}

function dedupeComments(comments: LinearComment[]): LinearComment[] {
  const seen = new Map<string, LinearComment>();
  for (const comment of comments) {
    const key = comment.id || `${comment.issue.identifier}:${comment.body}:${comment.updatedAt}`;
    const existing = seen.get(key);
    if (existing) {
      if (existing.source !== comment.source) existing.source = "assigned+owned";
      continue;
    }
    seen.set(key, comment);
  }
  return [...seen.values()];
}

function sortIssues(issues: LinearIssue[]): LinearIssue[] {
  return [...issues].sort((a, b) => {
    return sortableTime(b.updatedAt ?? b.createdAt) - sortableTime(a.updatedAt ?? a.createdAt);
  });
}

function sortComments(comments: LinearComment[]): LinearComment[] {
  return [...comments].sort((a, b) => {
    return sortableTime(b.updatedAt ?? b.createdAt) - sortableTime(a.updatedAt ?? a.createdAt);
  });
}

function sortableTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatGraphqlErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return "";
  const messages = errors
    .map((err) => {
      if (isRecord(err) && typeof err.message === "string") return err.message;
      return "";
    })
    .filter(Boolean);
  return messages.length > 0 ? messages.join("; ") : "Linear GraphQL returned errors.";
}

function isValidTimestamp(value: string): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
