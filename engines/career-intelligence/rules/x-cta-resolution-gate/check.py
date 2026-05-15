#!/usr/bin/env python3
"""
check.py — x-cta-resolution-gate enforcement logic.

X (Twitter) algorithm penalizes tweets with external links in the thread body.
CTAs (Substack URL, GitHub install link) must live in a reply tweet, NOT in
any main thread tweet.

Input JSON (via sys.argv[1]):
{
  "platform": "x_thread",
  "thread_tweets": ["Tweet 1 text", "Tweet 2 text", ...],
  "reply_tweet": "Full piece: https://...",
  "hashtags": ["#tag1"]
}

Exits: 0=PASS, 1=BLOCK, 2=WARN

Gates (in order):
  1. external_link_in_thread_body — any URL in main thread tweets = BLOCK
  2. cta_in_reply                 — reply_tweet must exist and contain a URL = BLOCK
  3. placeholder_check            — REPLACE_ tokens anywhere = BLOCK
  4. hook_strength                — first tweet < 50 chars = WARN
"""
import json
import re
import sys

URL_RE = re.compile(r"https?://[^\s\)\"']+")
PLACEHOLDER_RE = re.compile(r"REPLACE_WITH_\w+")

GENERIC_OPENERS = ("i ", "today ", "just ", "so i ", "here's ", "thread:")


def main() -> int:
    context_raw = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        ctx = json.loads(context_raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"verdict": "BLOCK", "reason": f"Invalid JSON input: {e}"}))
        return 1

    thread_tweets = ctx.get("thread_tweets", [])
    reply_tweet = ctx.get("reply_tweet", "")

    if not thread_tweets:
        print(json.dumps({
            "verdict": "BLOCK",
            "reason": "thread_tweets is empty. Pass at least one tweet in the thread_tweets array.",
            "remediation": "Provide thread_tweets as a non-empty array of tweet strings.",
        }))
        return 1

    # ── Gate 1: external_link_in_thread_body ──────────────────────────────────
    for i, tweet in enumerate(thread_tweets):
        urls = URL_RE.findall(tweet)
        if urls:
            print(json.dumps({
                "verdict": "BLOCK",
                "gate": "external_link_in_thread_body",
                "reason": f"Tweet {i + 1} contains URL '{urls[0]}'. External links in X thread body reduce algorithmic reach.",
                "remediation": f"Move all URLs from tweet {i + 1} (and any other thread tweets) into reply_tweet. The thread body should be pure text — the reply carries the CTA links.",
            }))
            return 1

    # ── Gate 2: cta_in_reply ──────────────────────────────────────────────────
    if not reply_tweet or not reply_tweet.strip():
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "cta_in_reply",
            "reason": "reply_tweet is empty or missing. The CTA (Substack link, install link) must be in a reply tweet so the thread body stays link-free.",
            "remediation": "Add a reply_tweet with the Substack URL and/or Co-Dialectic install link. Post this as a self-reply immediately after publishing the thread.",
        }))
        return 1

    reply_urls = URL_RE.findall(reply_tweet)
    if not reply_urls:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "cta_in_reply",
            "reason": "reply_tweet has no URL. The reply must contain the actual CTA link (Substack URL, GitHub install link, etc.).",
            "remediation": "Add the Substack article URL or Co-Dialectic install link to reply_tweet.",
        }))
        return 1

    # ── Gate 3: placeholder_check ─────────────────────────────────────────────
    all_text = " ".join(thread_tweets) + " " + reply_tweet
    match = PLACEHOLDER_RE.search(all_text)
    if match:
        print(json.dumps({
            "verdict": "BLOCK",
            "gate": "placeholder_check",
            "reason": f"Unresolved placeholder '{match.group()}' found in thread or reply.",
            "remediation": f"Replace '{match.group()}' with the real URL before publishing.",
        }))
        return 1

    # ── Gate 4: hook_strength — WARN not BLOCK ────────────────────────────────
    first_tweet = thread_tweets[0].strip()
    if len(first_tweet) < 50:
        print(json.dumps({
            "verdict": "WARN",
            "gate": "hook_strength",
            "reason": f"First tweet is only {len(first_tweet)} characters. X algorithm rewards high engagement on tweet 1 — a short or generic opener limits reach.",
            "remediation": "Expand the first tweet to at least 50 characters with a specific claim or strong hook.",
        }))
        return 2

    if first_tweet.lower().startswith(GENERIC_OPENERS):
        opener = first_tweet.split()[0].lower()
        print(json.dumps({
            "verdict": "WARN",
            "gate": "hook_strength",
            "reason": f"First tweet starts with '{opener}' — a generic opener that won't stop scrollers.",
            "remediation": "Lead with the specific insight, number, or claim — not with 'I' or 'Today'.",
        }))
        return 2

    print(json.dumps({
        "verdict": "PASS",
        "platform": "x_thread",
        "thread_tweet_count": len(thread_tweets),
        "external_links_in_body": 0,
        "cta_in_reply": True,
        "reply_urls": reply_urls,
        "placeholder_clean": True,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
