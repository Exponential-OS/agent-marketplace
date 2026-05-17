#!/usr/bin/env bun
/**
 * handler.ts — image-brand-completeness-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * Two checks:
 *   1. BRAND SIGNATURE — required handles must appear in HTML source.
 *      BLOCK if any required_in_all handle is missing.
 *      WARN if any required_in_cta or required_in_company_context handle is missing.
 *
 *   2. VISUAL CONTENT — image must contain substantive SVG (not just text on dark bg).
 *      BLOCK if no <svg> element OR svg has fewer than MIN_SVG_CHILDREN child elements.
 *
 * Reads brand tokens from brand-spec.json (co-located in the skills directory, or
 * passed via brand_spec field in context JSON).
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "html_file": "/abs/path/to/template.html",    // Mode 2: single file
 *   "campaign_file": "/abs/path/to/campaign.json", // Mode 1: all campaign images
 *   "brand_spec": "/override/path/brand-spec.json" // optional override
 * }
 *
 * Exit codes: 0=PASS, 1=BLOCK, 2=WARN
 */

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "image-brand-completeness-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const DEFAULT_BRAND_SPEC_PATHS = [
  join(SCRIPT_DIR, "..", "..", "skills", "social-distribution-engine", "brand-spec.json"),
  join(SCRIPT_DIR, "brand-spec.json"),
];

// Minimum number of child elements inside <svg> to count as "substantive visual"
const MIN_SVG_CHILDREN = 5;

interface BrandSpec {
  handles?: Record<string, string>;
  image_requirements?: {
    required_in_all?: string[];
    required_in_cta?: string[];
    required_in_company_context?: string[];
  };
}

interface InputContext {
  html_file?: string;
  campaign_file?: string;
  brand_spec?: string;
}

interface BlockItem {
  file: string;
  svg_child_count: number;
  issues: string[];
}

interface WarnItem {
  file: string;
  issues: string[];
}

interface OutputResult {
  verdict: string;
  reason?: string;
  remediation?: string;
  files_checked?: number;
  blocked?: BlockItem[];
  warned?: WarnItem[];
  passed?: string[];
  file?: string;
  svg_child_count?: number;
  block_issues?: string[];
  warn_issues?: string[];
  brand_tokens_verified?: boolean;
  campaign_file?: string;
  [key: string]: unknown;
}

function log(extra: Record<string, unknown>): void {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rec = { ts, rule_slug: SLUG, ...extra };
  try {
    appendFileSync(LOG_PATH, JSON.stringify(rec) + "\n");
  } catch {
    // Fail-open on logging errors
  }
}

function emit(output: OutputResult, exitCode: number): never {
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  log({ verdict: output.verdict, fired: true });
  process.exit(exitCode);
}

function loadBrandSpec(override?: string): BrandSpec {
  if (override) {
    if (existsSync(override)) {
      try {
        return JSON.parse(readFileSync(override, "utf-8"));
      } catch {
        return {};
      }
    }
    return {};
  }
  for (const p of DEFAULT_BRAND_SPEC_PATHS) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        return {};
      }
    }
  }
  return {};
}

function checkBrandHandles(
  htmlSource: string,
  brandSpec: BrandSpec
): { blockMissing: string[]; warnMissing: string[] } {
  const imageReq = brandSpec.image_requirements ?? {};
  const requiredBlock = imageReq.required_in_all ?? [];
  const requiredWarnCta = imageReq.required_in_cta ?? [];
  const requiredWarnCompany = imageReq.required_in_company_context ?? [];
  const requiredWarn = [...requiredWarnCta, ...requiredWarnCompany];

  const blockMissing = requiredBlock.filter((tok) => !htmlSource.includes(tok));
  const warnMissing = requiredWarn.filter((tok) => !htmlSource.includes(tok));

  return { blockMissing, warnMissing };
}

function countSvgChildren(htmlSource: string): number {
  const svgMatch = htmlSource.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!svgMatch) return 0;
  const svgInner = svgMatch[1];
  const children = svgInner.match(
    /<(circle|line|rect|path|text|ellipse|polygon|polyline|g|use)\b/gi
  );
  return children ? children.length : 0;
}

function checkSingleFile(
  htmlPath: string,
  brandSpec: BrandSpec
): { fname: string; issuesBlock: string[]; issuesWarn: string[]; svgChildCount: number } {
  const htmlSource = readFileSync(htmlPath, "utf-8");
  const issuesBlock: string[] = [];
  const issuesWarn: string[] = [];

  if (Object.keys(brandSpec).length > 0) {
    const { blockMissing, warnMissing } = checkBrandHandles(htmlSource, brandSpec);
    for (const tok of blockMissing) {
      issuesBlock.push(
        `Missing required brand token '${tok}'. Add it to the image's signature/bottom bar.`
      );
    }
    for (const tok of warnMissing) {
      issuesWarn.push(
        `Missing recommended brand token '${tok}'. Consider adding to signature for full contact card.`
      );
    }
  } else {
    issuesWarn.push("brand-spec.json not found — brand handle check skipped.");
  }

  const svgChildCount = countSvgChildren(htmlSource);
  if (svgChildCount === 0) {
    issuesBlock.push(
      "No <svg> element found. Images must contain a substantive visual. " +
        "Add an SVG graphic — network diagram, chart, icon composition, or illustration."
    );
  } else if (svgChildCount < MIN_SVG_CHILDREN) {
    issuesBlock.push(
      `SVG has only ${svgChildCount} child element(s) — minimum ${MIN_SVG_CHILDREN} required. ` +
        "A decorative glow or single circle does not count as a visual."
    );
  }

  // Extract filename from path
  const fname = htmlPath.split("/").pop() ?? htmlPath;
  return { fname, issuesBlock, issuesWarn, svgChildCount };
}

