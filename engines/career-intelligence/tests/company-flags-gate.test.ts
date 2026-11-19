import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkCompanyFlags, FLAGS_PATH, STALE_DAYS, type Flags } from "../skills/job-search-scheduler/check-company-flags";

const now = new Date("2026-11-17T00:00:00Z");
const flags: Flags = { _schema: "company-flags/v1", _updated: "2026-11-17", deprioritized: [
  { company: "OpenAI", reason: "recruiter closed door" },
  { company: "Scale AI", reason: "prior rejection" },
  { company: "Harvey AI", reason: "requires referral", action: "do_not_apply_without_referral" },
  { company: "Google", reason: "old restriction" },
], flagged: [{ company: "OpenAI", note: "ATS risk", action: "do_not_apply" }], cleared: [{ company: "Google", action: "eligible_to_apply" }] };
const roles = ["OpenAI", "OpenAI", "Scale AI", "Harvey AI", "Google", "Other"].map((company, id) => ({ company, id }));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function workspace(tree = true) {
  const root = mkdtempSync(join(tmpdir(), "scan-gate-")); roots.push(root);
  if (tree) mkdirSync(dirname(join(root, FLAGS_PATH)), { recursive: true });
  writeFileSync(join(root, "roles.json"), JSON.stringify(roles));
  return root;
}
function cli(root: string) {
  return Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../skills/job-search-scheduler/check-company-flags.ts"), "roles.json"], { cwd: root });
}

test("membership excludes without action; cleared wins; exclusions dedupe and render reasons", () => {
  const result = checkCompanyFlags(flags, roles, now);
  expect(result.kept).toEqual(roles.slice(4));
  expect(result.excluded.map(e => e.company)).toEqual(["OpenAI", "Scale AI", "Harvey AI"]);
  const report = "## Company exclusions\n" + result.excluded.map(e => `| ${e.company} | ${e.list} | ${e.reason} | ${e.action ?? "—"} |`).join("\n");
  for (const company of ["OpenAI", "Scale AI", "Harvey AI"]) expect(report).toContain(company);
  for (const reason of ["recruiter closed door", "prior rejection", "requires referral", "do_not_apply_without_referral", "ATS risk"]) expect(report).toContain(reason);
  expect(result.excluded[0].list).toBe("deprioritized, flagged");
  expect(result.excluded[0].action).toBe("do_not_apply");
  expect(result.excluded[1].action).toBeNull();
  expect(checkCompanyFlags(flags, [{company: " OPENAI "}], now).kept).toEqual([]);
});

test("30-day staleness boundary is explicit and reported", () => {
  expect(STALE_DAYS).toBe(30);
  for (const days of [29, 30, 31]) {
    const result = checkCompanyFlags({ ...flags, _updated: new Date(+now - days * 86400000).toISOString() }, roles, now);
    expect(result.warnings.length).toBe(days > STALE_DAYS ? 1 : 0);
    if (days > STALE_DAYS) expect(result.warnings[0]).toContain(`${STALE_DAYS} days`);
  }
});

test("bootstrap is reported, persisted, empty, and idempotent", () => {
  const root = workspace(); const first = cli(root);
  expect(first.exitCode).toBe(0);
  const result = JSON.parse(first.stdout.toString());
  expect(result.bootstrapped).toBe(true);
  expect(result.notices.join(" ")).toContain("Bootstrapped");
  expect(result.kept).toEqual(roles); expect(result.excluded).toEqual([]); expect(result.warnings).toEqual([]);
  const content = readFileSync(join(root, FLAGS_PATH), "utf8");
  expect(JSON.parse(content)).toMatchObject({ _schema: "company-flags/v1", deprioritized: [], flagged: [], cleared: [], warm_referral_active: [] });
  expect(cli(root).exitCode).toBe(0);
  expect(readFileSync(join(root, FLAGS_PATH), "utf8")).toBe(content);
  expect(JSON.parse(cli(root).stdout.toString()).bootstrapped).toBe(false);
});

test("bad workspace and malformed file fail with path and fix; never erase data", () => {
  const wrong = workspace(false); const missing = cli(wrong);
  expect(missing.exitCode).not.toBe(0);
  expect(missing.stderr.toString()).toContain(resolve(wrong, FLAGS_PATH));
  expect(missing.stderr.toString()).toContain("workspace root");
  expect(existsSync(join(wrong, FLAGS_PATH))).toBe(false);
  const root = workspace(); writeFileSync(join(root, FLAGS_PATH), "{broken");
  const bad = cli(root); expect(bad.exitCode).not.toBe(0);
  expect(bad.stderr.toString()).toContain(join(root, FLAGS_PATH));
  expect(bad.stderr.toString()).toContain("Fix");
  expect(readFileSync(join(root, FLAGS_PATH), "utf8")).toBe("{broken");
});

test("invalid schemas and candidate inputs cannot silently bypass gate", () => {
  expect(() => checkCompanyFlags({ ...flags, flagged: null } as any, roles)).toThrow();
  expect(() => checkCompanyFlags(flags, [{}] as any)).toThrow();
});

test("migration verifies directory, preserves data, stamps only on success", () => {
  const root = workspace(); const state = join(root, "runtime");
  const run = (workspaceRoot: string) => Bun.spawnSync(["bash", resolve(import.meta.dir, "../migrations/migrate.sh"), workspaceRoot, "1.0.2", "2.0.0"], { env: { ...process.env, CLAUDE_PLUGIN_DATA: state } });
  const bad = run(join(root, "absent")); expect(bad.exitCode).not.toBe(0);
  expect(bad.stderr.toString()).toContain("career-intelligence/projects/job-search/");
  expect(bad.stderr.toString()).toContain("Fix:"); expect(existsSync(join(state, "version"))).toBe(false);
  const good = run(root); expect(good.exitCode).toBe(0);
  expect(readFileSync(join(state, "version"), "utf8")).toBe("2.0.0\n");
  expect(existsSync(join(root, FLAGS_PATH))).toBe(false);
  expect(run(root).exitCode).toBe(0);
});

// Shared scan vocabulary: both structural and absorption checks import this binding.
export const SCAN_SPEC_MARKERS = ["LINKEDIN_MCP_OK", "MCP BUDGET", "Source A0", "400-applicant", "200 roles", "30 per keyword"] as const;
