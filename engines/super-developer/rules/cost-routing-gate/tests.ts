import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { processInput, type ProcessOptions } from "./handler";

const tempDirs: string[] = [];
const NOW = new Date("2026-07-04T12:00:00Z");

interface Fixture {
  root: string;
  outside: string;
  markerDir: string;
  logPath: string;
}

function fixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "cost-routing-gate-"));
  tempDirs.push(base);
  const root = join(base, "repo");
  const outside = join(base, "outside");
  const markerDir = join(base, "home", ".ship-feature", "active");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const app = true;\n");
  writeFileSync(join(root, "docs", "plans", "x.md"), "# Plan\n");
  writeFileSync(join(root, "README.md"), "# Repo\n");
  return { root, outside, markerDir, logPath: join(base, "log.jsonl") };
}

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
}

function opts(fx: Fixture, extra: Partial<ProcessOptions> = {}): ProcessOptions {
  return {
    markerDir: fx.markerDir,
    logPath: fx.logPath,
    now: NOW,
    env: {},
    ...extra,
  };
}

function writeMarker(fx: Fixture, name: string, data: Record<string, unknown>): string {
  const path = join(fx.markerDir, name + ".json");
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  return path;
}

function writeFreshMarker(fx: Fixture, data: Record<string, unknown> = {}): void {
  writeMarker(fx, "fresh", {
    ticket: "XOS-206",
    session: "session-a",
    heartbeat: NOW.toISOString().replace(/\.\d+Z$/, "Z"),
    worktree: fx.root,
    ...data,
  });
}

function editPayload(filePath: string, cwd: string) {
  return { tool_name: "Edit", tool_input: { file_path: filePath }, cwd };
}

function writePayload(filePath: string, cwd: string) {
  return { tool_name: "Write", tool_input: { file_path: filePath }, cwd };
}

function bashPayload(command: string, cwd?: string) {
  return cwd === undefined ? { tool_name: "Bash", tool_input: { command } } : { tool_name: "Bash", tool_input: { command }, cwd };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("PASS: no fresh marker, including stale and zombie markers, is a fast no-op", () => {
  const fx = fixture();
  writeMarker(fx, "stale", { heartbeat: isoMinutesAgo(31), worktree: fx.root });
  writeMarker(fx, "started-stale", { started: isoMinutesAgo(31), worktree: fx.root });
  writeFileSync(join(fx.markerDir, "zombie.json"), "{not-json\n");

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("no fresh");
});

test("BLOCK: full production marker shape with worktree blocks source write", () => {
  const fx = fixture();
  writeMarker(fx, "started-real", {
    ticket: "XOS-206",
    session: "session-a",
    branch: "feat/xos-206-cost-routing-teeth",
    started: NOW.toISOString().replace(/\.\d+Z$/, "Z"),
    worktree: fx.root,
  });

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("source write");
});

test("PASS: full production marker shape with empty worktree cannot scope", () => {
  const fx = fixture();
  writeMarker(fx, "started-real-noscope", {
    ticket: "XOS-206",
    session: "session-a",
    branch: "feat/xos-206-cost-routing-teeth",
    started: NOW.toISOString().replace(/\.\d+Z$/, "Z"),
    worktree: "",
  });

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("none has a resolvable");
});

test("PASS: stale started-only marker without heartbeat is ignored", () => {
  const fx = fixture();
  writeMarker(fx, "started-stale-only", {
    ticket: "XOS-206",
    session: "session-a",
    branch: "feat/xos-206-cost-routing-teeth",
    started: isoMinutesAgo(31),
    worktree: fx.root,
  });

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("no fresh");
});

test("BLOCK: marker without started or heartbeat uses fresh file mtime fallback", () => {
  const fx = fixture();
  const marker = writeMarker(fx, "mtime-fresh", {
    ticket: "XOS-206",
    session: "session-a",
    branch: "feat/xos-206-cost-routing-teeth",
    worktree: fx.root,
  });
  utimesSync(marker, NOW, NOW);

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("source write");
});

test("BLOCK: fresh live run Edit source write inside worktree routes to codex exec", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("source write");
  expect(result.message).toContain("WHAT:");
  expect(result.message).toContain("HOW:");
  expect(result.message).toContain("codex exec");
  expect(result.message).not.toContain("Agent");
  expect(result.message).not.toContain("Task");
});

test("BLOCK: fresh live run Write source payload uses real PreToolUse file_path shape", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const result = processInput(writePayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(result.target).toBe(realpathSync.native(join(fx.root, "src", "app.ts")));
});

