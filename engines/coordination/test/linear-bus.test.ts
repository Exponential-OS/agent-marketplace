import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  queryLinearBusDelta,
  queryNewUrgentIssues,
  resolveLinearConfig,
  type LinearBusDelta,
} from "../linear-bus.ts";
import {
  resolveLinearBusDataRoot,
  resolveLinearBusMarkerPath,
  runLinearBusPull,
  summarizeLinearBusDelta,
} from "../hooks/linear-bus-pull.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  LINEAR_API_KEY: process.env.LINEAR_API_KEY,
  LINEAR_TEAM: process.env.LINEAR_TEAM,
  LINEAR_PROJECT: process.env.LINEAR_PROJECT,
  LINEAR_BUS_COLD_START_WINDOW: process.env.LINEAR_BUS_COLD_START_WINDOW,
  CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
  HOME: process.env.HOME,
};
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("linear-bus adapter", () => {
  test("shapes a Linear GraphQL pull query and parses a structured delta", async () => {
    const since = "2026-01-02T03:04:05.000Z";
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    process.env.LINEAR_API_KEY = "lin_test_key";
    process.env.LINEAR_TEAM = "Core Team";
    delete process.env.LINEAR_PROJECT;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse({ data: sampleGraphqlData() });
    }) as typeof fetch;

    const result = await queryLinearBusDelta(since);

    expect(result.ok).toBe(true);
    expect(result.delta?.teamName).toBe("Core Team");
    expect(result.delta?.assignedIssues).toHaveLength(1);
    expect(result.delta?.recentComments).toHaveLength(1);
    expect(result.delta?.recentComments[0].source).toBe("assigned+owned");
    expect(result.delta?.urgentIssues).toHaveLength(1);

    expect(capturedUrl).toBe("https://api.linear.app/graphql");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe("lin_test_key");
    expect((capturedInit?.headers as Record<string, string>).Authorization).not.toContain("Bearer");

    const body = JSON.parse(String(capturedInit?.body));
    expect(body.variables).toEqual({ since, teamName: "Core Team" });
    expect(body.query).toContain("assignedIssues(filter: { updatedAt: { gt: $since } }");
    expect(body.query).toContain("assignedCommentIssues: assignedIssues");
    expect(body.query).toContain("ownedCommentIssues: createdIssues");
    expect(body.query).toContain("comments(filter: { updatedAt: { gt: $since } }");
    expect(body.query).toContain("priority: { eq: 1 }");
    expect(body.query).toContain("team: { name: { eq: $teamName } }");
    expect(body.query).not.toContain("$project");
    expect(body.query).not.toContain("project: { name: { eq: $project } }");
  });

  test("adds project filters and variables when project is configured", async () => {
    const since = "2026-01-02T03:04:05.000Z";
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ data: sampleGraphqlData() });
    }) as typeof fetch;

    const result = await queryLinearBusDelta(since, {
      apiKey: "lin_test_key",
      teamName: "Core Team",
      projectName: "xOS Project",
    });

    expect(result.ok).toBe(true);
    expect(result.delta?.projectName).toBe("xOS Project");

    const body = JSON.parse(String(capturedInit?.body));
    expect(body.variables).toEqual({
      since,
      teamName: "Core Team",
      project: "xOS Project",
    });
    expect(body.query).toContain(
      "query LinearBusDelta($since: DateTimeOrDuration!, $teamName: String!, $project: String!)",
    );
    expect(body.query).toContain("updatedAt: { gt: $since }");
    expect(body.query).toContain("comments: { updatedAt: { gt: $since } }");
    expect(body.query).toContain("priority: { eq: 1 }");
    expect(body.query).toContain("team: { name: { eq: $teamName } }");
    expect(body.query.match(/project: \{ name: \{ eq: \$project \} \}/g)).toHaveLength(4);
  });

  test("fails open without LINEAR_API_KEY and does not call fetch", async () => {
    delete process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_TEAM;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not fetch");
    }) as typeof fetch;

    const result = await queryLinearBusDelta("2026-01-02T03:04:05.000Z");

    expect(result.ok).toBe(false);
    expect(result.warn).toContain("LINEAR_API_KEY");
    expect(fetchCalled).toBe(false);
  });

  test("fails open when fetch throws", async () => {
    process.env.LINEAR_API_KEY = "lin_test_key";
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const result = await queryLinearBusDelta("2026-01-02T03:04:05.000Z");

    expect(result.ok).toBe(false);
    expect(result.err).toContain("network down");
  });

  test("fails open on non-JSON Linear responses", async () => {
    process.env.LINEAR_API_KEY = "lin_test_key";
    globalThis.fetch = (async () => {
      return new Response("not json", { status: 200 });
    }) as typeof fetch;

    const result = await queryLinearBusDelta("2026-01-02T03:04:05.000Z");

    expect(result.ok).toBe(false);
    expect(result.err).toContain("non-JSON");
  });

  test("resolves config defaults without hardcoded personal data", () => {
    const home = makeTempDir();
    const config = resolveLinearConfig({ LINEAR_API_KEY: "lin_test_key", HOME: home }, home);

    expect(config).toEqual({
      apiKey: "lin_test_key",
      teamName: "",
      projectName: null,
    });
    expect(resolveLinearBusDataRoot({ HOME: "/tmp/test-home" })).toBe(
      join("/tmp/test-home", ".cyborg-state"),
    );
    expect(resolveLinearBusDataRoot({ HOME: "/tmp/test-home", CLAUDE_PLUGIN_DATA: "~/plugin" })).toBe(
      join("/tmp/test-home", "plugin"),
    );
  });

  test("resolves config by precedence: env overrides route, route overrides default", () => {
    const home = makeTempDir();
    writeWorkspaceManifest(home, sampleWipGoalManifest());
    const routeCwd = join(home, "anand-career-os", "WIP", "xOS-platform", "feature");
    const defaultCwd = join(home, "anand-career-os", "notes");
    const statePath = join(home, "state", "linear-session.json");

    expect(
      resolveLinearConfig(
        {
          HOME: home,
          LINEAR_API_KEY: "lin_test_key",
          LINEAR_TEAM: "Env Team",
          LINEAR_PROJECT: "Env Project",
        },
        routeCwd,
        statePath,
      ),
    ).toEqual({
      apiKey: "lin_test_key",
      teamName: "Env Team",
      projectName: "Env Project",
    });

    expect(resolveLinearConfig({ HOME: home, LINEAR_API_KEY: "lin_test_key" }, routeCwd, statePath)).toEqual({
      apiKey: "lin_test_key",
      teamName: "Route Team",
      projectName: "Route Project",
    });

    expect(resolveLinearConfig({ HOME: home, LINEAR_API_KEY: "lin_test_key" }, defaultCwd, statePath)).toEqual({
      apiKey: "lin_test_key",
      teamName: "Default Team",
      projectName: null,
    });
  });

  test("uses the longest matching WIP path prefix for cwd routing", () => {
    const home = makeTempDir();
    writeWorkspaceManifest(home, sampleWipGoalManifest());
    const statePath = join(home, "state", "linear-session.json");

    const cyborg = resolveLinearConfig(
      { HOME: home, LINEAR_API_KEY: "lin_test_key" },
      join(home, "anand-career-os", "WIP", "xOS-platform", "cyborg", "kernel"),
      statePath,
    );
    const xos = resolveLinearConfig(
      { HOME: home, LINEAR_API_KEY: "lin_test_key" },
      join(home, "anand-career-os", "WIP", "xOS-platform", "kernel"),
      statePath,
    );

    expect(cyborg.teamName).toBe("Cyborg Team");
    expect(cyborg.projectName).toBe("Cyborg Project");
    expect(xos.teamName).toBe("Route Team");
    expect(xos.projectName).toBe("Route Project");
  });

  test("caches the parsed WIP map and resolved config in the session state file", () => {
    const home = makeTempDir();
    const manifestPath = writeWorkspaceManifest(home, sampleWipGoalManifest());
    const statePath = join(home, "state", "linear-session.json");
    const cwd = join(home, "anand-career-os", "WIP", "xOS-platform", "cyborg", "kernel");

    const first = resolveLinearConfig({ HOME: home, LINEAR_API_KEY: "lin_test_key" }, cwd, statePath);
    writeFileSync(manifestPath, "wip_goal_map:\n  default: [bad\n", "utf8");
    const second = resolveLinearConfig({ HOME: home, LINEAR_API_KEY: "lin_test_key" }, cwd, statePath);
    const state = JSON.parse(readFileSync(statePath, "utf8"));

    expect(first.projectName).toBe("Cyborg Project");
    expect(second.projectName).toBe("Cyborg Project");
    expect(state.linear_config_cache.resolved).toEqual({
      teamName: "Cyborg Team",
      projectName: "Cyborg Project",
    });
    expect(state.linear_config_cache.map.routes).toHaveLength(2);
  });

  test("fails safe to generic config when manifest is missing or unparseable", () => {
    const missingHome = makeTempDir();
    writeWorkspaceContext(missingHome);
    const missing = resolveLinearConfig(
      { HOME: missingHome, LINEAR_API_KEY: "lin_test_key" },
      join(missingHome, "anand-career-os"),
      join(missingHome, "state", "missing.json"),
    );

    const badHome = makeTempDir();
    writeWorkspaceManifest(badHome, "wip_goal_map:\n  default: [bad\n");
    const bad = resolveLinearConfig(
      { HOME: badHome, LINEAR_API_KEY: "lin_test_key" },
      join(badHome, "anand-career-os"),
      join(badHome, "state", "bad.json"),
    );

    expect(missing).toEqual({ apiKey: "lin_test_key", teamName: "", projectName: null });
    expect(bad).toEqual({ apiKey: "lin_test_key", teamName: "", projectName: null });
  });

  test("skips urgent pulls when LINEAR_TEAM is unset", async () => {
    const since = "2026-01-02T03:04:05.000Z";
    const bodies: Array<{ query: string; variables: Record<string, unknown> }> = [];

    process.env.LINEAR_API_KEY = "lin_test_key";
    delete process.env.LINEAR_TEAM;
    delete process.env.LINEAR_PROJECT;
    process.env.HOME = makeTempDir();
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);

      if (body.query.includes("LinearViewerAssignedIssues")) {
        return jsonResponse({
          data: {
            viewer: {
              assignedIssues: {
                nodes: [
                  makeIssue({
                    id: "issue-assigned-no-team",
                    identifier: "CORE-3",
                    title: "Assigned without team filter",
                  }),
                ],
              },
            },
          },
        });
      }

      if (body.query.includes("LinearRecentComments")) {
        return jsonResponse({
          data: {
            viewer: {
              assignedCommentIssues: { nodes: [] },
              ownedCommentIssues: { nodes: [] },
            },
          },
        });
      }

      throw new Error("unexpected query");
    }) as typeof fetch;

    const result = await queryLinearBusDelta(since);

    expect(result.ok).toBe(true);
    expect(result.delta?.teamName).toBe("");
    expect(result.delta?.assignedIssues).toHaveLength(1);
    expect(result.delta?.urgentIssues).toEqual([]);
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.variables)).toEqual([{ since }, { since }]);
    expect(bodies.some((body) => body.query.includes("urgentIssues"))).toBe(false);
    expect(bodies.some((body) => body.query.includes("team: { name: { eq: $teamName } }"))).toBe(
      false,
    );
  });

  test("scopes split assigned and comment queries by project without a team", async () => {
    const since = "2026-01-02T03:04:05.000Z";
    const bodies: Array<{ query: string; variables: Record<string, unknown> }> = [];

    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);

      if (body.query.includes("LinearViewerAssignedIssues")) {
        return jsonResponse({ data: { viewer: { assignedIssues: { nodes: [] } } } });
      }

      if (body.query.includes("LinearRecentComments")) {
        return jsonResponse({
          data: {
            viewer: {
              assignedCommentIssues: { nodes: [] },
              ownedCommentIssues: { nodes: [] },
            },
          },
        });
      }

      throw new Error("unexpected query");
    }) as typeof fetch;

    const result = await queryLinearBusDelta(since, {
      apiKey: "lin_test_key",
      teamName: "",
      projectName: "xOS Project",
    });

    expect(result.ok).toBe(true);
    expect(result.delta?.projectName).toBe("xOS Project");
    expect(bodies).toHaveLength(2);
    expect(bodies.map((body) => body.variables)).toEqual([
      { since, project: "xOS Project" },
      { since, project: "xOS Project" },
    ]);
    expect(bodies.every((body) => body.query.includes("$project: String!"))).toBe(true);
    expect(bodies.every((body) => body.query.includes("project: { name: { eq: $project } }"))).toBe(
      true,
    );
    expect(bodies.some((body) => body.query.includes("urgentIssues"))).toBe(false);
  });

  test("queryNewUrgentIssues does not fetch without a team", async () => {
    process.env.LINEAR_API_KEY = "lin_test_key";
    delete process.env.LINEAR_TEAM;
    delete process.env.LINEAR_PROJECT;
    process.env.HOME = makeTempDir();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not fetch");
    }) as typeof fetch;

    const result = await queryNewUrgentIssues("2026-01-02T03:04:05.000Z");

    expect(result).toEqual({ ok: true, issues: [] });
    expect(fetchCalled).toBe(false);
  });
});

