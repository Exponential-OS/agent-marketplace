#!/usr/bin/env bun
/**
 * handler.ts — substack-publish-gate enforcement (TypeScript+Bun replacement for HOW.py+check.py)
 *
 * Substack email sends are one-way doors: you cannot un-send to subscribers.
 * This gate fires BEFORE any publish action that would trigger an email blast.
 *
 * Input JSON (stdin or argv[2]):
 * {
 *   "platform": "substack",
 *   "action": "publish|draft_save|edit",
 *   "is_email_send": true,
 *   "is_resend": false,
 *   "email_send_confirmed": false,  // human must set true to pass gate 2
 *   "post_title": "...",
 *   "post_excerpt": "...",          // first ~500 chars, for quality judge
 *   "word_count": 1500,
 *   "has_hook": true,
 *   "has_cta": true,
 *   "section": "...",               // optional: Substack section/newsletter name; WARN if absent on email send
 *   "tags": ["tag1", "tag2"]        // optional: Substack post tags; WARN if absent on email send (min 2 recommended)
 * }
 *
 * Exits: 0=PASS, 1=BLOCK, 2=WARN
 *
 * Gates (in order):
 *   1. resend_block      — is_resend=true always BLOCK, no exceptions
 *   2. email_send_gate   — is_email_send=true requires email_send_confirmed=true
 *   3. completeness      — word_count>=300 + has_hook + has_cta
 *   4. metadata          — section missing = WARN, tags empty/missing = WARN (WARN only, not BLOCK)
 *   5. quality           — LLM judge via PROMPT.md + claude -p on post_excerpt
 */

import { appendFileSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SLUG = "substack-publish-gate";
const LOG_PATH = join(homedir(), ".career-os-enforcement-log.jsonl");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(SCRIPT_DIR, "PROMPT.md");

const MIN_WORD_COUNT = 300;

interface InputContext {
  platform?: string;
  action?: string;
  is_email_send?: boolean;
  is_resend?: boolean;
  email_send_confirmed?: boolean;
  post_title?: string;
  post_excerpt?: string;
  word_count?: number;
  has_hook?: boolean;
  has_cta?: boolean;
  section?: string;
  tags?: string[];
}

interface OutputResult {
  verdict: string;
  gate?: string;
  reason?: string;
  remediation?: string;
  platform?: string;
  post_title?: string;
  word_count?: number;
  is_email_send?: boolean;
  email_send_confirmed?: boolean;
  quality?: string;
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

async function runLlmJudge(
  postExcerpt: string
): Promise<{ verdict: string; reason?: string; fix?: string }> {
  if (!existsSync(PROMPT_PATH)) {
    return {
      verdict: "BLOCK",
      reason: `PROMPT.md not found at ${PROMPT_PATH}. Cannot run LLM quality judge.`,
      fix: `Ensure ${PROMPT_PATH} exists.`,
    };
  }

  const promptTemplate = readFileSync(PROMPT_PATH, "utf-8");
  const prompt = promptTemplate.replace("{EXCERPT}", postExcerpt.trim());

  try {
    const proc = Bun.spawn(["claude", "-p", prompt], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeoutId = setTimeout(() => proc.kill(), 60_000);
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    clearTimeout(timeoutId);

    const raw = stdout.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        verdict: "BLOCK",
        reason: `LLM judge returned non-JSON: ${raw.slice(0, 200)}`,
        fix: "Retry. If persistent, check PROMPT.md format.",
      };
    }
    return JSON.parse(jsonMatch[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      return {
        verdict: "BLOCK",
        reason: "claude CLI not found. Cannot run LLM quality judge.",
        fix: "Install claude CLI: https://claude.ai/code",
      };
    }
    return {
      verdict: "BLOCK",
      reason: `LLM judge error: ${msg}`,
      fix: "Retry. If persistent, check claude CLI connectivity.",
    };
  }
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
          "No input. Pass JSON with platform/action/is_email_send/post_title/post_excerpt/word_count/has_hook/has_cta fields.",
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

  const isResend = ctx!.is_resend ?? false;
  const isEmailSend = ctx!.is_email_send ?? false;
  const emailSendConfirmed = ctx!.email_send_confirmed ?? false;
  const action = (ctx!.action ?? "").toLowerCase();
  const postTitle = ctx!.post_title ?? "";
  const postExcerpt = ctx!.post_excerpt ?? "";
  const wordCount = ctx!.word_count ?? 0;
  const hasHook = ctx!.has_hook ?? false;
  const hasCta = ctx!.has_cta ?? false;
  const section = ctx!.section ?? "";
  const tags = ctx!.tags ?? [];

  // ── Gate 1: resend_block — inviolable one-way door ───────────────────────────
  if (isResend) {
    emit(
      {
        verdict: "BLOCK",
        gate: "resend_block",
        reason:
          "This is a RESEND of an already-published post. Substack email cannot be un-sent — a second publish triggers a second email blast to all subscribers.",
        remediation:
          "Edit the post in-place without republishing: " +
          "post editor → Settings/gear icon → swap cover or fix body → Save. " +
          "NEVER click Publish, Send, Republish, or 'Notify subscribers' on an already-sent post. " +
          "This gate has no override. Resend authorization requires explicit user action in the Substack UI — not agent delegation.",
      },
      1
    );
  }

  // ── Gate 2: email_send_gate — human confirmation required ────────────────────
  if (isEmailSend && action !== "draft_save" && action !== "edit") {
    if (!emailSendConfirmed) {
      emit(
        {
          verdict: "BLOCK",
          gate: "email_send_gate",
          reason:
            "This action sends email to all subscribers. Explicit human confirmation is required before the agent proceeds.",
          remediation:
            "Review the post draft carefully. " +
            "If ready to send, add `\"email_send_confirmed\": true` to the payload — " +
            "this field must be set by the human in the current turn, not by a standing rule. " +
            "Then re-run the gate.",
        },
        1
      );
    }
  }

  // ── Gate 3: completeness ─────────────────────────────────────────────────────
  if (wordCount < MIN_WORD_COUNT) {
    emit(
      {
        verdict: "BLOCK",
        gate: "completeness",
        reason: `Post is ${wordCount} words — below the ${MIN_WORD_COUNT}-word minimum for an email send. Subscribers expect substance.`,
        remediation: `Expand the post to at least ${MIN_WORD_COUNT} words before sending.`,
      },
      1
    );
  }

  if (!hasHook) {
    emit(
      {
        verdict: "BLOCK",
        gate: "completeness",
        reason:
          "Post is missing an opening hook. The first paragraph does not create tension, curiosity, or a strong claim.",
        remediation:
          "Rewrite the opener so the first 1-2 sentences immediately establish what the reader stands to gain or what is at stake.",
      },
      1
    );
  }

  if (!hasCta) {
    emit(
      {
        verdict: "BLOCK",
        gate: "completeness",
        reason:
          "Post is missing a CTA (call to action). Every email send needs a clear next step for the reader.",
        remediation:
          "Add a CTA: subscribe link, share prompt, reply invitation, or action link.",
      },
      1
    );
  }

  // ── Gate 4: metadata — section + tags (WARN only, not BLOCK) ─────────────────
  const metadataWarnings: string[] = [];
  if (isEmailSend) {
    if (!section) {
      metadataWarnings.push(
        "No 'section' field provided. For multi-section Substack publications, assign the post to the correct section before sending. " +
          'Add "section": "<section name>" to the payload. Single-section publications can ignore this warning.'
      );
    }
    if (!tags || (Array.isArray(tags) && tags.length === 0)) {
      metadataWarnings.push(
        "No tags provided. Substack tags improve SEO and discoverability. " +
          'Add "tags": ["tag1", "tag2"] (2-3 recommended). ' +
          "Without tags, the post will not surface in Substack search or topic feeds."
      );
    } else if (Array.isArray(tags) && tags.length < 2) {
      metadataWarnings.push(
        `Only ${tags.length} tag provided. Minimum 2 tags recommended for Substack discoverability. ` +
          "Add at least one more tag covering the post topic."
      );
    }
  }

  // ── Gate 5: quality — LLM semantic judge ────────────────────────────────────
  if (!postExcerpt) {
    emit(
      {
        verdict: "BLOCK",
        gate: "quality",
        reason: "post_excerpt is empty. Cannot run LLM quality judge without excerpt.",
        remediation: "Pass the first ~500 characters of the post body as post_excerpt.",
      },
      1
    );
  }

  const judgeResult = await runLlmJudge(postExcerpt);
  const verdict = (judgeResult.verdict ?? "BLOCK").toUpperCase();

  if (verdict !== "PASS") {
    emit(
      {
        verdict: "BLOCK",
        gate: "quality (LLM judge)",
        reason: judgeResult.reason ?? "LLM judge returned no reason.",
        remediation:
          judgeResult.fix ??
          "Rewrite the opening to hook immediately before sending.",
      },
      1
    );
  }

  if (metadataWarnings.length > 0) {
    emit(
      {
        verdict: "WARN",
        gate: "metadata",
        platform: ctx!.platform ?? "substack",
        post_title: postTitle,
        word_count: wordCount,
        quality: "PASS (LLM judge)",
        reason: metadataWarnings.join(" | "),
        remediation:
          "Add section and/or tags fields to the payload. Post can ship but discoverability will be reduced.",
      },
      2
    );
  }

  emit(
    {
      verdict: "PASS",
      platform: ctx!.platform ?? "substack",
      post_title: postTitle,
      word_count: wordCount,
      is_email_send: isEmailSend,
      email_send_confirmed: emailSendConfirmed,
      quality: "PASS (LLM judge)",
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