test("PASS: fresh live run allows docs/** and any markdown path", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const docs = processInput(editPayload(join(fx.root, "docs", "plans", "x.md"), fx.root), opts(fx));
  const markdown = processInput(writePayload(join(fx.root, "README.md"), fx.root), opts(fx));

  expect(docs.verdict).toBe("PASS");
  expect(markdown.verdict).toBe("PASS");
  expect(docs.reason).toContain("docs/markdown");
  expect(markdown.reason).toContain("docs/markdown");
});

test("PASS: fresh live run write outside any live worktree is not cross-session blocked", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const result = processInput(editPayload(join(fx.outside, "src.ts"), fx.outside), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("outside every fresh");
});

test("PASS: fresh marker with missing, empty, or nonexistent worktree cannot scope", () => {
  const fx = fixture();
  writeMarker(fx, "missing", { heartbeat: NOW.toISOString().replace(/\.\d+Z$/, "Z") });
  writeMarker(fx, "empty", { heartbeat: NOW.toISOString().replace(/\.\d+Z$/, "Z"), worktree: "" });
  writeMarker(fx, "nonexistent", { heartbeat: NOW.toISOString().replace(/\.\d+Z$/, "Z"), worktree: join(fx.root, "missing") });

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("none has a resolvable");
});

test("BLOCK: deploy-poll Bash with cwd inside fresh worktree routes to out-of-process Haiku", () => {
  const fx = fixture();
  writeFreshMarker(fx);
  const command = "railway up -y && while true; do railway status; sleep 10; done";

  const result = processInput(bashPayload(command, fx.root), opts(fx));
  const ghWatch = processInput(bashPayload("gh run watch 12345", fx.root), opts(fx));

  expect(result.verdict).toBe("BLOCK");
  expect(ghWatch.verdict).toBe("BLOCK");
  expect(result.message).toContain("WHAT:");
  expect(result.message).toContain("HOW:");
  expect(result.message).toContain("claude --model haiku -p");
  expect(result.message).not.toContain("Agent");
  expect(result.message).not.toContain("Task");
});

test("PASS: same deploy-poll Bash with cwd outside fresh worktree avoids cross-session false positive", () => {
  const fx = fixture();
  writeFreshMarker(fx);
  const command = "railway up -y && while true; do railway status; sleep 10; done";

  const result = processInput(bashPayload(command, fx.outside), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("outside every fresh");
});

test("PASS: one-shot and ambiguous Bash commands are not blocked", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const railway = processInput(bashPayload("railway up -y", fx.root), opts(fx));
  const git = processInput(bashPayload("git status --short", fx.root), opts(fx));
  const benignLoop = processInput(bashPayload("while true; do echo waiting; sleep 1; done", fx.root), opts(fx));

  expect(railway.verdict).toBe("PASS");
  expect(git.verdict).toBe("PASS");
  expect(benignLoop.verdict).toBe("PASS");
});

test("PASS: curl status health loop without deploy primitive is not blocked", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const result = processInput(bashPayload("while true; do curl http://localhost/status; sleep 2; done", fx.root), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("not a conservative deploy/poll loop");
});

test("PASS: Bash deploy-loop gate fails open when cwd is absent", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const result = processInput(bashPayload("railway up -y && while true; do railway status; sleep 10; done"), opts(fx));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("cwd absent");
});

test("PASS: COST_ROUTING_GATE_OFF=1 bypasses intended blocks", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx, { env: { COST_ROUTING_GATE_OFF: "1" } }));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("COST_ROUTING_GATE_OFF=1");
});

test("PASS: handler crash fails open and logs FAIL_OPEN", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  const result = processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx, { fs: { readdirSync: () => {
    throw new Error("boom");
  } } }));

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("fail-open");
  const rows = readFileSync(fx.logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(rows.at(-1)?.verdict).toBe("FAIL_OPEN");
  expect(rows.at(-1)?.rule_slug).toBe("cost-routing-gate");
});

test("logs PASS and BLOCK decisions to injected JSONL path", () => {
  const fx = fixture();
  writeFreshMarker(fx);

  processInput(editPayload(join(fx.root, "docs", "plans", "x.md"), fx.root), opts(fx));
  processInput(editPayload(join(fx.root, "src", "app.ts"), fx.root), opts(fx));

  expect(existsSync(fx.logPath)).toBe(true);
  const rows = readFileSync(fx.logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(rows.map((row) => row.verdict)).toEqual(["PASS", "BLOCK"]);
  expect(rows.every((row) => row.rule_slug === "cost-routing-gate")).toBe(true);
  expect(rows.every((row) => typeof row.tool === "string")).toBe(true);
});