describe("linear-bus UserPromptSubmit hook", () => {
  test("passes the per-session marker as the delta since timestamp", async () => {
    const dataRoot = makeTempDir();
    const sessionId = "session_123";
    const markerPath = resolveLinearBusMarkerPath(sessionId, {}, dataRoot);
    const oldSeen = "2026-01-02T03:04:05.000Z";
    writeMarker(markerPath, oldSeen);
    let capturedSince = "";

    const output = await runLinearBusPull(JSON.stringify({ session_id: sessionId }), {
      dataRoot,
      env: { LINEAR_API_KEY: "lin_test_key" },
      fetchDelta: async (since, config) => {
        capturedSince = since;
        return { ok: true, delta: emptyDelta(since, config.teamName) };
      },
    });

    expect(output).toBeNull();
    expect(capturedSince).toBe(oldSeen);
  });

  test("uses the cold-start window when no per-session marker exists", async () => {
    const dataRoot = makeTempDir();
    const sessionId = "session_cold";
    let capturedSince = "";

    const output = await runLinearBusPull(JSON.stringify({ session_id: sessionId }), {
      dataRoot,
      env: {
        LINEAR_API_KEY: "lin_test_key",
        LINEAR_TEAM: "Core Team",
        LINEAR_BUS_COLD_START_WINDOW: "6h",
      },
      fetchDelta: async (since, config) => {
        capturedSince = since;
        return { ok: true, delta: emptyDelta(since, config.teamName) };
      },
      now: () => new Date("2026-01-02T12:00:00.000Z"),
    });

    expect(output).toBeNull();
    expect(capturedSince).toBe("2026-01-02T06:00:00.000Z");
    expect(capturedSince).not.toBe("1970-01-01T00:00:00.000Z");
  });

  test("threads hook cwd into Linear config resolution", async () => {
    const home = makeTempDir();
    writeWorkspaceManifest(home, sampleWipGoalManifest());
    const dataRoot = makeTempDir();
    const cwd = join(home, "anand-career-os", "WIP", "xOS-platform", "cyborg", "kernel");
    let capturedConfig: { teamName: string; projectName: string | null } | null = null;

    const output = await runLinearBusPull(JSON.stringify({ session_id: "session_cwd", cwd }), {
      dataRoot,
      env: { HOME: home, LINEAR_API_KEY: "lin_test_key" },
      fetchDelta: async (since, config) => {
        capturedConfig = { teamName: config.teamName, projectName: config.projectName };
        return { ok: true, delta: emptyDelta(since, config.teamName) };
      },
    });

    expect(output).toBeNull();
    expect(capturedConfig).toEqual({
      teamName: "Cyborg Team",
      projectName: "Cyborg Project",
    });
  });

  test("emits once for a delta and advances the marker", async () => {
    const dataRoot = makeTempDir();
    const sessionId = "session_once";
    const markerPath = resolveLinearBusMarkerPath(sessionId, {}, dataRoot);
    const oldSeen = "2026-01-02T03:04:05.000Z";
    const newSeen = "2026-01-02T04:00:00.000Z";
    writeMarker(markerPath, oldSeen);
    const seenValues: string[] = [];

    const fetchDelta = async (since: string) => {
      seenValues.push(since);
      if (since === oldSeen) {
        return {
          ok: true,
          delta: {
            ...emptyDelta(since, "Core Team"),
            assignedIssues: [
              {
                id: "issue-1",
                identifier: "CORE-1",
                title: "Pull latest state",
                updatedAt: newSeen,
              },
            ],
          },
        };
      }
      return { ok: true, delta: emptyDelta(since, "Core Team") };
    };

    const first = await runLinearBusPull(JSON.stringify({ session_id: sessionId }), {
      dataRoot,
      env: { LINEAR_API_KEY: "lin_test_key", LINEAR_TEAM: "Core Team" },
      fetchDelta,
      now: () => new Date("2026-01-02T04:01:00.000Z"),
    });
    const second = await runLinearBusPull(JSON.stringify({ session_id: sessionId }), {
      dataRoot,
      env: { LINEAR_API_KEY: "lin_test_key", LINEAR_TEAM: "Core Team" },
      fetchDelta,
    });

    expect(first).not.toBeNull();
    const parsed = JSON.parse(first!);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("BUS:");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("CORE-1");
    expect(JSON.parse(readFileSync(markerPath, "utf8")).last_seen_at).toBe(newSeen);
    expect(second).toBeNull();
    expect(seenValues).toEqual([oldSeen, newSeen]);
  });

  test("caps summaries at eight items with a hidden-count suffix", () => {
    const delta = {
      ...emptyDelta("2026-01-02T03:04:05.000Z", "Core Team"),
      assignedIssues: Array.from({ length: 5 }, (_, index) =>
        makeIssue({
          id: `issue-a-${index + 1}`,
          identifier: `CORE-A${index + 1}`,
          title: `Assigned ${index + 1}`,
        }),
      ),
      recentComments: Array.from({ length: 4 }, (_, index) => ({
        id: `comment-${index + 1}`,
        body: `Comment ${index + 1}`,
        updatedAt: `2026-01-02T03:0${index}:00.000Z`,
        user: { id: `user-${index + 1}`, name: `User ${index + 1}` },
        issue: {
          id: `issue-c-${index + 1}`,
          identifier: `CORE-C${index + 1}`,
          title: `Comment issue ${index + 1}`,
        },
        source: "assigned" as const,
      })),
      urgentIssues: Array.from({ length: 3 }, (_, index) =>
        makeIssue({
          id: `issue-u-${index + 1}`,
          identifier: `CORE-U${index + 1}`,
          title: `Urgent ${index + 1}`,
        }),
      ),
    };

    const summary = summarizeLinearBusDelta(delta);

    expect(summary).toContain("BUS:");
    expect(summary).toContain("CORE-A5");
    expect(summary).toContain("CORE-C3");
    expect(summary).toContain("+4 more");
    expect(summary).not.toContain("CORE-C4");
    expect(summary).not.toContain("CORE-U1");
  });

  test("fails safe with invalid input, missing key, fetch throw, and non-JSON response", async () => {
    const dataRoot = makeTempDir();
    const validInput = JSON.stringify({ session_id: "safe_session" });

    expect(await runLinearBusPull("{", { dataRoot })).toBeNull();
    expect(await runLinearBusPull(JSON.stringify({ session_id: "../bad" }), { dataRoot })).toBeNull();
    expect(await runLinearBusPull(validInput, { dataRoot, env: {} })).toBeNull();

    expect(
      await runLinearBusPull(validInput, {
        dataRoot,
        env: { LINEAR_API_KEY: "lin_test_key" },
        fetchDelta: async () => {
          throw new Error("boom");
        },
      }),
    ).toBeNull();

    process.env.LINEAR_API_KEY = "lin_test_key";
    globalThis.fetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    expect(
      await runLinearBusPull(validInput, {
        dataRoot,
        env: { LINEAR_API_KEY: "lin_test_key" },
      }),
    ).toBeNull();
  });
});

