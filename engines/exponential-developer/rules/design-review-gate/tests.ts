import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { processInput, sha256Text, type ProcessOptions } from "./handler";

const tempDirs: string[] = [];

interface Fixture {
  root: string;
  specPath: string;
  verdictPath: string;
}

function fixture(specText = "# Feature\n\n## Change manifest\n+ added docs/example.md\n"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "design-review-gate-"));
  tempDirs.push(root);
  const specPath = join(root, "docs", "plans", "feature.md");
  const verdictPath = join(root, "docs", "plans", "feature.design-review.json");
  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(specPath, specText);
  return { root, specPath, verdictPath };
}

function options(fx: Fixture): ProcessOptions {
  return {
    specPath: fx.specPath,
    logPath: join(fx.root, "log.jsonl"),
    env: {},
  };
}

function writeVerdict(fx: Fixture, value: Record<string, unknown>): void {
  writeFileSync(
    fx.verdictPath,
    JSON.stringify(
      {
        findings: [],
        spec_sha256: sha256Text(readFileSync(fx.specPath, "utf8")),
        manifest_sha256: sha256Text("manifest"),
        reviewer_model: "claude-fable-5",
        reviewer_family: "anthropic",
        cross_family: "unavailable",
        cycle: 1,
        timestamp: "2026-07-03T12:00:00Z",
        ...value,
      },
      null,
      2
    ) + "\n"
  );
}

function run(fx: Fixture, opts: ProcessOptions = options(fx)) {
  return processInput({ command: "codex exec implement this feature", cwd: fx.root, spec_path: fx.specPath }, opts);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("BLOCK: missing verdict", () => {
  const fx = fixture();
  const result = run(fx);
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("no design-review verdict record exists");
  expect(result.message).toContain("WHAT:");
  expect(result.message).toContain("HOW:");
});

test("BLOCK: spec hash tamper", () => {
  const fx = fixture();
  writeVerdict(fx, { verdict: "GREEN" });
  writeFileSync(fx.specPath, "# Feature\n\nTampered after review.\n");
  const result = run(fx);
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("spec was edited after review");
});

test("BLOCK: RED verdict", () => {
  const fx = fixture();
  writeVerdict(fx, { verdict: "RED", findings: [{ severity: "RED", lens: "theater", fix: "Build a real behavior change." }] });
  const result = run(fx);
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("verdict is RED");
});

test("BLOCK: Class-B applied", () => {
  const fx = fixture();
  writeVerdict(fx, {
    verdict: "YELLOW",
    adjustments: [{ class: "B", applied: true, text: "Remove a required acceptance criterion." }],
  });
  const result = run(fx);
  expect(result.verdict).toBe("BLOCK");
  expect(result.reason).toContain("Class-B design adjustment was applied");
});

test("PASS: GREEN", () => {
  const fx = fixture();
  writeVerdict(fx, { verdict: "GREEN" });
  const result = run(fx);
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("design review verdict GREEN");
});

test("PASS: YELLOW Class-A", () => {
  const fx = fixture();
  writeVerdict(fx, {
    verdict: "YELLOW",
    findings: [{ severity: "YELLOW", lens: "missing-requirements", fix: "Clarify that existing behavior is unchanged." }],
    adjustments: [{ class: "A", applied: true, text: "Clarify that existing behavior is unchanged." }],
  });
  const result = run(fx);
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("YELLOW");
});

test("PASS: SKIPPED objective rule", () => {
  const fx = fixture();
  writeVerdict(fx, { verdict: "SKIPPED", rule: "mechanical-manifest" });
  const result = run(fx);
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("skipped");
});

test("PASS: DESIGN_REVIEW_GATE_OFF bypasses the gate", () => {
  const fx = fixture();
  const opts = options(fx);
  opts.env = { DESIGN_REVIEW_GATE_OFF: "1" };
  const result = run(fx, opts);
  expect(result.verdict).toBe("PASS");
  expect(result.reason).toContain("DESIGN_REVIEW_GATE_OFF=1");
});
