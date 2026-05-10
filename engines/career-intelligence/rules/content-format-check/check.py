#!/usr/bin/env python3
"""
content-format-check — platform-aware content formatting validator.
Usage: python3 check.py '{"text": "...", "platform": "substack|linkedin|twitter|reddit|instagram"}'
Exit 0=PASS, 1=BLOCK, 2=WARN
"""
import sys, json, re

PLATFORMS = {"substack", "linkedin", "twitter", "reddit", "instagram"}

def main():
    context = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        d = json.loads(context)
    except Exception as e:
        emit("BLOCK", f"Invalid JSON: {e}", [])
        sys.exit(1)

    text = d.get("text", "")
    platform = d.get("platform", "").lower()

    if not text:
        emit("BLOCK", "No text provided", [])
        sys.exit(1)

    if platform and platform not in PLATFORMS:
        emit("BLOCK", f"Unknown platform '{platform}'. Valid: {sorted(PLATFORMS)}", [])
        sys.exit(1)

    violations = []   # hard blocks
    warnings   = []   # soft warnings

    # ── Universal checks (all platforms) ──────────────────────────────────────

    # Double spaces (two+ consecutive spaces not at start of line — not indentation)
    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.lstrip()
        if "  " in stripped:
            violations.append(f"Line {i}: double space detected → \"{line[:80]}\"")

    # Trailing whitespace
    for i, line in enumerate(text.splitlines(), 1):
        if line != line.rstrip():
            violations.append(f"Line {i}: trailing whitespace")

    # More than 2 consecutive blank lines
    if re.search(r"\n{4,}", text):
        violations.append("3+ consecutive blank lines (max 2 between sections)")

    # ── Platform-specific checks ───────────────────────────────────────────────

    if platform == "substack":
        # Only one H1 allowed (the title — don't repeat it in body)
        h1_matches = re.findall(r"^# .+", text, re.MULTILINE)
        if len(h1_matches) > 1:
            violations.append(f"Multiple H1 headers ({len(h1_matches)} found) — Substack only needs one title")

        # H4+ headers look bad in Substack's renderer
        if re.search(r"^#{4,} ", text, re.MULTILINE):
            violations.append("H4+ headers used — Substack renders poorly below H3")

        # Long paragraphs without breaks (readability)
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
        for p in paragraphs:
            word_count = len(p.split())
            if word_count > 150:
                preview = " ".join(p.split()[:12])
                warnings.append(f"Long paragraph ({word_count} words, no break): \"{preview}...\"")

        # Substack supports markdown — check for bad HTML tags
        if re.search(r"<[a-zA-Z]+[^>]*>", text):
            warnings.append("Raw HTML tags found — may not render in Substack")

    elif platform == "linkedin":
        # External links in body get suppressed by LinkedIn algorithm
        url_in_body = re.findall(r"https?://\S+", text)
        if url_in_body:
            violations.append(
                f"External URL(s) in post body — LinkedIn suppresses reach. "
                f"Move to first comment: {url_in_body[:3]}"
            )

        # LinkedIn renders markdown headers as plain text (bad look)
        if re.search(r"^#{1,6} ", text, re.MULTILINE):
            violations.append("Markdown headers (# ##) in LinkedIn post — rendered as plain text, looks broken")

        # LinkedIn character limit: 3,000 for posts, 700 for articles preview
        char_count = len(text)
        if char_count > 3000:
            violations.append(f"LinkedIn post exceeds 3,000 characters ({char_count} chars)")
        elif char_count > 2800:
            warnings.append(f"LinkedIn post near 3,000-char limit ({char_count}/3000)")

        # Emoji clusters (3+ consecutive emoji-like unicode — often used as visual noise)
        if re.search(r"[\U0001F300-\U0001FAFF]{3,}", text):
            warnings.append("3+ consecutive emoji — consider reducing for professional LinkedIn posts")

    elif platform == "twitter":
        # Split on thread separator conventions
        tweets = re.split(r"\n---+\n|\n\d+/\d+\n|\n\d+\.\n", text)
        if len(tweets) == 1:
            # Single tweet check
            if len(text) > 280:
                violations.append(f"Tweet exceeds 280 characters ({len(text)} chars)")
        else:
            # Thread check
            for i, tweet in enumerate(tweets, 1):
                tweet = tweet.strip()
                if len(tweet) > 280:
                    violations.append(f"Tweet {i} exceeds 280 characters ({len(tweet)} chars): \"{tweet[:60]}...\"")

        # Links count as 23 characters on Twitter (t.co wrap) — warn if miscounted
        urls = re.findall(r"https?://\S+", text)
        if urls:
            warnings.append(f"{len(urls)} URL(s) found — each counts as ~23 chars on X regardless of length")

    elif platform == "reddit":
        # Reddit renders markdown — check for common issues
        # Broken tables (pipes without proper header separator)
        table_rows = [l for l in text.splitlines() if re.match(r"\s*\|.*\|", l)]
        if table_rows:
            has_separator = any(re.match(r"\s*\|[-| :]+\|", l) for l in table_rows)
            if not has_separator:
                violations.append("Table rows found but no separator row (|---|---| required for Reddit markdown tables)")

        # Reddit post title limit hint
        char_count = len(text)
        if char_count > 40000:
            violations.append(f"Reddit post body exceeds 40,000 characters ({char_count})")
        elif char_count > 10000:
            warnings.append(f"Long Reddit post ({char_count} chars) — consider a TL;DR at top")

    elif platform == "instagram":
        # No clickable links in Instagram post body
        urls = re.findall(r"https?://\S+", text)
        if urls:
            violations.append(
                f"Links in Instagram post body are NOT clickable — remove or note 'link in bio': {urls[:3]}"
            )

        # Instagram character limit: 2,200
        char_count = len(text)
        if char_count > 2200:
            violations.append(f"Instagram caption exceeds 2,200 characters ({char_count} chars)")
        elif char_count > 2000:
            warnings.append(f"Instagram caption near 2,200-char limit ({char_count}/2200)")

        # Hashtags: warn if mixed into body (best practice: cluster at end or first comment)
        body_hashtags = [w for w in text.split() if w.startswith("#")]
        if body_hashtags:
            last_200 = text[-200:]
            body_only_tags = [t for t in body_hashtags if t not in last_200]
            if body_only_tags:
                warnings.append(
                    f"Hashtags mixed into body text — best practice is to cluster at end or first comment: {body_only_tags[:5]}"
                )

    # ── Result ─────────────────────────────────────────────────────────────────
    if violations:
        emit("BLOCK", "; ".join(violations), warnings)
        sys.exit(1)
    elif warnings:
        emit("WARN", "; ".join(warnings), [])
        sys.exit(2)
    else:
        plat_label = f" [{platform}]" if platform else ""
        emit("PASS", f"No formatting issues detected{plat_label}", [])
        sys.exit(0)


def emit(verdict, reason, warnings):
    result = {"verdict": verdict, "reason": reason}
    if warnings:
        result["warnings"] = warnings
    print(json.dumps(result))


if __name__ == "__main__":
    main()
