import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { mkdtempSync } from "fs";
import { ACTIVE_TTL_MS, hasFreshActiveMarker, processInput, type ProcessOptions } from "./handler";

const tempDirs: string[] = [];

function tempActiveDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ship-feature-gate-active-"));
  tempDirs.push(dir);
  return join(dir, ".ship-feature", "active");
}

function options(activeDir = tempActiveDir(), now = new Date("2026-06-09T12:00:00Z")): ProcessOptions {
  return {
    activeDir,
    now,
    logPath: join(activeDir, "..", "log.jsonl"),
    env: {},
  };
}

function writeMarker(activeDir: string, started = "2026-06-09T11:00:00Z"): void {
  mkdirSync(activeDir, { recursive: true });
  writeFileSync(
    join(activeDir, "test.json"),
    JSON.stringify({
      ticket: "XOS-47",
      session: "test",
      branch: "feat/xos47-ship-feature-hardening",
      started,
    }) + "\n"
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("BLOCK: gh pr create without active marker", () => {
  const result = processInput({ command: "gh pr create --fill", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("gh pr create");
  expect(result.message).toContain("WHAT: shipping op outside a /ship-feature run");
  expect(result.message).toContain("HOW: route through the ship-feature skill");
});

test("PASS: gh pr create with fresh active marker", () => {
  const activeDir = tempActiveDir();
  writeMarker(activeDir);
  const result = processInput({ command: "gh pr create --fill", cwd: "/tmp" }, options(activeDir));
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("fresh /ship-feature active marker");
});

test("BLOCK: stale active marker does not authorize shipping", () => {
  const activeDir = tempActiveDir();
  writeMarker(activeDir, new Date(Date.parse("2026-06-09T12:00:00Z") - ACTIVE_TTL_MS - 1).toISOString());
  expect(hasFreshActiveMarker(options(activeDir))).toBe(false);
  const result = processInput({ command: "gh pr create --fill", cwd: "/tmp" }, options(activeDir));
  expect(result.verdict).toBe("BLOCK");
});

test("BLOCK: git push origin main without active marker", () => {
  const result = processInput({ command: "git push origin main", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("git push to main");
});

test("BLOCK: git push origin HEAD:main without active marker", () => {
  const result = processInput({ command: "git push origin HEAD:main", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("git push to main");
});

test("PASS: git push origin feat/x is not a main push", () => {
  const result = processInput({ command: "git push origin feat/x", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toBe("not a shipping-class command");
});

test("PASS: read-only git commands do not block", () => {
  const result = processInput({ command: "git status", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
});

test("BLOCK: railway up without active marker", () => {
  const result = processInput({ command: "railway up -y", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("railway up");
});

test("BLOCK: direct ship-* command without active marker", () => {
  const result = processInput({ command: "ship-codi XOS-47", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("ship-* command ship-codi");
});

test("BLOCK: package runner ship-* command without active marker", () => {
  const result = processInput({ command: "bun run ship-plugin", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("bun run ship-plugin");
});

test("PASS: non-shipping command", () => {
  const result = processInput({ command: "bun test ./rules/ship-feature-gate/tests.ts", cwd: "/tmp" }, options());
  expect(result.verdict).toBe("PASS");
});

test("PASS: SHIP_FEATURE_GATE_OFF bypasses the gate", () => {
  const opts = options();
  opts.env = { SHIP_FEATURE_GATE_OFF: "1" };
  const result = processInput({ command: "gh pr create --fill", cwd: "/tmp" }, opts);
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("SHIP_FEATURE_GATE_OFF=1");
});

test("target is resolved from cwd", () => {
  const result = processInput({ command: "git push origin feat/x", cwd: "." }, options());
  expect(result.target).toBe(resolve("."));
});
