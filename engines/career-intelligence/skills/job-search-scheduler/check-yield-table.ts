import { readFileSync } from "node:fs";

export const ALGO_SURFACES = ["LinkedIn Saved", "LinkedIn Recommended", "LinkedIn Search", "ATS Direct"] as const;

export function checkYieldTable(report: string, surfaces: readonly string[] = ALGO_SURFACES) {
  const section = report.match(/^## ALGO SURFACES\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? "";
  const rows = section.split("\n").filter(line => line.trim().startsWith("|"))
    .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
  const missing = surfaces.filter(surface => !rows.some(row => row[0] === surface && row.length === 5 &&
    /^\d+$/.test(row[1]) && /^\d+$/.test(row[2]) && /^\d+$/.test(row[3]) && row[4].length > 0));
  return { complete: missing.length === 0, missing };
}

if (import.meta.main) {
  try {
    if (!process.argv[2]) throw new Error("Supply the scan report path.");
    const result = checkYieldTable(readFileSync(process.argv[2], "utf8"));
    console.log(JSON.stringify(result));
    if (!result.complete) throw new Error(`Missing valid yield rows: ${result.missing.join(", ")}. Add each row with listed/new/excluded counts and status (including unavailable reasons).`);
  } catch (error) {
    console.error(`Yield table gate failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
