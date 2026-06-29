import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  detectRoleOwner,
  isSoloSession,
  readActiveSessions,
  resolveRoles,
  resolveSessionDataRoot,
  type SessionLivenessMarker,
  writeSessionHeartbeat,
} from "../session-roles.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
  LINEAR_API_KEY: process.env.LINEAR_API_KEY,
  LINEAR_COORDINATION_ISSUE_ID: process.env.LINEAR_COORDINATION_ISSUE_ID,
  LINEAR_SESSION_ROLES: process.env.LINEAR_SESSION_ROLES,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-roles-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeMarker(dataRoot: string, marker: SessionLivenessMarker): void {
  const path = join(dataRoot, "coordination", "sessions", `${marker.session_id}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(marker, null, 2) + "\n", "utf8");
}

function freshMarker(
  sessionId: string,
  allRoles: string[],
  offsetMinutes = 0,
): SessionLivenessMarker {
  const now = new Date(Date.now() - offsetMinutes * 60 * 1000).toISOString();
  return {
    session_id: sessionId,
    host: "test-host",
    started_at: now,
    last_heartbeat_at: now,
    all_roles: allRoles,
  };
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

// ---------------------------------------------------------------------------
// resolveSessionDataRoot
// ---------------------------------------------------------------------------

describe("resolveSessionDataRoot", () => {
  test("returns ~/.cyborg-state by default", () => {
    const result = resolveSessionDataRoot({ HOME: "/tmp/test-home" });
    expect(result).toBe(join("/tmp/test-home", ".cyborg-state"));
  });

  test("uses CLAUDE_PLUGIN_DATA when set", () => {
    const result = resolveSessionDataRoot({
      HOME: "/tmp/test-home",
      CLAUDE_PLUGIN_DATA: "/tmp/custom-data",
    });
    expect(result).toBe("/tmp/custom-data");
  });

  test("expands ~ in CLAUDE_PLUGIN_DATA", () => {
    const result = resolveSessionDataRoot({
      HOME: "/tmp/test-home",
      CLAUDE_PLUGIN_DATA: "~/plugin-data",
    });
    expect(result).toBe(join("/tmp/test-home", "plugin-data"));
  });
});

// ---------------------------------------------------------------------------
// writeSessionHeartbeat
// ---------------------------------------------------------------------------

describe("writeSessionHeartbeat", () => {
  test("creates a marker file with correct schema on first call", async () => {
    const dataRoot = makeTempDir();
    const result = await writeSessionHeartbeat({
      sessionId: "session-abc",
      host: "test-host",
      allRoles: ["*"],
      env: {},
      dataRoot,
    });

    expect(result.ok).toBe(true);
    const markerPath = join(dataRoot, "coordination", "sessions", "session-abc.json");
    const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
    expect(parsed.session_id).toBe("session-abc");
    expect(parsed.host).toBe("test-host");
    expect(parsed.all_roles).toEqual(["*"]);
    expect(typeof parsed.last_heartbeat_at).toBe("string");
    expect(typeof parsed.started_at).toBe("string");
  });

  test("updates last_heartbeat_at on second call without duplicating the file", async () => {
    const dataRoot = makeTempDir();

    const first = await writeSessionHeartbeat({
      sessionId: "session-idempotent",
      host: "host1",
      allRoles: ["*"],
      env: {},
      dataRoot,
    });
    const markerPath = join(
      dataRoot,
      "coordination",
      "sessions",
      "session-idempotent.json",
    );
    const firstMarker = JSON.parse(readFileSync(markerPath, "utf8"));
    const firstHb = firstMarker.last_heartbeat_at;
    const startedAt = firstMarker.started_at;

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 5));

    await writeSessionHeartbeat({
      sessionId: "session-idempotent",
      host: "host1",
      allRoles: ["*"],
      env: {},
      dataRoot,
    });
    const secondMarker = JSON.parse(readFileSync(markerPath, "utf8"));

    expect(first.ok).toBe(true);
    expect(secondMarker.started_at).toBe(startedAt); // preserved
    // last_heartbeat_at is allowed to be equal or newer (may be the same if <1ms resolution)
    expect(Date.parse(secondMarker.last_heartbeat_at)).toBeGreaterThanOrEqual(
      Date.parse(firstHb),
    );
  });

  test("does NOT call fetch when LINEAR_COORDINATION_ISSUE_ID is absent", async () => {
    const dataRoot = makeTempDir();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not call fetch");
    }) as typeof fetch;

    const result = await writeSessionHeartbeat({
      sessionId: "session-no-linear",
      allRoles: ["*"],
      env: { LINEAR_API_KEY: "lin_test_key" /* no issue id */ },
      dataRoot,
    });

    expect(result.ok).toBe(true);
    expect(fetchCalled).toBe(false);
  });

  test("does NOT call fetch when LINEAR_API_KEY is absent", async () => {
    const dataRoot = makeTempDir();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not call fetch");
    }) as typeof fetch;

    const result = await writeSessionHeartbeat({
      sessionId: "session-no-key",
      allRoles: ["*"],
      env: { LINEAR_COORDINATION_ISSUE_ID: "issue-123" /* no api key */ },
      dataRoot,
    });

    expect(result.ok).toBe(true);
    expect(fetchCalled).toBe(false);
  });

  test("fails open when fetch throws during Linear write", async () => {
    const dataRoot = makeTempDir();
    globalThis.fetch = (async () => {
      throw new Error("network failure");
    }) as typeof fetch;

    const result = await writeSessionHeartbeat({
      sessionId: "session-fetch-fail",
      allRoles: ["codi"],
      env: {
        LINEAR_API_KEY: "lin_test_key",
        LINEAR_COORDINATION_ISSUE_ID: "issue-456",
      },
      dataRoot,
    });

    // ok=true because the local write succeeded; warn about Linear failure
    expect(result.ok).toBe(true);
    expect(result.warn).toBeDefined();
    expect(result.warn).toContain("network failure");
    // Local marker still written
    const markerPath = join(
      dataRoot,
      "coordination",
      "sessions",
      "session-fetch-fail.json",
    );
    expect(JSON.parse(readFileSync(markerPath, "utf8")).session_id).toBe("session-fetch-fail");
  });

  test("creates a Linear comment on first call and stores comment ID", async () => {
    const dataRoot = makeTempDir();
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.query).toContain("commentCreate");
      return new Response(
        JSON.stringify({
          data: {
            commentCreate: { success: true, comment: { id: "comment-id-789" } },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await writeSessionHeartbeat({
      sessionId: "session-linear-create",
      host: "myhost",
      allRoles: ["*"],
      env: {
        LINEAR_API_KEY: "lin_key",
        LINEAR_COORDINATION_ISSUE_ID: "issue-abc",
      },
      dataRoot,
    });

    expect(result.ok).toBe(true);
    const markerPath = join(
      dataRoot,
      "coordination",
      "sessions",
      "session-linear-create.json",
    );
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    expect(marker.linear_comment_id).toBe("comment-id-789");
    expect(typeof marker.last_linear_mutation_at).toBe("string");
  });

  test("updates (not creates) a Linear comment when linear_comment_id is already set", async () => {
    const dataRoot = makeTempDir();
    // Pre-write a marker with an existing comment ID and a stale mutation time
    writeMarker(dataRoot, {
      session_id: "session-linear-update",
      host: "myhost",
      started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      last_heartbeat_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      all_roles: ["*"],
      linear_comment_id: "existing-comment-id",
      last_linear_mutation_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    let calledMutation: string | null = null;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calledMutation = body.query;
      return new Response(
        JSON.stringify({ data: { commentUpdate: { success: true } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await writeSessionHeartbeat({
      sessionId: "session-linear-update",
      allRoles: ["*"],
      env: {
        LINEAR_API_KEY: "lin_key",
        LINEAR_COORDINATION_ISSUE_ID: "issue-abc",
      },
      dataRoot,
    });

    expect(result.ok).toBe(true);
    expect(calledMutation).not.toBeNull();
    expect(calledMutation).toContain("commentUpdate");
    expect(calledMutation).not.toContain("commentCreate");
  });

  test("throttles Linear writes within 5 minutes", async () => {
    const dataRoot = makeTempDir();
    // Pre-write a marker with a very recent mutation timestamp
    writeMarker(dataRoot, {
      session_id: "session-throttle",
      host: "host",
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      all_roles: ["*"],
      linear_comment_id: "existing-id",
      last_linear_mutation_at: new Date().toISOString(), // just now
    });

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not call fetch within throttle window");
    }) as typeof fetch;

    const result = await writeSessionHeartbeat({
      sessionId: "session-throttle",
      allRoles: ["*"],
      env: {
        LINEAR_API_KEY: "lin_key",
        LINEAR_COORDINATION_ISSUE_ID: "issue-abc",
      },
      dataRoot,
    });

    expect(result.ok).toBe(true);
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readActiveSessions
// ---------------------------------------------------------------------------

describe("readActiveSessions", () => {
  test("returns empty array when session dir does not exist", () => {
    const dataRoot = makeTempDir();
    expect(readActiveSessions(dataRoot)).toEqual([]);
  });

  test("returns only sessions with fresh heartbeats", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("live-session", ["*"], 5)); // 5 min old → fresh (< 30)
    writeMarker(dataRoot, freshMarker("stale-session", ["*"], 45)); // 45 min old → stale

    const active = readActiveSessions(dataRoot, 30);

    expect(active).toHaveLength(1);
    expect(active[0].session_id).toBe("live-session");
  });

  test("skips unreadable / malformed marker files", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("good-session", ["*"], 0));
    // Write a malformed file
    const badPath = join(dataRoot, "coordination", "sessions", "bad-session.json");
    mkdirSync(dirname(badPath), { recursive: true });
    writeFileSync(badPath, "not valid json", "utf8");

    const active = readActiveSessions(dataRoot, 30);

    expect(active).toHaveLength(1);
    expect(active[0].session_id).toBe("good-session");
  });

  test("uses custom staleness threshold", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("fresh", ["*"], 3)); // 3 min old
    writeMarker(dataRoot, freshMarker("tooold", ["*"], 7)); // 7 min old

    expect(readActiveSessions(dataRoot, 5)).toHaveLength(1);
    expect(readActiveSessions(dataRoot, 5)[0].session_id).toBe("fresh");
    expect(readActiveSessions(dataRoot, 10)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// isSoloSession
// ---------------------------------------------------------------------------

describe("isSoloSession", () => {
  test("returns true when no other sessions exist", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("solo-me", ["*"], 0));
    expect(isSoloSession("solo-me", dataRoot, 30)).toBe(true);
  });

  test("returns false when a live sibling exists", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-a", ["*"], 0));
    writeMarker(dataRoot, freshMarker("session-b", ["codi"], 2));
    expect(isSoloSession("session-a", dataRoot, 30)).toBe(false);
    expect(isSoloSession("session-b", dataRoot, 30)).toBe(false);
  });

  test("returns true when only sibling is stale", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-a", ["*"], 0));
    writeMarker(dataRoot, freshMarker("session-b", ["codi"], 45)); // stale
    expect(isSoloSession("session-a", dataRoot, 30)).toBe(true);
  });

  test("returns true when no marker files exist at all", () => {
    const dataRoot = makeTempDir();
    expect(isSoloSession("new-session", dataRoot, 30)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectRoleOwner
// ---------------------------------------------------------------------------

describe("detectRoleOwner", () => {
  test("returns null when no dedicated session claims the role", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("generalist", ["*"], 0));
    expect(detectRoleOwner("codi", dataRoot, 30)).toBeNull();
  });

  test("returns session_id of the dedicated session that claims the role", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("dedicated-codi", ["codi"], 0));
    writeMarker(dataRoot, freshMarker("generalist", ["*"], 0));
    expect(detectRoleOwner("codi", dataRoot, 30)).toBe("dedicated-codi");
  });

  test("returns null when dedicated session is stale", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("dedicated-codi", ["codi"], 45)); // stale
    expect(detectRoleOwner("codi", dataRoot, 30)).toBeNull();
  });

  test("ignores generalist session for role ownership detection", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("generalist", ["*"], 0));
    // Generalist covers all roles but is NOT considered the dedicated owner
    expect(detectRoleOwner("career", dataRoot, 30)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveRoles
// ---------------------------------------------------------------------------

describe("resolveRoles", () => {
  test("generalist solo session returns all roles", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-a", ["*"], 0));

    const result = resolveRoles("session-a", ["codi", "brand", "career"], dataRoot, 30);

    expect(result.isSolo).toBe(true);
    expect(result.roles).toEqual(["codi", "brand", "career"]);
  });

  test("generalist sheds role to live dedicated sibling", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-gen", ["*"], 0));
    writeMarker(dataRoot, freshMarker("session-codi", ["codi"], 0));

    const result = resolveRoles("session-gen", ["codi", "brand", "career"], dataRoot, 30);

    expect(result.isSolo).toBe(false);
    expect(result.roles).toEqual(["brand", "career"]); // codi shed to dedicated sibling
  });

  test("generalist reclaims role when dedicated sibling goes stale", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-gen", ["*"], 0));
    writeMarker(dataRoot, freshMarker("session-codi", ["codi"], 45)); // stale

    const result = resolveRoles("session-gen", ["codi", "brand", "career"], dataRoot, 30);

    expect(result.isSolo).toBe(true);
    expect(result.roles).toEqual(["codi", "brand", "career"]); // reclaimed
  });

  test("dedicated session NEVER sheds its own configured roles", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-codi-1", ["codi"], 0));
    writeMarker(dataRoot, freshMarker("session-codi-2", ["codi"], 1)); // also dedicated to codi

    // Both dedicated sessions keep their roles (no flatline)
    const result1 = resolveRoles("session-codi-1", ["codi"], dataRoot, 30);
    const result2 = resolveRoles("session-codi-2", ["codi"], dataRoot, 30);

    expect(result1.roles).toEqual(["codi"]);
    expect(result2.roles).toEqual(["codi"]);
  });

  test("dedicated session with multiple roles keeps all of them", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-multi", ["brand", "codi"], 0));

    const result = resolveRoles("session-multi", ["brand", "codi"], dataRoot, 30);

    expect(result.roles).toEqual(["brand", "codi"]);
  });

  test("generalist sheds only the roles held by dedicated siblings, keeps the rest", () => {
    const dataRoot = makeTempDir();
    writeMarker(dataRoot, freshMarker("session-gen", ["*"], 0));
    writeMarker(dataRoot, freshMarker("session-brand", ["brand"], 0));
    writeMarker(dataRoot, freshMarker("session-codi", ["codi"], 45)); // stale

    const result = resolveRoles(
      "session-gen",
      ["codi", "brand", "career", "xos"],
      dataRoot,
      30,
    );

    expect(result.isSolo).toBe(false);
    expect(result.roles).toEqual(["codi", "career", "xos"]); // brand shed; codi reclaimed (stale sibling)
  });
});
