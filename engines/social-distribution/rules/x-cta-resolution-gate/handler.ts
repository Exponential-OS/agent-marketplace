#!/usr/bin/env bun
/**
 * handler.ts — x-cta-resolution-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * X (Twitter) algorithm penalizes tweets with external links in the thread body.
 * CTAs (Substack URL, GitHub install link) must live in a reply tweet, NOT in
 * any main thread tweet.
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "platform": "x_thread",
 *   "thread_tweets": ["Tweet 1 text", "Tweet 2 text", ...],
 *   "reply_tweet": "Full piece: https://...",
 *   "hashtags": ["#tag1"]
 * }
 *
 * Exits: 0=PASS, 1=BLOCK, 2=WARN
 *
 * Gates (in order):
 *   1. external_link_in_thread_body — any URL in main thread tweets = BLOCK
 *   2. cta_in_reply                 — reply_tweet must exist and contain a URL = BLOCK
 *   3. placeholder_check            — REPLACE_ tokens anywhere = BLOCK
 *   4. hook_strength                — first tweet < 50 chars = WARN
 */

import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SLUG = "x-cta-resolution-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");

const URL_RE = /https?:\/\/[^\s)"']+/g;
const PLACEHOLDER_RE = /REPLACE_WITH_\w+/;
const GENERIC_OPENERS = ["i ", "today ", "just ", "so i ", "here's ", "thread:"];

interface InputContext {
  platform?: string;
  thread_tweets?: string[];
  reply_tweet?: string;
  hashtags?: string[];
}

interface OutputResult {
  verdict: string;
  gate?: string;
  reason?: string;
  remediation?: string;
  platform?: string;
  thread_tweet_count?: number;
  external_links_in_body?: number;
  cta_in_reply?: boolean;
  reply_urls?: string[];
  placeholder_clean?: boolean;
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
        reason:
          "No input. Pass JSON with thread_tweets/reply_tweet fields.",
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

  const threadTweets = ctx!.thread_tweets ?? [];
  const replyTweet = ctx!.reply_tweet ?? "";

  if (threadTweets.length === 0) {
    emit(
      {
        verdict: "BLOCK",
        reason:
          "thread_tweets is empty. Pass at least one tweet in the thread_tweets array.",
        remediation:
          "Provide thread_tweets as a non-empty array of tweet strings.",
      },
      1
    );
  }

  // ── Gate 1: external_link_in_thread_body ────────────────────────────────────
  for (let i = 0; i < threadTweets.length; i++) {
    const tweet = threadTweets[i];
    const urls = tweet.match(URL_RE) ?? [];
    if (urls.length > 0) {
      emit(
        {
          verdict: "BLOCK",
          gate: "external_link_in_thread_body",
          reason: `Tweet ${i + 1} contains URL '${urls[0]}'. External links in X thread body reduce algorithmic reach.`,
          remediation: `Move all URLs from tweet ${i + 1} (and any other thread tweets) into reply_tweet. The thread body should be pure text — the reply carries the CTA links.`,
        },
        1
      );
    }
  }

  // ── Gate 2: cta_in_reply ────────────────────────────────────────────────────
  if (!replyTweet || !replyTweet.trim()) {
    emit(
      {
        verdict: "BLOCK",
        gate: "cta_in_reply",
        reason:
          "reply_tweet is empty or missing. The CTA (Substack link, install link) must be in a reply tweet so the thread body stays link-free.",
        remediation:
          "Add a reply_tweet with the Substack URL and/or Co-Dialectic install link. Post this as a self-reply immediately after publishing the thread.",
      },
      1
    );
  }

  const replyUrls = replyTweet.match(URL_RE) ?? [];
  if (replyUrls.length === 0) {
    emit(
      {
        verdict: "BLOCK",
        gate: "cta_in_reply",
        reason:
          "reply_tweet has no URL. The reply must contain the actual CTA link (Substack URL, GitHub install link, etc.).",
        remediation:
          "Add the Substack article URL or Co-Dialectic install link to reply_tweet.",
      },
      1
    );
  }

  // ── Gate 3: placeholder_check ───────────────────────────────────────────────
  const allText = threadTweets.join(" ") + " " + replyTweet;
  const placeholderMatch = allText.match(PLACEHOLDER_RE);
  if (placeholderMatch) {
    emit(
      {
        verdict: "BLOCK",
        gate: "placeholder_check",
        reason: `Unresolved placeholder '${placeholderMatch[0]}' found in thread or reply.`,
        remediation: `Replace '${placeholderMatch[0]}' with the real URL before publishing.`,
      },
      1
    );
  }

  // ── Gate 4: hook_strength — WARN not BLOCK ──────────────────────────────────
  const firstTweet = threadTweets[0].trim();
  if (firstTweet.length < 50) {
    emit(
      {
        verdict: "WARN",
        gate: "hook_strength",
        reason: `First tweet is only ${firstTweet.length} characters. X algorithm rewards high engagement on tweet 1 — a short or generic opener limits reach.`,
        remediation:
          "Expand the first tweet to at least 50 characters with a specific claim or strong hook.",
      },
      2
    );
  }

  const firstWordLower = firstTweet.toLowerCase();
  for (const opener of GENERIC_OPENERS) {
    if (firstWordLower.startsWith(opener)) {
      const openerWord = firstTweet.split(" ")[0].toLowerCase();
      emit(
        {
          verdict: "WARN",
          gate: "hook_strength",
          reason: `First tweet starts with '${openerWord}' — a generic opener that won't stop scrollers.`,
          remediation:
            "Lead with the specific insight, number, or claim — not with 'I' or 'Today'.",
        },
        2
      );
    }
  }

  emit(
    {
      verdict: "PASS",
      platform: "x_thread",
      thread_tweet_count: threadTweets.length,
      external_links_in_body: 0,
      cta_in_reply: true,
      reply_urls: replyUrls,
      placeholder_clean: true,
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
