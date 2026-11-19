import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { SCAN_SPEC_MARKERS } from "./company-flags-gate.test";
export const skillDir = resolve(import.meta.dir, "../skills/job-search-scheduler");
export function duplicateSpecs(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return duplicateSpecs(path);
    if (path === join(skillDir, "SKILL.md")) return [];
    return SCAN_SPEC_MARKERS.some(marker => readFileSync(path, "utf8").includes(marker)) ? [path] : [];
  });
}

// Keep the provenance check callable on fixture source: mutation runs never edit tests.
export function importsBinding(source: string, binding: string, module: string): boolean {
  return new RegExp(`import\\s*\\{[^}]*\\b${binding}\\b[^}]*\\}\\s*from\\s*["']${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(source) &&
    !new RegExp(`^\\s*(?:const|let|var)\\s+${binding}\\s*=`, "m").test(source);
}

test("one scan spec and no retired file", () => {
  expect(duplicateSpecs(skillDir)).toEqual([]);
  expect(readdirSync(skillDir)).not.toContain("scan-prompt-v11.md");
});

test("workspace data paths never use environment roots or obsolete instructions", () => {
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  expect(skill).not.toMatch(/\$\{?[A-Z_][A-Z_0-9]*\}?\//);
  expect(skill).not.toMatch(/first 20|paste (the )?prompt|paste into|scan-prompt-v11/i);
  expect(skill).toContain("check-company-flags.ts <candidate-roles.json>");
  expect(skill).toContain("check-yield-table.ts <scan-report.md>");
});

test("capability check imports the shared marker binding", () => {
  for (const file of ["scan-spec-single-source.test.ts", "algo-surface-yield-table.test.ts"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(importsBinding(source, "SCAN_SPEC_MARKERS", "./company-flags-gate.test")).toBe(true);
  }
  expect(importsBinding('const SCAN_SPEC_MARKERS = ["fake"];', "SCAN_SPEC_MARKERS", "./company-flags-gate.test")).toBe(false);
});

test("CI runs Bun as a hard gate and versions agree", () => {
  const ci = readFileSync(resolve(skillDir, "../../.github/workflows/career-os-ci.yml"), "utf8");
  expect(ci).toContain("uses: oven-sh/setup-bun@");
  const step = ci.split("\n").find(line => line.includes("run: bun test tests/"));
  expect(step).toBeDefined(); expect(step).not.toContain("|| true");
  expect(ci).not.toContain("CAREER_OS_HOME");
  expect(JSON.parse(readFileSync(resolve(skillDir, "../../.claude-plugin/plugin.json"), "utf8")).version).toBe("2.0.0");
});
