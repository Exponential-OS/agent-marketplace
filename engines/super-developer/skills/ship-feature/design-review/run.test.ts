import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  classifyAdjustment,
  parseStructuredVerdict,
  runDesignReview,
  sha256Text,
  shouldSkip,
  sidecarPathForSpec,
  type ReviewerCommand,
} from "./run";
import { hasValidVerdict } from "../../../rules/design-review-gate/handler";

const tempDirs: string[] = [];

interface Fixture {
  root: string;
  specPath: string;
  sidecarPath: string;
}

function fixture(manifest = "+ added     src/feature.ts          - new behavior\n~ modified  src/index.ts            - route behavior\n"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "design-review-run-"));
  tempDirs.push(root);
  const specPath = join(root, "docs", "plans", "feature.md");
  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(
    specPath,
    [
      "# Feature",
      "status: design",
      "slug: feature",
      "",
      "## What",
      "Build a visible feature with observable behavior.",
      "",
      "## Acceptance criteria",
      "- [ ] The user can complete the feature flow.",
      "",
      "## Test plan",
      "- [ ] Run the feature test.",
      "",
      "## Change manifest",
      manifest,
      "",
    ].join("\n")
  );
  return { root, specPath, sidecarPath: sidecarPathForSpec(specPath) };
}

function reviewer(stdout: string, ok = true): ReviewerCommand {
  return () => ({ ok, stdout, stderr: ok ? "" : "unreachable", exitCode: ok ? 0 : 1, model: "claude-fable-5", family: "anthropic" });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("reviewer unreachable records UNREACHABLE and gate would BLOCK", async () => {
  const fx = fixture();
  const result = await runDesignReview(fx.specPath, {
    reviewer: reviewer("", false),
    now: new Date("2026-07-03T12:00:00Z"),
  });

  expect(result.exitCode).toBe(1);
  expect(result.record.verdict).toBe("UNREACHABLE");
  expect(existsSync(fx.sidecarPath)).toBe(true);

  const gate = hasValidVerdict(fx.specPath);
  expect(gate.ok).toBe(false);
  expect(gate.reason).toContain("unreachable");
});

test("verdict parse happy path extracts structured JSON", () => {
  const parsed = parseStructuredVerdict(
    'review complete\n```json\n{"verdict":"YELLOW","findings":[{"severity":"YELLOW","lens":"simplicity","fix":"Clarify the rollout note."}]}\n```'
  );

  expect(parsed).toEqual({
    verdict: "YELLOW",
    findings: [{ severity: "YELLOW", lens: "simplicity", fix: "Clarify the rollout note." }],
  });
});

test("classifyAdjustment returns A, B, and ambiguous defaults to B", () => {
  expect(classifyAdjustment("Clarify the wording in the rollback note.")).toBe("A");
  expect(classifyAdjustment("Clarify that existing behavior is unchanged.")).toBe("A");
  expect(classifyAdjustment("Remove a required acceptance criterion from the DoD.")).toBe("B");
  expect(classifyAdjustment("No behavior change, but remove a requirement.")).toBe("B");
  expect(classifyAdjustment("Tighten the thing so it feels better.")).toBe("B");
});

test("second RED writes escalation artifact and parks", async () => {
  const fx = fixture();
  writeFileSync(
    fx.sidecarPath,
    JSON.stringify(
      {
        verdict: "RED",
        findings: [{ severity: "RED", lens: "theater", fix: "Add a real behavior change." }],
        spec_sha256: sha256Text(readFileSync(fx.specPath, "utf8")),
        manifest_sha256: sha256Text("manifest"),
        reviewer_model: "claude-fable-5",
        reviewer_family: "anthropic",
        cross_family: { status: "not_required" },
        cycle: 1,
        timestamp: "2026-07-03T10:00:00Z",
      },
      null,
      2
    ) + "\n"
  );

  const result = await runDesignReview(fx.specPath, {
    reviewer: reviewer('{"verdict":"RED","findings":[{"severity":"RED","lens":"verifiability","fix":"Make the DoD objectively testable."}]}'),
    now: new Date("2026-07-03T12:00:00Z"),
  });

  expect(result.exitCode).toBe(1);
  expect(result.parked).toBe(true);
  expect(result.record.cycle).toBe(2);
  expect(result.record.escalation_artifact).toBe(result.escalationPath);
  expect(result.escalationPath).toBeTruthy();
  expect(existsSync(result.escalationPath!)).toBe(true);
  expect(readFileSync(result.escalationPath!, "utf8")).toContain("second RED");
});

test("skip-rule fires on mechanical manifest", async () => {
  const mechanical = [
    "+ added     docs/usage.md          - docs only",
    "~ modified  CHANGELOG.md           - version note",
    "~ modified  .claude-plugin/plugin.json - version bump",
  ].join("\n");
  expect(shouldSkip(mechanical)).toEqual({ skip: true, rule: "mechanical-manifest:file_count<=5" });

  const fx = fixture(mechanical);
  const result = await runDesignReview(fx.specPath, {
    reviewer: () => {
      throw new Error("reviewer should not be called for mechanical skip");
    },
    now: new Date("2026-07-03T12:00:00Z"),
  });
  expect(result.record.verdict).toBe("SKIPPED");
  expect(result.exitCode).toBe(0);
});

test("skip-rule does not fire on a feature manifest", () => {
  const featureManifest = [
    "+ added     src/feature.ts          - new behavior",
    "~ modified  src/index.ts            - public route",
    "new_public_surface: true",
    "behavior_flag: true",
  ].join("\n");

  expect(shouldSkip(featureManifest)).toEqual({ skip: false });
});
