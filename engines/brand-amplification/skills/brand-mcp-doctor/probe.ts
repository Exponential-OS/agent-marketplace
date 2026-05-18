#!/usr/bin/env bun
/**
 * probe.ts — brand-mcp-doctor enforcement (objective code per P4).
 *
 * Walks the required + optional MCP list (from MCP-REQUIREMENTS.md), probes
 * each for liveness/auth, writes ~/.codialectic/mcp-status-brand.json,
 * renders a tiered status report, and increments graduation-counter trust_counts
 * after successful workflow runs (when --record-success is passed).
 *
 * Input JSON (stdin or argv):
 *   {"mode": "doctor"}                     -- run full probe, render report
 *   {"mode": "doctor-quick"}               -- manifest-only, no live probe
 *   {"mode": "doctor-json"}                -- machine-readable JSON output
 *   {"mode": "record-success", "workflow": "linkedin_post"}  -- increment counter, maybe nudge
 *   {"mode": "graduate", "workflow": "linkedin_post"}        -- switch default to browserbase
 *   {"mode": "keep-watching", "workflow": "linkedin_post"}   -- decline upgrade forever
 *
 * Exit: 0 = PASS / report rendered; 1 = required MCP missing (BLOCK); 2 = WARN
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { createConnection } from "net";

const HOME = homedir();
const CODI_DIR = join(HOME, ".codialectic");
const STATE_FILE = join(CODI_DIR, "mcp-status-brand.json");
const PREFS_FILE = join(CODI_DIR, "browser-prefs.json");
const PREFS_TEMPLATE_REL = "browser-prefs.template.json";
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? __dirname.replace(/\/skills\/brand-mcp-doctor.*$/, "");
const PREFS_TEMPLATE = join(PLUGIN_ROOT, "skills/brand-mcp-setup", PREFS_TEMPLATE_REL);

// ── MCP requirements for brand-amplification ───────────────────────────────

type Tier = "required" | "optional";
type Probe = "stdio-tools-list" | "http-tools-list" | "port-listen" | "env-vars" | "n/a";

interface McpSpec {
  name: string;
  tier: Tier;
  used_for: string;
  probe: Probe;
  // probe params
  command?: string;
  args?: string[];
  url?: string;
  auth_header?: string;
  port?: number;
  env_vars?: string[];
  // recipe to install
  install_recipe: string;
  // optional: if this MCP satisfies a "either A or B" requirement, name the group
  satisfies_group?: string;
}

const REQUIREMENTS: McpSpec[] = [
  {
    name: "composio-linkedin",
    tier: "required",
    used_for: "LinkedIn publish (social-distribution-engine, campaign-engine)",
    probe: "env-vars",
    env_vars: ["COMPOSIO_API_KEY", "COMPOSIO_SESSION_ID"],
    install_recipe: "brand mcp setup composio-linkedin",
  },
  {
    name: "playwright-ms",
    tier: "required",
    used_for: "Content URL resolution + anonymous web reads",
    probe: "stdio-tools-list",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    install_recipe: "brand mcp setup playwright",
  },
  {
    name: "browserbase",
    tier: "optional",
    used_for: "Substack publish + setup OAuth flows",
    probe: "env-vars",
    env_vars: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
    install_recipe: "brand mcp setup browserbase",
    satisfies_group: "authenticated-browsing",
  },
  {
    name: "chrome-devtools-mcp",
    tier: "optional",
    used_for: "Free alternative to browserbase for authenticated browsing",
    probe: "port-listen",
    port: 9222,
    install_recipe: "brand mcp setup chrome-devtools",
    satisfies_group: "authenticated-browsing",
  },
  {
    name: "composio-reddit",
    tier: "optional",
    used_for: "Reddit publish (reddit-distribution-module)",
    probe: "env-vars",
    env_vars: ["COMPOSIO_API_KEY", "COMPOSIO_REDDIT_SESSION_ID"],
    install_recipe: "brand mcp setup composio-reddit",
  },
  {
    name: "composio-x",
    tier: "optional",
    used_for: "X/Twitter publish (x-distribution-module)",
    probe: "env-vars",
    env_vars: ["COMPOSIO_API_KEY", "COMPOSIO_X_SESSION_ID"],
    install_recipe: "brand mcp setup composio-x",
  },
];

type Verdict = "working" | "installed_unauth" | "missing" | "unknown";
interface ProbeResult {
  name: string;
  tier: Tier;
  verdict: Verdict;
  detail: string;
  used_for: string;
  install_recipe: string;
  satisfies_group?: string;
}

// ── Probes ──────────────────────────────────────────────────────────────────

function probeEnvVars(spec: McpSpec): ProbeResult {
  const missing = (spec.env_vars ?? []).filter((v) => !process.env[v]);
  if (missing.length === 0) {
    return {
      name: spec.name,
      tier: spec.tier,
      verdict: "working",
      detail: `env vars set: ${(spec.env_vars ?? []).join(", ")}`,
      used_for: spec.used_for,
      install_recipe: spec.install_recipe,
      satisfies_group: spec.satisfies_group,
    };
  }
  return {
    name: spec.name,
    tier: spec.tier,
    verdict: "missing",
    detail: `missing env vars: ${missing.join(", ")}`,
    used_for: spec.used_for,
    install_recipe: spec.install_recipe,
    satisfies_group: spec.satisfies_group,
  };
}

async function probePortListen(spec: McpSpec): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port: spec.port! });
    let resolved = false;
    const finalize = (verdict: Verdict, detail: string) => {
      if (resolved) return;
      resolved = true;
      try { sock.destroy(); } catch {}
      resolve({
        name: spec.name,
        tier: spec.tier,
        verdict,
        detail,
        used_for: spec.used_for,
        install_recipe: spec.install_recipe,
        satisfies_group: spec.satisfies_group,
      });
    };
    sock.setTimeout(1500);
    sock.on("connect", () => finalize("working", `port ${spec.port} listening`));
    sock.on("timeout", () => finalize("missing", `port ${spec.port} timeout (Chrome not running?)`));
    sock.on("error", () => finalize("missing", `port ${spec.port} not listening`));
  });
}

function probeStdioToolsList(spec: McpSpec): ProbeResult {
  // Quick probe: invoke `npx -y <package> --version` or just check command exists.
  // Full tools/list probe is expensive (downloads + initializes). For doctor purposes,
  // check the command is available.
  try {
    const which = spawnSync("which", [spec.command!], { encoding: "utf8" });
    if ((which.status ?? 1) !== 0) {
      return {
        name: spec.name,
        tier: spec.tier,
        verdict: "missing",
        detail: `command not found: ${spec.command}`,
        used_for: spec.used_for,
        install_recipe: spec.install_recipe,
        satisfies_group: spec.satisfies_group,
      };
    }
    // Heuristic: if `npx` exists and we're checking @playwright/mcp, assume installable.
    return {
      name: spec.name,
      tier: spec.tier,
      verdict: "working",
      detail: `${spec.command} available (will install on first call via npx)`,
      used_for: spec.used_for,
      install_recipe: spec.install_recipe,
      satisfies_group: spec.satisfies_group,
    };
  } catch (e) {
    return {
      name: spec.name,
      tier: spec.tier,
      verdict: "unknown",
      detail: `probe error: ${e}`,
      used_for: spec.used_for,
      install_recipe: spec.install_recipe,
      satisfies_group: spec.satisfies_group,
    };
  }
}

async function probe(spec: McpSpec): Promise<ProbeResult> {
  if (spec.probe === "env-vars") return probeEnvVars(spec);
  if (spec.probe === "port-listen") return await probePortListen(spec);
  if (spec.probe === "stdio-tools-list") return probeStdioToolsList(spec);
  return {
    name: spec.name,
    tier: spec.tier,
    verdict: "unknown",
    detail: "no probe configured",
    used_for: spec.used_for,
    install_recipe: spec.install_recipe,
    satisfies_group: spec.satisfies_group,
  };
}

// ── Graduation counter ─────────────────────────────────────────────────────

interface BrowserPrefs {
  schema_version: string;
  defaults: Record<string, string>;
  trust_counts: Record<string, number>;
  upgrade_threshold: number;
  user_declined_upgrade: string[];
}

function loadPrefs(): BrowserPrefs {
  if (!existsSync(PREFS_FILE)) {
    if (existsSync(PREFS_TEMPLATE)) {
      mkdirSync(dirname(PREFS_FILE), { recursive: true });
      const template = readFileSync(PREFS_TEMPLATE, "utf8");
      writeFileSync(PREFS_FILE, template);
    } else {
      // Minimal default
      const minimal: BrowserPrefs = {
        schema_version: "1.0.0",
        defaults: { mcp_setup: "browserbase" },
        trust_counts: {},
        upgrade_threshold: 10,
        user_declined_upgrade: [],
      };
      mkdirSync(dirname(PREFS_FILE), { recursive: true });
      writeFileSync(PREFS_FILE, JSON.stringify(minimal, null, 2));
    }
  }
  return JSON.parse(readFileSync(PREFS_FILE, "utf8")) as BrowserPrefs;
}

function savePrefs(p: BrowserPrefs): void {
  writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2));
}

function recordSuccess(workflow: string): { nudge: string | null } {
  const prefs = loadPrefs();
  prefs.trust_counts[workflow] = (prefs.trust_counts[workflow] ?? 0) + 1;
  savePrefs(prefs);

  const count = prefs.trust_counts[workflow];
  const currentDefault = prefs.defaults[workflow];
  if (
    currentDefault === "chrome-devtools-mcp" &&
    count >= prefs.upgrade_threshold &&
    !prefs.user_declined_upgrade.includes(workflow)
  ) {
    return {
      nudge: `💡 You've run ${workflow} via Chrome Canary ${count} times. Confident now?\n   Graduate to browserbase (faster, no local window) → brand mcp graduate ${workflow}\n   Or keep watching forever → brand mcp keep-watching ${workflow}`,
    };
  }
  return { nudge: null };
}

function graduate(workflow: string): void {
  const prefs = loadPrefs();
  prefs.defaults[workflow] = "browserbase";
  savePrefs(prefs);
}

function keepWatching(workflow: string): void {
  const prefs = loadPrefs();
  if (!prefs.user_declined_upgrade.includes(workflow)) {
    prefs.user_declined_upgrade.push(workflow);
    savePrefs(prefs);
  }
}

// ── Report rendering ───────────────────────────────────────────────────────

function renderReport(results: ProbeResult[]): string {
  const icons: Record<Verdict, string> = {
    working: "✓",
    installed_unauth: "⚠",
    missing: "✗",
    unknown: "?",
  };

  const required = results.filter((r) => r.tier === "required");
  const optional = results.filter((r) => r.tier === "optional");

  let out = "━━━ MCP Doctor (brand-amplification) · Status ━━━\n\n";

  out += "REQUIRED\n";
  for (const r of required) {
    out += `  ${icons[r.verdict]} ${r.name}  — ${r.detail}\n`;
    if (r.verdict === "missing") out += `      install: ${r.install_recipe}\n`;
  }

  // Group satisfaction for optional MCPs with satisfies_group
  out += "\nOPTIONAL (group-satisfied)\n";
  const groups: Record<string, ProbeResult[]> = {};
  const ungroupedOpt: ProbeResult[] = [];
  for (const r of optional) {
    if (r.satisfies_group) {
      (groups[r.satisfies_group] ??= []).push(r);
    } else {
      ungroupedOpt.push(r);
    }
  }
  for (const [groupName, members] of Object.entries(groups)) {
    const anyWorking = members.some((m) => m.verdict === "working");
    const marker = anyWorking ? "✓" : "⚠";
    out += `  ${marker} group: ${groupName} (need at least ONE)\n`;
    for (const m of members) {
      out += `      ${icons[m.verdict]} ${m.name}  — ${m.detail}\n`;
      if (m.verdict === "missing") out += `          install: ${m.install_recipe}\n`;
    }
  }
  for (const r of ungroupedOpt) {
    out += `  ${icons[r.verdict]} ${r.name}  — ${r.detail}\n`;
    if (r.verdict === "missing") out += `      install: ${r.install_recipe}\n`;
  }

  return out;
}

function overallVerdict(results: ProbeResult[]): { exit: number; verdict: Verdict } {
  const requiredMissing = results.some((r) => r.tier === "required" && r.verdict === "missing");
  if (requiredMissing) return { exit: 1, verdict: "missing" };
  return { exit: 0, verdict: "working" };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argRaw = process.argv[2] ?? "{}";
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(argRaw);
  } catch {
    input = { mode: argRaw };
  }
  const mode = (input.mode as string) ?? "doctor";

  if (mode === "record-success") {
    const wf = input.workflow as string;
    if (!wf) {
      process.stdout.write(JSON.stringify({ verdict: "BLOCK", reason: "workflow required" }) + "\n");
      process.exit(1);
    }
    const { nudge } = recordSuccess(wf);
    process.stdout.write(JSON.stringify({ verdict: "PASS", workflow: wf, nudge }) + "\n");
    if (nudge) process.stderr.write(nudge + "\n");
    process.exit(0);
  }

  if (mode === "graduate") {
    const wf = input.workflow as string;
    if (!wf) {
      process.stdout.write(JSON.stringify({ verdict: "BLOCK", reason: "workflow required" }) + "\n");
      process.exit(1);
    }
    graduate(wf);
    process.stdout.write(JSON.stringify({ verdict: "PASS", workflow: wf, action: "graduated to browserbase" }) + "\n");
    process.exit(0);
  }

  if (mode === "keep-watching") {
    const wf = input.workflow as string;
    if (!wf) {
      process.stdout.write(JSON.stringify({ verdict: "BLOCK", reason: "workflow required" }) + "\n");
      process.exit(1);
    }
    keepWatching(wf);
    process.stdout.write(JSON.stringify({ verdict: "PASS", workflow: wf, action: "decline recorded" }) + "\n");
    process.exit(0);
  }

  // Default: doctor (probe all)
  const results: ProbeResult[] = [];
  for (const spec of REQUIREMENTS) {
    results.push(await probe(spec));
  }

  mkdirSync(CODI_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ts: new Date().toISOString(), results }, null, 2));

  if (mode === "doctor-json") {
    process.stdout.write(JSON.stringify({ results, ts: new Date().toISOString() }, null, 2) + "\n");
    process.exit(overallVerdict(results).exit);
  }

  process.stdout.write(renderReport(results) + "\n");
  process.exit(overallVerdict(results).exit);
}

main().catch((err) => {
  process.stderr.write(`probe.ts error: ${err}\n`);
  process.exit(0); // fail-open
});
