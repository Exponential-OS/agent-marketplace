#!/usr/bin/env python3
"""
post_validator.py — platform-specific post format checker.

Usage:
  echo '{"platform": "linkedin_post", "text": "...", "hashtags": [...]}' | python3 post_validator.py
  python3 post_validator.py --platform linkedin_post --text "..."
  python3 post_validator.py --platform linkedin_post --file draft.txt

Exit codes:
  0 = PASS (post meets all platform constraints)
  1 = FAIL (one or more hard violations)
  2 = WARN (soft recommendations only)

Output: JSON to stdout — always.
  {"verdict": "pass|fail|warn", "violations": [...], "warnings": [...], "stats": {...}}

Designed to migrate to xos-core/plugins/social-distribution/ when CareerOS → xOS.
Platform data lives in platforms.json (same directory) — update limits there, not here.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

PLATFORMS_JSON = pathlib.Path(__file__).parent / "platforms.json"

# Markdown patterns that are invisible-intent but render as literal chars on plain-text surfaces.
# NOTE: dash/asterisk list bullets (- item, * item) are intentionally excluded — on LinkedIn and
# most plain-text surfaces, users deliberately write "- item" and want the dash to appear literally.
# Only flag patterns where the user expects invisible formatting but gets visible noise instead.
_MD_PATTERNS = [
    (r"\|", "pipe character (renders as literal | in email/WhatsApp/LinkedIn DMs)"),
    (r"\*\*[^*]+\*\*", "bold markdown (**text**) — renders literally on plain-text surfaces"),
    (r"^#{1,6}\s", "markdown heading (# text) — renders literally"),
    (r"```", "code fence (```) — renders literally"),
]

# HTML tags/entities that render as literal text on plain-text surfaces (LinkedIn, X, email, etc.).
# These commonly appear when content is copy-pasted from rich editors, Substack, or Word.
_HTML_PATTERNS = [
    (r"<br\s*/?>", "<br> tag — renders as literal '<br>' text on plain-text surfaces"),
    (r"<p\b[^>]*>|</p>", "<p> tag — renders as literal tag text"),
    (r"<div\b[^>]*>|</div>", "<div> tag — renders as literal tag text"),
    (r"<strong\b[^>]*>|</strong>|<em\b[^>]*>|</em>", "HTML formatting tag — renders as literal text"),
    (r"&nbsp;", "&nbsp; entity — renders as literal '&nbsp;' on most plain-text surfaces"),
    (r"&amp;|&lt;|&gt;|&quot;", "HTML entity — renders as literal entity code"),
]

# Hashtag extraction — matches #word (Unicode-aware).
_HASHTAG_RE = re.compile(r"#[\w]+", re.UNICODE)

# URL detection (rough — counts links for platforms that penalize body links).
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def _load_platforms() -> dict:
    try:
        return json.loads(PLATFORMS_JSON.read_text())
    except (FileNotFoundError, json.JSONDecodeError) as e:
        _die(f"Cannot load platforms.json: {e}")


def _die(msg: str) -> None:
    print(json.dumps({"verdict": "error", "error": msg}))
    sys.exit(1)


def validate(platform_key: str, text: str, hashtags: list[str] | None = None) -> dict:
    platforms = _load_platforms()

    if platform_key not in platforms or platform_key.startswith("_"):
        available = [k for k in platforms if not k.startswith("_")]
        _die(f"Unknown platform '{platform_key}'. Available: {available}")

    spec = platforms[platform_key]
    violations: list[str] = []
    warnings: list[str] = []

    char_count = len(text)
    # Deduplicate: hashtags can be passed explicitly or extracted from text.
    extracted_tags = _HASHTAG_RE.findall(text)
    all_tags = list({t.lower() for t in (hashtags or []) + extracted_tags})
    hashtag_count = len(all_tags)
    url_count = len(_URL_RE.findall(text))

    # Pre-compute line-level metrics used by multiple checks below.
    lines = text.split("\n")
    _consecutive = 0
    _max_blank_found = 0
    for _line in lines:
        if _line.strip() == "":
            _consecutive += 1
            _max_blank_found = max(_max_blank_found, _consecutive)
        else:
            _consecutive = 0
    trailing_space_lines = [i + 1 for i, ln in enumerate(lines) if ln != ln.rstrip(" \t")]

    # ── Hard violations ────────────────────────────────────────────────────
    char_limit = spec.get("char_limit")
    if char_limit and char_count > char_limit:
        violations.append(
            f"Over character limit: {char_count}/{char_limit} chars "
            f"({char_count - char_limit} over)"
        )

    hashtag_max = spec.get("hashtag_max")
    if hashtag_max is not None and hashtag_count > hashtag_max:
        violations.append(
            f"Too many hashtags: {hashtag_count} (max {hashtag_max} for {spec['display_name']})"
        )

    if not spec.get("links_in_body", True) and url_count > 0:
        note = spec.get("links_note", "Links in post body penalized on this platform.")
        violations.append(f"External link(s) detected in body ({url_count} URL(s)). {note}")

    if spec.get("plain_text_only") and spec.get("markdown_rendered") is False:
        for pattern, description in _MD_PATTERNS:
            if re.search(pattern, text, re.MULTILINE):
                note = spec.get("plain_text_note", "")
                violations.append(
                    f"Markdown detected ({description}). "
                    f"This is a plain-text surface — will render as literal characters. "
                    + (f"{note}" if note else "")
                )
                break  # One violation per category is enough

        for pattern, description in _HTML_PATTERNS:
            if re.search(pattern, text, re.MULTILINE | re.IGNORECASE):
                violations.append(
                    f"HTML detected ({description}). "
                    f"Content was likely copy-pasted from a rich editor. "
                    f"Strip HTML before posting to {spec['display_name']}."
                )
                break  # One violation per category is enough

    # ── Soft warnings ──────────────────────────────────────────────────────
    hashtag_recommended = spec.get("hashtag_recommended")
    if hashtag_recommended and hashtag_count < hashtag_recommended and hashtag_max and hashtag_max > 0:
        warnings.append(
            f"Hashtag count {hashtag_count} is below recommended {hashtag_recommended} "
            f"for {spec['display_name']}"
        )

    char_visible = spec.get("char_visible")
    if char_visible and char_count > char_visible:
        warnings.append(
            f"Only first {char_visible} chars visible before 'more'. "
            f"Hook must land in the first {char_visible} characters. "
            f"({spec.get('char_visible_note', '')})"
        )

    hook_note = spec.get("line_break_hook_note")
    if spec.get("line_break_hook") and hook_note:
        first_lines = text.split("\n")[:3]
        if len("".join(first_lines)) > 300:
            warnings.append(
                f"First 3 lines total >300 chars — hook may be too dense. {hook_note}"
            )

    if spec.get("send_to_subscribers"):
        warnings.append(
            f"IRREVERSIBLE ACTION: {spec.get('send_to_subscribers_note', 'Sending notifies subscribers.')}"
        )

    if spec.get("promo_tone_penalized"):
        promo_signals = ["sign up", "buy now", "click here", "check out my", "follow me", "subscribe"]
        found = [s for s in promo_signals if s.lower() in text.lower()]
        if found:
            warnings.append(
                f"Promotional language detected: {found}. "
                f"{spec.get('promo_tone_note', 'May trigger downvotes or mod removal.')}"
            )

    max_blank_lines = spec.get("max_blank_lines")
    if max_blank_lines is not None and _max_blank_found > max_blank_lines:
        note = spec.get("max_blank_lines_note", "Excessive blank lines hurt readability.")
        warnings.append(
            f"Excessive blank lines: {_max_blank_found} consecutive empty lines found "
            f"(max {max_blank_lines} for {spec['display_name']}). {note}"
        )

    if spec.get("trailing_space_warn") and trailing_space_lines:
        n = len(trailing_space_lines)
        sample = trailing_space_lines[:5]
        suffix = "..." if n > 5 else ""
        warnings.append(
            f"Trailing spaces on {n} line(s) waste characters on this "
            f"{spec.get('char_limit', '?')}-char platform. "
            f"(Lines: {sample}{suffix})"
        )

    # ── Verdict ────────────────────────────────────────────────────────────
    verdict = "fail" if violations else ("warn" if warnings else "pass")

    return {
        "verdict": verdict,
        "platform": platform_key,
        "display_name": spec["display_name"],
        "violations": violations,
        "warnings": warnings,
        "stats": {
            "char_count": char_count,
            "char_limit": char_limit,
            "hashtag_count": hashtag_count,
            "hashtag_max": hashtag_max,
            "url_count": url_count,
            "max_blank_lines_found": _max_blank_found,
            "trailing_space_lines": len(trailing_space_lines),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a social post against platform constraints.")
    parser.add_argument("--platform", help="Platform key (e.g. linkedin_post, x_post)")
    parser.add_argument("--text", help="Post text inline")
    parser.add_argument("--file", help="Path to file containing post text")
    parser.add_argument("--hashtags", nargs="*", help="Explicit hashtag list (without #)")
    args = parser.parse_args()

    # JSON stdin mode (hook-style: {"platform": "...", "text": "..."})
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            try:
                data = json.loads(raw)
                platform = args.platform or data.get("platform", "")
                text = args.text or data.get("text", "")
                hashtags = args.hashtags or data.get("hashtags", [])
                if not platform or not text:
                    _die("stdin JSON must have 'platform' and 'text' fields")
                result = validate(platform, text, hashtags)
                print(json.dumps(result, indent=2))
                return 0 if result["verdict"] in ("pass", "warn") else 1
            except json.JSONDecodeError:
                pass  # Fall through to arg mode

    platform = args.platform
    if not platform:
        _die("--platform required (or pass JSON on stdin)")

    if args.file:
        try:
            text = pathlib.Path(args.file).read_text()
        except FileNotFoundError:
            _die(f"File not found: {args.file}")
    elif args.text:
        text = args.text
    else:
        _die("Provide --text, --file, or JSON on stdin")

    hashtags = [h.lstrip("#") for h in (args.hashtags or [])]
    result = validate(platform, text, hashtags)
    print(json.dumps(result, indent=2))
    return 0 if result["verdict"] in ("pass", "warn") else 1


if __name__ == "__main__":
    sys.exit(main())
