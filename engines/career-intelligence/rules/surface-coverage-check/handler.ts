import Bun from "bun";
import * as fs from "fs";
import * as path from "path";

interface CampaignContext {
  campaign_file: string;
  handles_file?: string;
}

interface OutResponse {
  status: "pass" | "block" | "warn";
  missing_surfaces: string[];
  skipped: Array<{ platform: string; reason?: string }>;
  message: string;
}

// Platforms extractable from handles.md Primary table — maps handles.md platform name → normalized key
const HANDLES_PLATFORM_MAP: Record<string, string> = {
  linkedin: "linkedin",
  substack: "substack",
  "x / twitter": "x",
  x: "x",
  twitter: "x",
  instagram: "instagram",
  facebook: "facebook",
  // GitHub and Website are not distribution surfaces for campaigns
};

// Platforms that are always part of the Estate Model distribution
const DISTRIBUTION_SURFACES = new Set(["substack", "linkedin", "x", "instagram", "facebook"]);

async function logToEnforcementLog(entry: Record<string, unknown>) {
  const logPath = `${process.env.HOME}/.career-os-enforcement-log.jsonl`;
  const line = JSON.stringify(entry) + "\n";
  await Bun.write(logPath, line, { append: true });
}

function out(
  code: 0 | 1 | 2,
  status: "pass" | "block" | "warn",
  missing: string[],
  skipped: Array<{ platform: string; reason?: string }>,
  message: string
): never {
  const response: OutResponse = { status, missing_surfaces: missing, skipped, message };
  console.log(JSON.stringify(response));

  logToEnforcementLog({
    timestamp: new Date().toISOString(),
    status,
    missing_surfaces: missing,
    skipped,
    message,
    rule: "surface-coverage-check",
  }).catch(() => {});

  process.exit(code);
}

function parseHandlesPlatforms(mdText: string): Set<string> {
  const platforms = new Set<string>();
  let inPrimary = false;
  for (const line of mdText.split("\n")) {
    if (line.includes("## Primary")) {
      inPrimary = true;
      continue;
    }
    if (inPrimary && line.startsWith("##")) {
      break;
    }
    if (inPrimary && line.includes("|")) {
      const cols = line
        .split("|")
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c.length > 0);
      if (cols.length > 0 && !["platform", "---", ":---:", "---:"].includes(cols[0])) {
        const raw = cols[0].replace(/^\*+|`+$/g, "");
        for (const [key, slug] of Object.entries(HANDLES_PLATFORM_MAP)) {
          if (raw.includes(key)) {
            platforms.add(slug);
            break;
          }
        }
      }
    }
  }
  return new Set([...platforms].filter((p) => DISTRIBUTION_SURFACES.has(p)));
}

async function main() {
  let argVal = Bun.argv[2];

  // Handle stdin sentinel
  if (argVal === undefined || argVal === "-") {
    const stdinText = await new Response(Bun.stdin).text();
    argVal = stdinText.trim();
  }

  if (!argVal) {
    out(2, "warn", [], [], "No input provided.");
  }

  let ctx: CampaignContext;
  try {
    ctx = JSON.parse(argVal!);
  } catch (e) {
    out(1, "block", [], [], `Invalid JSON: ${String(e)}`);
  }

  const campaignFile = ctx.campaign_file || "";
  if (!campaignFile) {
    out(2, "warn", [], [], "campaign_file is required.");
  }

  let handlesFile = ctx.handles_file || "";
  if (!handlesFile) {
    const careerHome = process.env.CAREER_HOME || process.env.CAREER_OS_HOME || `${process.env.HOME}/anand-career-os`;
    handlesFile = `${careerHome}/brain/identity/handles.md`;
  }

  const handlesPath = handlesFile;
  if (!fs.existsSync(handlesPath)) {
    out(2, "warn", [], [], `handles.md not found: ${handlesFile}`);
  }

  const campaignPath = campaignFile;
  if (!fs.existsSync(campaignPath)) {
    out(2, "warn", [], [], `campaign.json not found: ${campaignFile}`);
  }

  let campaign: Record<string, unknown>;
  try {
    const campaignContent = fs.readFileSync(campaignPath, "utf-8");
    campaign = JSON.parse(campaignContent);
  } catch (e) {
    out(2, "warn", [], [], `Cannot parse campaign.json: ${String(e)}`);
  }

  let handlesMd: string;
  try {
    handlesMd = fs.readFileSync(handlesPath, "utf-8");
  } catch (e) {
    out(2, "warn", [], [], `Cannot read handles.md: ${String(e)}`);
  }

  const canonicalSurfaces = parseHandlesPlatforms(handlesMd);

  // Build set of platforms covered by campaign (source + hub + spokes)
  const coveredPlatforms = new Set<string>();
  const source = (campaign.source as Record<string, unknown>) || {};
  if (source.platform) {
    coveredPlatforms.add(String(source.platform).toLowerCase());
  }

  const hub = (campaign.hub as Record<string, unknown>) || {};
  if (hub.platform) {
    coveredPlatforms.add(String(hub.platform).toLowerCase());
  }

  const spokes = (campaign.spokes as Record<string, unknown>[]) || [];
  for (const spoke of spokes) {
    if (spoke.platform) {
      coveredPlatforms.add(String(spoke.platform).toLowerCase());
    }
  }

  // Check for explicit skip reasons in campaign meta
  // Convention: campaign.meta.skip_surfaces = {"reddit": "no image asset ready", ...}
  const meta = (campaign.meta as Record<string, unknown>) || {};
  const skipSurfaces: Record<string, string> = {};
  if (typeof meta.skip_surfaces === "object" && meta.skip_surfaces !== null) {
    for (const [key, value] of Object.entries(meta.skip_surfaces)) {
      skipSurfaces[key.toLowerCase()] = String(value || "");
    }
  }

  // Check coverage
  const missingSurfaces: string[] = [];
  const skippedWithReason: Array<{ platform: string; reason: string }> = [];
  const skippedNoReason: string[] = [];

  for (const surface of [...canonicalSurfaces].sort()) {
    if (coveredPlatforms.has(surface)) {
      continue;
    }
    // Not covered — check for skip reason
    if (surface in skipSurfaces) {
      const reason = skipSurfaces[surface];
      if (reason) {
        skippedWithReason.push({ platform: surface, reason });
      } else {
        skippedNoReason.push(surface);
      }
    } else {
      // Neither covered nor documented — silent omission
      missingSurfaces.push(surface);
    }
  }

  if (missingSurfaces.length > 0) {
    out(
      1,
      "block",
      missingSurfaces,
      skippedWithReason,
      `BLOCK — ${missingSurfaces.length} surface(s) silently omitted from campaign: ${JSON.stringify(missingSurfaces)}. Add spokes OR document skip reason in meta.skip_surfaces.`
    );
  }

  if (skippedNoReason.length > 0) {
    out(
      2,
      "warn",
      [],
      skippedWithReason,
      `WARN — ${skippedNoReason.length} surface(s) in meta.skip_surfaces with no reason: ${JSON.stringify(skippedNoReason)}. Add a reason for each skipped surface.`
    );
  }

  const allSkipped = skippedWithReason;
  out(
    0,
    "pass",
    [],
    allSkipped,
    `PASS — All ${canonicalSurfaces.size} handles.md surfaces accounted for. ${coveredPlatforms.size} covered, ${allSkipped.length} explicitly skipped with reasons.`
  );
}

main().catch((e) => {
  out(2, "warn", [], [], `Unexpected error: ${String(e)}`);
});
