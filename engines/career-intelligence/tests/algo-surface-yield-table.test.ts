import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALGO_SURFACES, checkYieldTable } from "../skills/job-search-scheduler/check-yield-table";
import { skillDir, importsBinding } from "./scan-spec-single-source.test";

const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const template = skill.match(/```markdown\n(## ALGO SURFACES[\s\S]*?)```/)![1];

test("all absorbed capabilities are present", () => {
  for (const marker of SCAN_SPEC_MARKERS) expect(skill).toContain(marker);
});

test("rendered surface roster equals module enumeration in both directions", () => {
  const roster = skill.split("### ALGO SURFACES —")[1].split("For every surface,")[0];
  const names = [...roster.matchAll(/^\| ([^|]+) \|/gm)].map(m => m[1].trim()).filter(n => n !== "Surface");
  expect(names.sort()).toEqual([...ALGO_SURFACES].sort());
  const templateNames = template.split("\n").filter(l => /^\| [^|]+ \| \d/.test(l)).map(l => l.split("|")[1].trim());
  expect(templateNames.sort()).toEqual([...ALGO_SURFACES].sort());
});

test("report fixture is complete; every missing or invalid row is rejected", () => {
  expect(checkYieldTable(template)).toEqual({ complete: true, missing: [] });
  for (const surface of ALGO_SURFACES) {
    const without = template.split("\n").filter(l => !l.startsWith(`| ${surface} |`)).join("\n");
    expect(checkYieldTable(without)).toEqual({ complete: false, missing: [surface] });
  }
  expect(checkYieldTable(template.replaceAll("| 0 |", "| unknown |" )).complete).toBe(false);
  expect(checkYieldTable("## Notes\n" + template.split("\n").slice(1).join("\n")).complete).toBe(false);
});

test("surface tests import enumeration, never maintain their own", () => {
  const source = readFileSync(import.meta.path, "utf8");
  expect(importsBinding(source, "ALGO_SURFACES", "../skills/job-search-scheduler/check-yield-table")).toBe(true);
  expect(importsBinding('const ALGO_SURFACES = ["fake"];', "ALGO_SURFACES", "../skills/job-search-scheduler/check-yield-table")).toBe(false);
});

test("yield CLI fails closed and explains remediation", () => {
  const p = Bun.spawnSync([process.execPath, join(skillDir, "check-yield-table.ts"), "/nonexistent/scan.md"]);
  expect(p.exitCode).not.toBe(0);
  expect(p.stderr.toString()).toContain("Yield table gate failed");
});

import { SCAN_SPEC_MARKERS } from "./company-flags-gate.test";