function sampleGraphqlData() {
  const assigned = makeIssue({
    id: "issue-assigned",
    identifier: "CORE-1",
    title: "Assigned issue",
    updatedAt: "2026-01-02T05:00:00.000Z",
  });
  const urgent = makeIssue({
    id: "issue-urgent",
    identifier: "CORE-2",
    title: "Production outage",
    priority: 1,
    priorityLabel: "Urgent",
    createdAt: "2026-01-02T05:30:00.000Z",
    updatedAt: "2026-01-02T05:30:00.000Z",
  });
  const comment = {
    id: "comment-1",
    body: "Please check the latest state.",
    url: "https://linear.app/twm/comment/comment-1",
    createdAt: "2026-01-02T05:20:00.000Z",
    updatedAt: "2026-01-02T05:20:00.000Z",
    user: { id: "user-2", name: "Teammate", email: "teammate@example.com" },
  };

  return {
    viewer: {
      id: "user-1",
      name: "Viewer",
      email: "viewer@example.com",
      assignedIssues: { nodes: [assigned] },
      assignedCommentIssues: { nodes: [{ ...assigned, comments: { nodes: [comment] } }] },
      ownedCommentIssues: { nodes: [{ ...assigned, comments: { nodes: [comment] } }] },
    },
    urgentIssues: { nodes: [urgent] },
  };
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue",
    identifier: "CORE-0",
    title: "Issue",
    url: "https://linear.app/core/issue/CORE-0/issue",
    priority: 2,
    priorityLabel: "High",
    createdAt: "2026-01-02T03:00:00.000Z",
    updatedAt: "2026-01-02T03:00:00.000Z",
    state: { name: "In Progress", type: "started" },
    team: { name: "Core Team", key: "CORE" },
    assignee: { id: "user-1", name: "Viewer", email: "viewer@example.com" },
    creator: { id: "user-1", name: "Viewer", email: "viewer@example.com" },
    ...overrides,
  };
}

