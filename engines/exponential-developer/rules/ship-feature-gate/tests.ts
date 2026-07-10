import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  ACTIVE_TTL_MS,
  JUDGE_RECEIPT_BLOCK_PATTERN,
  JUDGE_RECEIPT_MARKER,
  hasFreshActiveMarker,
  processInput,
  type ProcessOptions,
} from "./handler";

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

function receipt(verdict: "GREEN" | "RED"): string {
  return `<!-- ${JUDGE_RECEIPT_MARKER} -->
## 🧪 Cross-family judge receipt
- verdict: ${verdict}
- families: google, openai
- flags: 0 — none
- escalated: no
- ts: 2026-06-29T12:00:00Z`;
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

test("PASS: gh pr merge with judge receipt does not require active marker", () => {
  let request: unknown = null;
  const opts = options();
  opts.fetchPrBody = (args) => {
    request = args;
    return receipt("GREEN");
  };

  const result = processInput({ command: "gh pr merge 123 -R Exponential-OS/xos --auto --squash", cwd: "/tmp" }, opts);

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("cross-family judge receipt");
  expect(request).toEqual({ prArg: "123", repo: "Exponential-OS/xos", cwd: "/tmp" });
});

test("BLOCK: gh pr merge without judge receipt", () => {
  const opts = options();
  opts.fetchPrBody = () => "## Summary\nNo receipt here.\n";

  const result = processInput({ command: "gh pr merge 123 --auto --squash", cwd: "/tmp" }, opts);

  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("missing cross-family judge receipt");
  expect(result.message).toContain("WHAT: merge blocked — PR carries no cross-family judge receipt (XOS-138; the judge gate was skipped).");
  expect(result.message).toContain("ship-feature-judge-receipt:v1");
});

test("PASS: gh pr merge fetch failure fails open with warning log", () => {
  const activeDir = tempActiveDir();
  const opts = options(activeDir);
  mkdirSync(join(activeDir, ".."), { recursive: true });
  opts.fetchPrBody = (args) => {
    expect(args.prArg).toBe(null);
    return null;
  };

  const result = processInput({ command: "gh pr merge --auto --squash", cwd: "/tmp" }, opts);

  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("WARNING: gh pr merge receipt fetch failed");
  const log = readFileSync(opts.logPath!, "utf8");
  expect(log).toContain("WARNING: XOS-138 gh pr view failed");
  expect(log).toContain('"fail_open":true');
});

test("receipt regex matches the exact canonical format for GREEN and RED", () => {
  expect(JUDGE_RECEIPT_BLOCK_PATTERN.test(receipt("GREEN"))).toBe(true);
  expect(JUDGE_RECEIPT_BLOCK_PATTERN.test(receipt("RED"))).toBe(true);
  expect(JUDGE_RECEIPT_BLOCK_PATTERN.test(receipt("GREEN").replace("- verdict: GREEN", "- verdict: YELLOW"))).toBe(false);
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
