import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const FLAGS_PATH = "career-intelligence/projects/job-search/company-flags.json";
export const STALE_DAYS = 30;
export type Role = { company: string; [key: string]: unknown };
type Flag = { company: string; reason?: string; note?: string; action?: string };
export type Flags = { _schema: string; _updated: string; deprioritized: Flag[]; flagged: Flag[]; cleared: Flag[] };
const key = (company: string) => company.trim().toLowerCase();

export function checkCompanyFlags(flags: Flags, roles: Role[], now = new Date()) {
  if (flags?._schema !== "company-flags/v1" || !Number.isFinite(Date.parse(flags._updated)) ||
      ![flags.deprioritized, flags.flagged, flags.cleared].every(list => Array.isArray(list) && list.every(f => typeof f?.company === "string" && f.company.trim()))) {
    throw new Error("Invalid company-flags/v1: restore _updated and the deprioritized, flagged, cleared company lists.");
  }
  if (!Array.isArray(roles) || roles.some(role => typeof role?.company !== "string" || !role.company.trim())) {
    throw new Error("Invalid roles: supply a JSON array with a company on every role.");
  }
  const cleared = new Set(flags.cleared.map(f => key(f.company)));
  const blocked = new Map<string, { company: string; list: string; reason: string; action: string | null }>();
  for (const list of ["deprioritized", "flagged"] as const) {
    for (const entry of flags[list]) {
      if (cleared.has(key(entry.company))) continue;
      const previous = blocked.get(key(entry.company));
      const action = entry.action ?? previous?.action ?? null;
      blocked.set(key(entry.company), {
        company: entry.company,
        list: previous ? `${previous.list}, ${list}` : list,
        reason: [previous?.reason, entry.reason ?? entry.note ?? `Member of ${list}`, entry.action].filter(Boolean).join("; "),
        action,
      });
    }
  }
  const candidates = new Set(roles.map(role => key(role.company)));
  const warnings: string[] = [];
  if (now.getTime() - Date.parse(flags._updated) > STALE_DAYS * 86400000) warnings.push(`company-flags.json is more than ${STALE_DAYS} days old; review exclusions and refresh _updated.`);
  return {
    kept: roles.filter(role => !blocked.has(key(role.company))),
    excluded: [...blocked.entries()].filter(([name]) => candidates.has(name)).map(([, entry]) => entry),
    warnings,
  };
}

if (import.meta.main) {
  const path = resolve(FLAGS_PATH);
  try {
    if (!existsSync(dirname(path))) throw new Error(`Missing ${dirname(path)}. Run from the workspace root and restore career-intelligence/projects/job-search/ before scanning.`);
    const roles = JSON.parse(readFileSync(process.argv[2] ?? 0, "utf8"));
    let bootstrapped = false;
    if (!existsSync(path)) {
      const empty = { _schema: "company-flags/v1", _updated: new Date().toISOString().slice(0, 10), deprioritized: [], flagged: [], cleared: [], warm_referral_active: [] };
      writeFileSync(path, JSON.stringify(empty, null, 2) + "\n", { flag: "wx" });
      bootstrapped = true;
    }
    const result = checkCompanyFlags(JSON.parse(readFileSync(path, "utf8")), roles);
    console.log(JSON.stringify({ ...result, bootstrapped, notices: bootstrapped ? [`Bootstrapped ${FLAGS_PATH}; no companies flagged yet.`] : [] }, null, 2));
  } catch (error) {
    console.error(`Company flags gate failed at ${path}: ${error instanceof Error ? error.message : error} Fix the file/roles JSON and run from the workspace root; do not publish ungated results.`);
    process.exitCode = 1;
  }
}