function emptyDelta(since: string, teamName: string): LinearBusDelta {
  return {
    since,
    queriedAt: "2026-01-02T03:04:06.000Z",
    teamName,
    assignedIssues: [],
    recentComments: [],
    urgentIssues: [],
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "linear-bus-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeMarker(markerPath: string, lastSeenAt: string): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify({ last_seen_at: lastSeenAt }) + "\n", "utf8");
}

function writeWorkspaceManifest(home: string, manifest: string): string {
  writeWorkspaceContext(home);
  const workspaceRoot = join(home, "anand-career-os");
  const manifestPath = join(workspaceRoot, "workspace.manifest.yaml");
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(manifestPath, manifest, "utf8");
  return manifestPath;
}

function writeWorkspaceContext(home: string): void {
  const contextDir = join(home, ".codialectic");
  mkdirSync(contextDir, { recursive: true });
  writeFileSync(
    join(contextDir, "context.json"),
    JSON.stringify({ workspace_root: "~/anand-career-os" }) + "\n",
    "utf8",
  );
}

function sampleWipGoalManifest(): string {
  return `
wip_goal_map:
  default: { team: "Default Team", project: null }
  routes:
    - { wip: "~/anand-career-os/WIP/xOS-platform", goal: "xos", team: "Route Team", project: "Route Project" }
    - { wip: "~/anand-career-os/WIP/xOS-platform/cyborg", goal: "cyborg", team: "Cyborg Team", project: "Cyborg Project" }
`;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
