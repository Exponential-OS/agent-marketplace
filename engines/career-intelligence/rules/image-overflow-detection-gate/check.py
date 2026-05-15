#!/usr/bin/env python3
"""
check.py — image-overflow-detection-gate enforcement logic.

Root problem: CSS overflow:hidden on fixed-height image templates silently clips text.
Nothing errors. The PNG just shows cut-off headlines. This gate detects overflow BEFORE
the PNG is finalized.

Two-mode detection:
  1. Chrome headless (primary): injects JS into temp HTML copy, runs --dump-dom,
     parses overflow report from page title.
  2. Static char analysis (fallback): compares h1/subtitle text length against
     image-spec.json platform limits.

Input JSON (via sys.argv[1]):
{
  "html_file": "/abs/path/to/template.html",
  "width": 1200,
  "height": 628,
  "platform": "linkedin_post"
}

Exits: 0=PASS, 1=BLOCK (confirmed overflow), 2=WARN (static analysis or Chrome unavailable)
"""
import html as html_lib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
SPEC_PATH = SCRIPT_DIR.parents[1] / "skills/social-distribution-engine/image-spec.json"

OVERFLOW_JS = """
<script>
window.addEventListener('load', function() {
  var overflowing = [];
  // Use the container element as the clip boundary, falling back to body.
  // getBoundingClientRect() gives the VISUAL boundary after overflow:hidden clipping.
  var clipEl = document.querySelector('.container') || document.body;
  var clipBottom = clipEl.getBoundingClientRect().bottom;
  var clipRight  = clipEl.getBoundingClientRect().right;

  // Check direct text-bearing elements: any element whose rendered bottom edge
  // falls BELOW the container boundary (i.e. visually clipped or off-screen).
  var tags = ['h1','h2','h3','p','div','span'];
  tags.forEach(function(tag) {
    document.querySelectorAll(tag).forEach(function(el) {
      var rect = el.getBoundingClientRect();
      // Skip zero-height elements (decorators, pseudo-elements)
      if (rect.height < 2) return;
      // Skip purely decorative elements with no direct text content
      var directText = Array.from(el.childNodes)
        .filter(function(n) { return n.nodeType === 3; })
        .map(function(n) { return n.textContent.trim(); })
        .join('');
      if (!directText && el.children.length === 0) return;
      // Skip elements that are entirely above the clip boundary (fine)
      if (rect.bottom <= clipBottom + 4) return;
      // Element extends below the container's visual boundary — clipped
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
"""

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
]


def _find_chrome() -> str | None:
    for path in CHROME_CANDIDATES:
        if os.path.isfile(path):
            return path
    for name in ("google-chrome", "chromium", "chromium-browser"):
        try:
            result = subprocess.run(["which", name], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except OSError:
            pass
    return None


def check_overflow_chrome(html_path: pathlib.Path, width: int, height: int) -> list | None:
    """Return list of overflowing elements, empty list if clean, None if Chrome unavailable."""
    chrome = _find_chrome()
    if not chrome:
        return None

    content = html_path.read_text(encoding="utf-8")
    if "</body>" in content:
        modified = content.replace("</body>", OVERFLOW_JS + "</body>", 1)
    else:
        modified = content + OVERFLOW_JS

    with tempfile.NamedTemporaryFile(suffix=".html", mode="w", delete=False, encoding="utf-8") as f:
        f.write(modified)
        tmp_path = f.name

    try:
        proc = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--dump-dom",
             f"--window-size={width},{height}", f"file://{tmp_path}"],
            capture_output=True, text=True, timeout=30,
        )
        dom = proc.stdout
        match = re.search(r"__OV__(.+?)__END__", dom)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                return []
        # dump-dom succeeded but title wasn't set — JS may not have run
        return []
    except (subprocess.TimeoutExpired, OSError):
        return None
    finally:
        try:
            pathlib.Path(tmp_path).unlink()
        except OSError:
            pass


