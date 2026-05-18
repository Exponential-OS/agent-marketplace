#!/usr/bin/env bun
/**
 * handler.ts — image-overflow-detection-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * Root problem: CSS overflow:hidden on fixed-height image templates silently clips text.
 * Nothing errors. The PNG just shows cut-off headlines. This gate detects overflow BEFORE
 * the PNG is finalized.
 *
 * Two-mode detection:
 *   1. Chrome headless (primary): injects JS into temp HTML copy, runs --dump-dom,
 *      parses overflow report from page title.
 *   2. Static char analysis (fallback): compares h1/subtitle text length against
 *      image-spec.json platform limits.
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "html_file": "/abs/path/to/template.html",
 *   "width": 1200,
 *   "height": 628,
 *   "platform": "linkedin_post"
 * }
 *
 * Exits: 0=PASS, 1=BLOCK (confirmed overflow), 2=WARN (static analysis or Chrome unavailable)
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "image-overflow-detection-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(SCRIPT_DIR, "..", "..", "skills", "social-distribution-engine", "image-spec.json");

const OVERFLOW_JS = `
<script>
window.addEventListener('load', function() {
  var overflowing = [];
  var clipEl = document.querySelector('.container') || document.body;
  var clipBottom = clipEl.getBoundingClientRect().bottom;
  var clipRight  = clipEl.getBoundingClientRect().right;

  var tags = ['h1','h2','h3','p','div','span'];
  tags.forEach(function(tag) {
    document.querySelectorAll(tag).forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (rect.height < 2) return;
      var directText = Array.from(el.childNodes)
        .filter(function(n) { return n.nodeType === 3; })
        .map(function(n) { return n.textContent.trim(); })
        .join('');
      if (!directText && el.children.length === 0) return;
      if (rect.bottom <= clipBottom + 4) return;
      var id = el.tagName.toLowerCase();
      if (el.id) id += '#' + el.id;
      if (el.className && typeof el.className === 'string') {
        id += '.' + el.className.trim().split(/\\s+/)[0];
      }
      id += ':bottom=' + Math.round(rect.bottom) + ',clipBottom=' + Math.round(clipBottom);
      overflowing.push(id);
    });
  });
  document.title = '__OV__' + JSON.stringify(overflowing) + '__END__';
});
</script>
`;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

interface InputContext {
  html_file?: string;
  width?: number;
  height?: number;
  platform?: string;
}

interface OutputResult {
  verdict: string;
  mode?: string;
  platform?: string;
  dims?: number[];
  overflow_elements_detected?: number;
  overflowing_elements?: string[];
  violations?: string[];
  reason?: string;
  remediation?: string;
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
  process.stdout.write(JSON.stringify(output) + "\n");
  log({ verdict: output.verdict, fired: true });
  process.exit(exitCode);
}

async function findChrome(): Promise<string | null> {
  for (const path of CHROME_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const proc = Bun.spawn(["which", name], { stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      if (proc.exitCode === 0 && stdout.trim()) return stdout.trim();
    } catch {
      // Continue
    }
  }
  return null;
}

async function checkOverflowChrome(
  htmlPath: string,
  width: number,
  height: number
): Promise<string[] | null> {
  const chrome = await findChrome();
  if (!chrome) return null;

  let content: string;
  try {
    content = readFileSync(htmlPath, "utf-8");
  } catch {
    return null;
  }

  const modified = content.includes("</body>")
    ? content.replace("</body>", OVERFLOW_JS + "</body>")
    : content + OVERFLOW_JS;

  const tmpFile = join(tmpdir(), `overflow-check-${Date.now()}.html`);
  writeFileSync(tmpFile, modified, "utf-8");

  try {
    const proc = Bun.spawn(
      [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        `--window-size=${width},${height}`,
        `file://${tmpFile}`,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    const timeoutId = setTimeout(() => proc.kill(), 30_000);
    const [dom] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    clearTimeout(timeoutId);

    const match = dom.match(/__OV__(.+?)__END__/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return [];
      }
    }
    return [];
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function checkOverflowStatic(htmlContent: string, platform: string): string[] {
  let spec: Record<string, number> = {};
  if (existsSync(SPEC_PATH)) {
    try {
      const allSpecs = JSON.parse(readFileSync(SPEC_PATH, "utf-8"));
      spec = allSpecs[platform] ?? {};
    } catch {
      // Use defaults
    }
  }

  const violations: string[] = [];

  const h1Match = htmlContent.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const raw = h1Match[1].replace(/<[^>]+>/g, "");
    const text = raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n/g, " ").trim();
    const limit = spec["headline_max_chars"] ?? 60;
    if (text.length > limit) {
      violations.push(
        `h1 text is ${text.length} chars (limit ${limit} for ${platform}): "${text.slice(0, 50)}..."`
      );
    }
  }

  let subMatch = htmlContent.match(/class=["']subtitle["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!subMatch) {
    subMatch = htmlContent.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  }
  if (subMatch) {
    const raw = subMatch[1].replace(/<[^>]+>/g, "");
    const text = raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n/g, " ").trim();
    const limit = spec["subtitle_max_chars"] ?? 140;
    if (text.length > limit) {
      violations.push(
        `subtitle text is ${text.length} chars (limit ${limit} for ${platform}): "${text.slice(0, 50)}..."`
      );
    }
  }

  return violations;
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
        reason: "No input. Pass JSON with html_file, width, height, platform fields.",
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

  const htmlFile = ctx!.html_file ?? "";
  const width = Number(ctx!.width ?? 1200);
  const height = Number(ctx!.height ?? 628);
  const platform = ctx!.platform ?? "unknown";

  if (!htmlFile) {
    emit(
      {
        verdict: "BLOCK",
        reason: "html_file is required.",
        remediation: "Pass the absolute path to the HTML template file.",
      },
      1
    );
  }

  if (!existsSync(htmlFile)) {
    emit(
      {
        verdict: "BLOCK",
        reason: `HTML file not found: ${htmlFile}`,
        remediation:
          "Verify the path and generate the HTML template before running this gate.",
      },
      1
    );
  }

  // ── Primary: Chrome overflow detection ──────────────────────────────────────
  const overflowElements = await checkOverflowChrome(htmlFile, width, height);

  if (overflowElements === null) {
    // Chrome unavailable — fall back to static analysis
    const htmlContent = readFileSync(htmlFile, "utf-8");
    const staticViolations = checkOverflowStatic(htmlContent, platform);
    if (staticViolations.length > 0) {
      emit(
        {
          verdict: "WARN",
          mode: "static_analysis",
          reason: `Chrome unavailable. Static analysis found ${staticViolations.length} potential overflow(s).`,
          violations: staticViolations,
          remediation:
            "Review these text lengths manually or install Chrome to enable mechanical overflow detection. Shorten headline/subtitle or use explicit <br> line breaks.",
        },
        2
      );
    }
    emit(
      {
        verdict: "WARN",
        mode: "static_analysis",
        reason:
          "Chrome unavailable. Static analysis found no character limit violations, but mechanical overflow check was not possible.",
        remediation:
          "Install Chrome for mechanical overflow detection: https://www.google.com/chrome/",
      },
      2
    );
  }

  if (overflowElements!.length > 0) {
    emit(
      {
        verdict: "BLOCK",
        mode: "chrome_headless",
        reason: `${overflowElements!.length} overflowing element(s) detected at ${width}x${height}. Text is being clipped by overflow:hidden.`,
        overflowing_elements: overflowElements!,
        remediation:
          "Fix one of: (1) add explicit <br> tags to break long headlines into shorter lines, " +
          "(2) reduce font-size (check image-spec.json for platform limits), " +
          "(3) shorten the text to fit within the container. " +
          "Do not rely on overflow:hidden to hide the problem — clipped text in a PNG looks broken.",
      },
      1
    );
  }

  emit(
    {
      verdict: "PASS",
      mode: "chrome_headless",
      platform,
      dims: [width, height],
      overflow_elements_detected: 0,
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