function collectHtmlPathsFromCampaign(campaignFile: string): string[] {
  if (!existsSync(campaignFile)) return [];
  let campaign: Record<string, unknown>;
  try {
    campaign = JSON.parse(readFileSync(campaignFile, "utf-8"));
  } catch {
    return [];
  }

  const campaignDir = dirname(campaignFile);
  const seen = new Set<string>();
  const htmlPaths: string[] = [];

  function collect(node: unknown): void {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      const obj = node as Record<string, unknown>;
      const asset = obj["asset"];
      let fileVal = "";
      if (asset && typeof asset === "object") {
        fileVal = (asset as Record<string, unknown>)["file"] as string ?? "";
      } else if (typeof asset === "string") {
        fileVal = asset;
      }
      if (fileVal && !seen.has(fileVal)) {
        seen.add(fileVal);
        const absPng = fileVal.startsWith("/") ? fileVal : join(campaignDir, fileVal);
        const absHtml = absPng.replace(/\.[^.]+$/, ".html");
        if (existsSync(absHtml)) {
          htmlPaths.push(absHtml);
        }
      }
      for (const v of Object.values(obj)) {
        collect(v);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        collect(item);
      }
    }
  }

  collect(campaign);
  return htmlPaths;
}

async function main(): Promise<void> {
  const argVal = process.argv[2];
  const raw =
    argVal === undefined || argVal === "-"
      ? (await Bun.stdin.text()).trim()
      : argVal;

  if (!raw) {
    emit(
      {
        verdict: "BLOCK",
        reason: "No context JSON passed.",
      },
      1
    );
  }

  let ctx: InputContext;
  try {
    ctx = JSON.parse(raw);
  } catch (e: unknown) {
    emit(
      {
        verdict: "BLOCK",
        reason: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      },
      1
    );
  }

  const brandSpec = loadBrandSpec(ctx!.brand_spec);

  // ── Mode 1: campaign_file → find all HTML assets automatically ───────────────
  const campaignFile = ctx!.campaign_file;
  if (campaignFile) {
    const htmlPaths = collectHtmlPathsFromCampaign(campaignFile);
    if (htmlPaths.length === 0) {
      emit(
        {
          verdict: "WARN",
          reason:
            "No HTML image templates found for this campaign (no .html counterpart for any asset.file PNG). " +
            "If the campaign has image assets, ensure .html source files exist alongside the PNGs.",
          campaign_file: campaignFile,
        },
        2
      );
    }

    const allBlocks: BlockItem[] = [];
    const allWarns: WarnItem[] = [];
    const passed: string[] = [];

    for (const hp of htmlPaths) {
      const { fname, issuesBlock, issuesWarn, svgChildCount } = checkSingleFile(
        hp,
        brandSpec
      );
      if (issuesBlock.length > 0) {
        allBlocks.push({ file: fname, svg_child_count: svgChildCount, issues: issuesBlock });
      } else if (issuesWarn.length > 0) {
        allWarns.push({ file: fname, issues: issuesWarn });
      } else {
        passed.push(fname);
      }
    }

    if (allBlocks.length > 0) {
      emit(
        {
          verdict: "BLOCK",
          files_checked: htmlPaths.length,
          blocked: allBlocks,
          warned: allWarns,
          passed,
          remediation:
            "Fix all BLOCK issues before this campaign ships. " +
            "Every image needs: (1) full brand signature (@thewhyman + thewhyman.com), " +
            "(2) substantive SVG visual (≥5 elements).",
        },
        1
      );
    }

    if (allWarns.length > 0) {
      emit(
        {
          verdict: "WARN",
          files_checked: htmlPaths.length,
          warned: allWarns,
          passed,
        },
        2
      );
    }

    emit(
      {
        verdict: "PASS",
        files_checked: htmlPaths.length,
        passed,
      },
      0
    );
  }

  // ── Mode 2: html_file → check a single file ──────────────────────────────────
  const htmlFile = ctx!.html_file;
  if (!htmlFile) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          "Provide either html_file (single template) or campaign_file (all templates).",
      },
      1
    );
  }

  if (!existsSync(htmlFile!)) {
    emit(
      {
        verdict: "BLOCK",
        reason: `File not found: ${htmlFile}`,
        remediation: "Verify the path exists before running the gate.",
      },
      1
    );
  }

  const { fname, issuesBlock, issuesWarn, svgChildCount } = checkSingleFile(
    htmlFile!,
    brandSpec
  );

  if (issuesBlock.length > 0) {
    emit(
      {
        verdict: "BLOCK",
        file: fname,
        svg_child_count: svgChildCount,
        block_issues: issuesBlock,
        warn_issues: issuesWarn,
        remediation:
          "Fix all BLOCK issues before this template can be used in a campaign. " +
          "Every image needs: (1) full brand signature, (2) substantive SVG visual.",
      },
      1
    );
  }

  if (issuesWarn.length > 0) {
    emit(
      {
        verdict: "WARN",
        file: fname,
        svg_child_count: svgChildCount,
        warn_issues: issuesWarn,
      },
      2
    );
  }

  emit(
    {
      verdict: "PASS",
      file: fname,
      svg_child_count: svgChildCount,
      brand_tokens_verified: true,
    },
    0
  );
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      verdict: "BLOCK",
      reason: `Uncaught: ${err instanceof Error ? err.message : String(err)}`,
    }) + "\n"
  );
  process.exit(1);
});