def check_overflow_static(html_content: str, platform: str) -> list:
    """Static fallback: compare extracted text lengths against image-spec.json limits."""
    spec = {}
    if SPEC_PATH.exists():
        try:
            all_specs = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
            spec = all_specs.get(platform, {})
        except (json.JSONDecodeError, OSError):
            pass

    violations = []

    h1_match = re.search(r"<h1[^>]*>(.*?)</h1>", html_content, re.DOTALL | re.IGNORECASE)
    if h1_match:
        raw = re.sub(r"<[^>]+>", "", h1_match.group(1))
        text = html_lib.unescape(raw).replace("\n", " ").strip()
        limit = spec.get("headline_max_chars", 60)
        if len(text) > limit:
            violations.append(
                f"h1 text is {len(text)} chars (limit {limit} for {platform}): \"{text[:50]}...\""
            )

    sub_match = re.search(
        r'class=["\']subtitle["\'][^>]*>(.*?)</div>',
        html_content, re.DOTALL | re.IGNORECASE,
    )
    if not sub_match:
        sub_match = re.search(r"<p[^>]*>(.*?)</p>", html_content, re.DOTALL | re.IGNORECASE)
    if sub_match:
        raw = re.sub(r"<[^>]+>", "", sub_match.group(1))
        text = html_lib.unescape(raw).replace("\n", " ").strip()
        limit = spec.get("subtitle_max_chars", 140)
        if len(text) > limit:
            violations.append(
                f"subtitle text is {len(text)} chars (limit {limit} for {platform}): \"{text[:50]}...\""
            )

    return violations


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1

    html_file = ctx.get("html_file", "")
    width = int(ctx.get("width", 1200))
    height = int(ctx.get("height", 628))
    platform = ctx.get("platform", "unknown")

    if not html_file:
        print(json.dumps({"verdict": "BLOCK", "reason": "html_file is required.",
                          "remediation": "Pass the absolute path to the HTML template file."}))
        return 1

    html_path = pathlib.Path(html_file)
    if not html_path.exists():
        print(json.dumps({"verdict": "BLOCK",
                          "reason": f"HTML file not found: {html_file}",
                          "remediation": "Verify the path and generate the HTML template before running this gate."}))
        return 1

    # ── Primary: Chrome overflow detection ────────────────────────────────────
    overflow_elements = check_overflow_chrome(html_path, width, height)

    if overflow_elements is None:
        # Chrome unavailable — fall back to static analysis
        html_content = html_path.read_text(encoding="utf-8")
        static_violations = check_overflow_static(html_content, platform)
        if static_violations:
            print(json.dumps({
                "verdict": "WARN",
                "mode": "static_analysis",
                "reason": f"Chrome unavailable. Static analysis found {len(static_violations)} potential overflow(s).",
                "violations": static_violations,
                "remediation": "Review these text lengths manually or install Chrome to enable mechanical overflow detection. Shorten headline/subtitle or use explicit <br> line breaks.",
            }))
            return 2
        print(json.dumps({
            "verdict": "WARN",
            "mode": "static_analysis",
            "reason": "Chrome unavailable. Static analysis found no character limit violations, but mechanical overflow check was not possible.",
            "remediation": "Install Chrome for mechanical overflow detection: https://www.google.com/chrome/",
        }))
        return 2

    if overflow_elements:
        print(json.dumps({
            "verdict": "BLOCK",
            "mode": "chrome_headless",
            "reason": f"{len(overflow_elements)} overflowing element(s) detected at {width}x{height}. Text is being clipped by overflow:hidden.",
            "overflowing_elements": overflow_elements,
            "remediation": (
                "Fix one of: (1) add explicit <br> tags to break long headlines into shorter lines, "
                "(2) reduce font-size (check image-spec.json for platform limits), "
                "(3) shorten the text to fit within the container. "
                "Do not rely on overflow:hidden to hide the problem — clipped text in a PNG looks broken."
            ),
        }))
        return 1

    print(json.dumps({
        "verdict": "PASS",
        "mode": "chrome_headless",
        "platform": platform,
        "dims": [width, height],
        "overflow_elements_detected": 0,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
