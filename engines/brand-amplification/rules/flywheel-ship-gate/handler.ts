#!/usr/bin/env bun
/**
 * handler.ts — FLYWHEEL-SHIP gate (per-STEP, execution-time).
 *
 * XOS-240: this rule lives HERE, in the plugin, and nowhere else. It briefly
 * existed in BOTH ~/cyborg/rules/ (as handler.ts) and a proposed PR as HOW.py —
 * two enforcement paths for one slug, which the signal-pollution invariant
 * forbids: a rule that runs from two places can disagree with itself, and fixing
 * one copy silently leaves the other wrong. The plugin is the SHIPPED tier
 * (rule lifecycle: staging -> in-build -> shipped), so the cyborg copy was
 * deleted rather than kept in sync. P4 also bans HOW.py; the invariant layer is
 * TypeScript via Bun.
 *
 * campaign-completeness gates the PLAN: does the campaign master enumerate every
 * surface. Nothing gated EXECUTION — whether each in-scope surface actually
 * shipped, carries a URL, and that URL is live. So a campaign could be declared
 * "complete" with a requested element missing and every surface unverified.
 *
 * Origin: 2026-08-16, campaign 12 (token-yield). The agent declared the flywheel
 * finished while a requested deliverable (article thumbnails) had never shipped,
 * and while surface statuses in the campaign master still read TODO for surfaces
 * that were live. Nothing caught either.
 *
 * Rule: for every surface marked in-scope, require BOTH a terminal status AND a
 * URL, and verify the URL responds. Any in-scope surface that is unshipped,
 * URL-less, or dead BLOCKS the "campaign complete" claim.
 *
 * Input JSON (stdin or argv):
 *   { "target": "/abs/path/campaign-master.md",
 *     "claim": "complete" | "in-progress",     // default "complete"
 *     "skip_http": true|false }                // default false
 *
 * Exit: 0=PASS, 1=BLOCK, 2=WARN
 */
import { existsSync, readFileSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SLUG = "flywheel-ship-gate";
const LOG_PATH = join(process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), ".career-os-state"), "enforcement-log.jsonl");
type Verdict = "PASS" | "WARN" | "BLOCK";

const SHIPPED = /(✅|LIVE|POSTED|PUBLISHED|SHIPPED|DONE|SENT)/i;
const PENDING = /(⬜|TODO|PENDING|QUEUED|DRAFT|WIP|⏳|NOT STARTED)/i;
const OMITTED = /(N\/A|SKIP|OUT OF SCOPE|OMITTED|—\s*$)/i;

function readInput(): any {
  const argv = process.argv.slice(2).join(" ").trim();
  if (argv) { try { return JSON.parse(argv); } catch { return { target: argv }; } }
  return {};
}

function emit(verdict: Verdict, reason: string, findings: any[], remediation?: string) {
  const out: any = { verdict, rule_slug: SLUG, reason, findings };
  if (remediation) out.remediation = remediation;
  console.log(JSON.stringify(out, null, 2));
  try {
    appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), slug: SLUG, verdict, count: findings.length }) + "\n");
  } catch {}
  process.exit(verdict === "BLOCK" ? 1 : verdict === "WARN" ? 2 : 0);
}

const input = readInput();
const target = input.target;
const claim = (input.claim ?? "complete").toLowerCase();

if (!target || !existsSync(target)) {
  emit("BLOCK", `Campaign master not found: ${target ?? "(none supplied)"}`, [],
       `Pass an existing campaign-master path: bun run ${__filename} '{"target":"/abs/path/campaign-master.md"}'`);
}

const text = readFileSync(target, "utf8");
const rows = text.split("\n").filter(l => l.trim().startsWith("|") && l.split("|").length >= 4);

if (rows.length === 0) {
  emit("BLOCK", "No surface table found in campaign master.", [],
       "Add a Surface Coverage Matrix table (see campaign-completeness gate).");
}

const findings: any[] = [];
const urlRe = /https?:\/\/[^\s|)\]]+/;
let inScope = 0;

for (const row of rows) {
  const cells = row.split("|").map(c => c.trim()).filter(Boolean);
  if (cells.length < 3) continue;
  const joined = cells.join(" | ");
  if (/^#?\s*\|?\s*Surface/i.test(joined) || /^-+$/.test(cells[0])) continue;  // header/sep
  if (OMITTED.test(joined) && !SHIPPED.test(joined)) continue;                  // documented omission
  const surface = cells[1] ?? cells[0];
  if (!surface || surface.length > 90) continue;
  inScope++;

  const shipped = SHIPPED.test(joined);
  const pending = PENDING.test(joined);
  const url = joined.match(urlRe)?.[0];

  if (pending && !shipped) {
    findings.push({ surface, issue: "still pending", detail: "status reads TODO/PENDING while campaign is claimed complete" });
  } else if (shipped && !url) {
    findings.push({ surface, issue: "shipped without URL", detail: "no verifiable URL recorded — 'it shipped' is unfalsifiable" });
  } else if (!shipped && !pending) {
    findings.push({ surface, issue: "no terminal status", detail: "neither shipped nor explicitly pending/omitted" });
  }
}

if (inScope === 0) emit("BLOCK", "Surface table parsed but no in-scope surfaces recognised.", [],
                        "Check the table has a Surface column and status values.");

// live-check recorded URLs
if (!input.skip_http) {
  const urls = [...new Set(rows.join("\n").match(new RegExp(urlRe.source, "g")) ?? [])].slice(0, 30);
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!r.ok) findings.push({ surface: u, issue: `dead link (HTTP ${r.status})`, detail: "a recorded surface URL does not resolve" });
    } catch (e: any) {
      findings.push({ surface: u, issue: "unreachable", detail: String(e?.message ?? e).slice(0, 90) });
    }
  }
}

if (findings.length === 0) {
  emit("PASS", `All ${inScope} in-scope surfaces shipped with a live URL.`, []);
}

if (claim !== "complete") {
  emit("WARN", `${findings.length} surface(s) incomplete — acceptable mid-campaign, BLOCKING once you claim complete.`, findings);
}

emit("BLOCK",
  `${findings.length} of ${inScope} in-scope surfaces are not verifiably shipped — the campaign cannot be called complete.`,
  findings,
  "Ship each surface, record its URL in the campaign master, and re-run. A surface with no URL is not shipped, it is remembered.");
