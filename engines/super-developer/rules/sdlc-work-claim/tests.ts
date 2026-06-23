import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { processInput } from "./handler";

const HANDLER = Bun.fileURLToPath(new URL("./handler.ts", import.meta.url));
const homes: string[] = [];

interface MockComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface MockIssue {
  id: string;
  identifier: string;
  stateName: string;
  comments: MockComment[];
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
}

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sdlc-work-claim-home-"));
  homes.push(home);
  return home;
}

function claimBody(session: string, heartbeat: string, extra: Partial<{ host: string; branch: string; worktree: string; started: string }> = {}): string {
  return (
    "🤖 SDLC-CLAIM session=" +
    session +
    " host=" +
    (extra.host ?? session + "-host") +
    " branch=" +
    (extra.branch ?? "feat/xos-25") +
    " worktree=" +
    (extra.worktree ?? "/tmp/" + session) +
    " started=" +
    (extra.started ?? heartbeat) +
    " heartbeat=" +
    heartbeat
  );
}

function makeLinearFetch(issue: MockIssue): typeof fetch {
  let nextComment = issue.comments.length + 1;
  const states = [
    { id: "state-backlog", name: "Backlog" },
    { id: "state-progress", name: "In Progress" },
    { id: "state-done", name: "Done" },
  ];

  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    await Bun.sleep(1);
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      operationName: string;
      variables: Record<string, any>;
    };

    if (payload.operationName === "IssueByIdentifier") {
      return Response.json({
        data: {
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            state: states.find((state) => state.name === issue.stateName) ?? null,
            team: { states: { nodes: states } },
            comments: {
              nodes: issue.comments.map((comment) => ({ ...comment })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    }

    if (payload.operationName === "IssueUpdate") {
      const state = states.find((candidate) => candidate.id === payload.variables.input.stateId);
      if (state) issue.stateName = state.name;
      return Response.json({ data: { issueUpdate: { success: true, issue: { id: issue.id, state } } } });
    }

    if (payload.operationName === "CommentCreate") {
      const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const comment = {
        id: "comment-" + nextComment++,
        body: String(payload.variables.input.body),
        createdAt: now,
        updatedAt: now,
      };
      issue.comments.push(comment);
      return Response.json({ data: { commentCreate: { success: true, comment } } });
    }

    if (payload.operationName === "CommentUpdate") {
      const comment = issue.comments.find((candidate) => candidate.id === payload.variables.id);
      if (!comment) return Response.json({ errors: [{ message: "missing comment" }] }, { status: 200 });
      comment.body = String(payload.variables.input.body);
      comment.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      return Response.json({ data: { commentUpdate: { success: true, comment } } });
    }

    return Response.json({ errors: [{ message: "unknown operation " + payload.operationName }] }, { status: 200 });
  }) as typeof fetch;
}

async function runWithMock(issue: MockIssue, input: Record<string, unknown>, fetchStub = makeLinearFetch(issue)) {
  return await processInput(input, {
    env: { LINEAR_API_KEY: "linear-test-key" },
    fetch: fetchStub,
    homeDir: tempHome(),
  });
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

test("two near-simultaneous claims produce exactly one PASS and one BLOCK", async () => {
  const issue: MockIssue = {
    id: "issue-1",
    identifier: "XOS-25",
    stateName: "Backlog",
    comments: [],
  };
  const base = {
    action: "claim",
    ticket: "XOS-25",
    branch: "feat/xos-25",
    worktree: "/tmp/xos-25",
  };

  const fetchStub = makeLinearFetch(issue);
  const [a, b] = await Promise.all([
    runWithMock(issue, { ...base, session: "session-a", host: "host-a" }, fetchStub),
    runWithMock(issue, { ...base, session: "session-b", host: "host-b" }, fetchStub),
  ]);

  expect([a.verdict, b.verdict].sort()).toEqual(["BLOCK", "PASS"]);
  const activeClaims = issue.comments.filter((comment) => comment.body.startsWith("🤖 SDLC-CLAIM"));
  expect(activeClaims).toHaveLength(1);
});

test("stale claim is reclaimable", async () => {
  const issue: MockIssue = {
    id: "issue-1",
    identifier: "XOS-25",
    stateName: "In Progress",
    comments: [
      {
        id: "comment-1",
        body: claimBody("old-session", isoMinutesAgo(31)),
        createdAt: isoMinutesAgo(31),
        updatedAt: isoMinutesAgo(31),
      },
    ],
  };

  const check = await runWithMock(issue, { action: "check", ticket: "XOS-25", session: "new-session" });
  expect(check.verdict).toBe("PASS");
  expect(check.reclaimable).toBe(true);
  expect(check.message).toContain("reclaimable: stale claim by old-session");

  const claim = await runWithMock(issue, {
    action: "claim",
    ticket: "XOS-25",
    session: "new-session",
    branch: "feat/xos-25-new",
    host: "new-host",
    worktree: "/tmp/new",
  });
  expect(claim.verdict).toBe("PASS");
  expect(issue.comments.filter((comment) => comment.body.startsWith("🤖 SDLC-CLAIM"))[0].body).toContain("session=new-session");
});

test("release frees it", async () => {
  const issue: MockIssue = {
    id: "issue-2",
    identifier: "XOS-26",
    stateName: "Backlog",
    comments: [],
  };

  const claim = await runWithMock(issue, {
    action: "claim",
    ticket: "XOS-26",
    session: "session-a",
    branch: "feat/xos-26",
    host: "host-a",
    worktree: "/tmp/xos-26",
  });
  expect(claim.verdict).toBe("PASS");

  const release = await runWithMock(issue, { action: "release", ticket: "XOS-26", session: "session-a" });
  expect(release.verdict).toBe("PASS");
  expect(issue.comments.filter((comment) => comment.body.startsWith("🤖 SDLC-CLAIM"))).toHaveLength(0);

  const check = await runWithMock(issue, { action: "check", ticket: "XOS-26", session: "session-b" });
  expect(check.verdict).toBe("PASS");
  expect(check.owner_session).toBeNull();
});

test("claim writes an active ship-feature marker", async () => {
  const home = tempHome();
  const issue: MockIssue = {
    id: "issue-3",
    identifier: "XOS-47",
    stateName: "Backlog",
    comments: [],
  };

  const result = await processInput(
    {
      action: "claim",
      ticket: "XOS-47",
      session: "session-marker",
      branch: "feat/xos-47",
      host: "host-a",
      worktree: "/tmp/cyborg-xos47",
    },
    {
      env: { LINEAR_API_KEY: "linear-test-key" },
      fetch: makeLinearFetch(issue),
      homeDir: home,
      now: new Date("2026-06-09T12:00:00Z"),
    }
  );

  expect(result.verdict).toBe("PASS");
  const markerPath = join(home, ".ship-feature", "active", "session-marker.json");
  expect(existsSync(markerPath)).toBe(true);
  expect(JSON.parse(readFileSync(markerPath, "utf8"))).toEqual({
    ticket: "XOS-47",
    session: "session-marker",
    branch: "feat/xos-47",
    started: "2026-06-09T12:00:00Z",
  });
});

test("release removes the active ship-feature marker", async () => {
  const home = tempHome();
  const issue: MockIssue = {
    id: "issue-4",
    identifier: "XOS-48",
    stateName: "Backlog",
    comments: [],
  };
  const fetchStub = makeLinearFetch(issue);

  const claim = await processInput(
    {
      action: "claim",
      ticket: "XOS-48",
      session: "session-release",
      branch: "feat/xos-48",
      host: "host-a",
      worktree: "/tmp/cyborg-xos48",
    },
    { env: { LINEAR_API_KEY: "linear-test-key" }, fetch: fetchStub, homeDir: home }
  );
  expect(claim.verdict).toBe("PASS");
  const markerPath = join(home, ".ship-feature", "active", "session-release.json");
  expect(existsSync(markerPath)).toBe(true);

  const release = await processInput(
    { action: "release", ticket: "XOS-48", session: "session-release" },
    { env: { LINEAR_API_KEY: "linear-test-key" }, fetch: fetchStub, homeDir: home }
  );
  expect(release.verdict).toBe("PASS");
  expect(existsSync(markerPath)).toBe(false);
});

test("complete posts completion comment, sets Done, and removes marker", async () => {
  const home = tempHome();
  const issue: MockIssue = {
    id: "issue-5",
    identifier: "XOS-49",
    stateName: "Backlog",
    comments: [],
  };
  const fetchStub = makeLinearFetch(issue);

  const claim = await processInput(
    {
      action: "claim",
      ticket: "XOS-49",
      session: "session-complete",
      branch: "feat/xos-49",
      host: "host-a",
      worktree: "/tmp/cyborg-xos49",
    },
    { env: { LINEAR_API_KEY: "linear-test-key" }, fetch: fetchStub, homeDir: home }
  );
  expect(claim.verdict).toBe("PASS");
  const markerPath = join(home, ".ship-feature", "active", "session-complete.json");
  expect(existsSync(markerPath)).toBe(true);

  const complete = await processInput(
    {
      action: "complete",
      ticket: "XOS-49",
      session: "session-complete",
      host: "host-a",
      summary: "added hard gate",
      pr_url: "https://github.com/acme/repo/pull/49",
      findings: "tests green",
    },
    { env: { LINEAR_API_KEY: "linear-test-key" }, fetch: fetchStub, homeDir: home }
  );

  expect(complete.verdict).toBe("PASS");
  expect(issue.stateName).toBe("Done");
  expect(issue.comments.some((comment) => comment.body === "✅ Completed by session session-complete on host-a. Fixed: added hard gate. PR: https://github.com/acme/repo/pull/49. Findings: tests green.")).toBe(true);
  expect(existsSync(markerPath)).toBe(false);
});

test("missing LINEAR_API_KEY exits 1 with remediation", async () => {
  const home = tempHome();
  const proc = Bun.spawn({
    cmd: [
      "bun",
      HANDLER,
      JSON.stringify({
        action: "check",
        ticket: "XOS-25",
        session: "session-a",
      }),
    ],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      LINEAR_API_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const output = JSON.parse(stdout.trim()) as { verdict: string; message: string };
  expect(exitCode).toBe(1);
  expect(output.verdict).toBe("BLOCK");
  expect(output.message).toContain("export LINEAR_API_KEY=<key> (Linear → Settings → API → Personal API keys)");
  expect(stderr).toContain("cross-machine claim coordination cannot work without it");
});

test("CLI exits 1 when processInput returns a validation BLOCK", async () => {
  const home = tempHome();
  const proc = Bun.spawn({
    cmd: [
      "bun",
      HANDLER,
      JSON.stringify({
        ticket: "XOS-25",
        session: "session-a",
      }),
    ],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      LINEAR_API_KEY: "linear-test-key",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const output = JSON.parse(stdout.trim()) as { verdict: string; message: string };
  expect(exitCode).toBe(1);
  expect(output.verdict).toBe("BLOCK");
  expect(output.message).toContain("WHAT: required field action is missing.");
  expect(output.message).toContain("HOW:");
  expect(stderr).toContain("required field action is missing");
});
