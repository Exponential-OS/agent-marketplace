#!/usr/bin/env python3
"""
HOW.py — social-content-readiness-check enforcement primitive.

GATE rule. Social media posts are high-stakes irreversible actions
(LinkedIn cannot un-send; Substack newsletter goes to all subscribers).
Before any content is marked `status: ready` or published, two checks fire:

  1. LLM JUDGE PANEL     three independent judges run in parallel with
                         distinct lenses:
                           - tone/authenticity      → claude CLI (OAuth)
                           - IP / patent firewall   → gemini CLI (cross-family, OAuth)
                           - narrative clarity       → codex CLI  (cross-family, OAuth)
                         Panel rule: ALL judges must return PASS or WARN,
                         AND no more than 1 WARN. Otherwise BLOCK.
                         Falls back to Anthropic SDK (ANTHROPIC_API_KEY) if
                         no CLI is available.

  2. METADATA            content carries: title, platform, intended audience,
                         surface coverage matrix reference.

Input JSON (stdin or argv):
  {
    "text": "...post body...",
    "platform": "substack|linkedin|twitter|reddit|instagram",
    "title": "...",
    "metadata": {
      "audience": "...",
      "surface_coverage_matrix": "path/to/matrix"
    }
  }

Output JSON: verdict + per-check breakdown + panel verdicts.
Exit:   0=PASS  1=BLOCK  2=WARN
"""

from __future__ import annotations

import datetime
import json
import os
import pathlib
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
SLUG = SCRIPT_DIR.name
LOG_PATH = pathlib.Path.home() / ".career-os-enforcement-log.jsonl"

# Cross-family CLI preference per judge.
# OAuth-based CLIs require no API key — uses existing subscriptions.
# Falls back to "claude" if the preferred CLI is not on PATH.
# Cross-family CLI preference per judge.
# OAuth-based CLIs require no API key — uses existing subscriptions.
# Falls back to "claude" if the preferred CLI is not on PATH.
_JUDGE_CLI_PREF: dict[str, str] = {
    "tone":      "claude",   # Claude Code OAuth (Claude family)
    "ip_safety": "gemini",   # Google OAuth — cross-family
    "narrative": "codex",    # OpenAI OAuth — cross-family
}

# SDK fallback model (used only when all CLIs are unavailable and ANTHROPIC_API_KEY is set).
_SDK_FALLBACK_MODEL = "claude-haiku-4-5-20251001"

# Per-CLI timeout (seconds). Gemini can hang on missing API key; keep short so
# fallback fires quickly. Claude and codex are typically fast.
_CLI_TIMEOUT: dict[str, int] = {
    "claude": 60,
    "gemini": 20,   # hangs if GEMINI_API_KEY not set; fast-fail to fallback
    "codex":  60,
}

# Set SKIP_LLM_JUDGES=1 (or run with --ci flag) to bypass all LLM judges and
# return WARN for the panel. Intended for CI environments where no CLIs or API
# keys are available.
_SKIP_LLM_JUDGES = bool(os.environ.get("SKIP_LLM_JUDGES")) or "--ci" in sys.argv

REQUIRED_METADATA_KEYS: tuple[str, ...] = (
    "audience",
    "surface_coverage_matrix",
)

JUDGES: tuple[tuple[str, str], ...] = (
    (
        "tone",
        (
            "You are a brand-voice judge. The author's authentic voice is "
            "direct, specific, intellectually honest, and avoids corporate "
            "filler. Read the draft and return STRICT JSON with this shape: "
            '{"verdict":"PASS"|"WARN"|"BLOCK","reason":"...","suggestions":["..."]}.\n'
            "PASS = clearly the authentic voice. "
            "WARN = mostly authentic but with one or two corporate-speak / "
            "engagement-bait phrases. "
            "BLOCK = generic LinkedIn-influencer voice or hollow inspirational "
            "filler — would damage the author's credibility. "
            "Output JSON only — no preamble."
        ),
    ),
    (
        "ip_safety",
        (
            "You are an IP / patent firewall judge. Read the draft. Return "
            "STRICT JSON: "
            '{"verdict":"PASS"|"WARN"|"BLOCK","reason":"...","suggestions":["..."]}.\n'
            "BLOCK = the post discloses unfiled patent claims, internal "
            "architecture marked confidential, customer data, or any specific "
            "technical method that should be filed before publication. "
            "WARN = the post hints at internal IP without disclosing it but "
            "could invite probing questions. "
            "PASS = no IP disclosure risk. "
            "Output JSON only — no preamble."
        ),
    ),
    (
        "narrative",
        (
            "You are a narrative-clarity judge. Imagine a reader who has zero "
            "prior context about this author or this work. Read the draft and "
            "return STRICT JSON: "
            '{"verdict":"PASS"|"WARN"|"BLOCK","reason":"...","suggestions":["..."]}.\n'
            "BLOCK = the hook is unclear, the takeaway is undefined, OR the "
            "call-to-action is missing or buried. "
            "WARN = the hook lands but the CTA is implicit / weak. "
            "PASS = a context-free reader gets the hook in one read AND knows "
            "what to do next. "
            "Output JSON only — no preamble."
        ),
    ),
)


def _read_context() -> str:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        return sys.stdin.read().strip()
    return sys.argv[1]


def _emit_and_log(payload: dict, exit_code: int) -> int:
    print(json.dumps(payload, indent=2))
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rec = {
        "ts": ts,
        "rule_slug": SLUG,
        "script_type": "HOW",
        "verdict": payload.get("verdict"),
        "platform": payload.get("platform"),
        "title": payload.get("title"),
        "metadata_verdict": payload.get("metadata_check", {}).get("verdict"),
        "panel_verdict": payload.get("panel", {}).get("verdict"),
    }
    try:
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        pass
    return exit_code


def _check_metadata(metadata: dict, title: str, platform: str) -> dict:
    missing: list[str] = []
    if not title:
        missing.append("title")
    if not platform:
        missing.append("platform")
    if not isinstance(metadata, dict):
        metadata = {}
    for key in REQUIRED_METADATA_KEYS:
        value = metadata.get(key)
        if value in (None, "", []):
            missing.append(f"metadata.{key}")
    if missing:
        return {
            "verdict": "BLOCK",
            "reason": "missing required metadata: " + ", ".join(missing),
            "missing": missing,
        }
    return {"verdict": "PASS", "reason": "all required metadata present"}


def _which(cmd: str) -> bool:
    """Return True if cmd is on PATH."""
    return subprocess.run(["which", cmd], capture_output=True).returncode == 0


def _extract_json(body: str) -> dict | None:
    """Best-effort JSON extraction from a model response."""
    body = body.strip()
    if not body:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        pass
    start = body.find("{")
    end = body.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(body[start : end + 1])
    except json.JSONDecodeError:
        return None


def _call_judge_cli(judge_id: str, system_prompt: str, content: str) -> dict:
    """Run a judge via OAuth CLI — no API key required.

    CLI mapping (cross-family by default):
      tone      → claude  (Claude Code OAuth)
      ip_safety → gemini  (Google OAuth — cross-family)
      narrative → codex   (OpenAI OAuth — cross-family)

    Falls back to `claude` CLI if the preferred CLI is not on PATH.
    Returns verdict=WARN cli=none if no CLI is reachable at all.
    """
    preferred = _JUDGE_CLI_PREF.get(judge_id, "claude")
    order: list[str] = [preferred] if preferred == "claude" else [preferred, "claude"]

    full_prompt = f"{system_prompt}\n\nDRAFT TO EVALUATE:\n{content}"

    for cli in order:
        if not _which(cli):
            continue
        try:
            timeout = _CLI_TIMEOUT.get(cli, 60)
            if cli == "claude":
                proc = subprocess.run(
                    ["claude", "-p", full_prompt],
                    capture_output=True, text=True, timeout=timeout,
                )
            elif cli == "gemini":
                # gemini: -p sets the task/system prompt; content piped via stdin
                proc = subprocess.run(
                    ["gemini", "-p", system_prompt, "--yolo"],
                    input=content,
                    capture_output=True, text=True, timeout=timeout,
                )
            elif cli == "codex":
                proc = subprocess.run(
                    ["codex", "exec", full_prompt],
                    capture_output=True, text=True, timeout=timeout,
                )
            else:
                continue

            body = proc.stdout.strip()
            if not body:
                continue
            parsed = _extract_json(body)
            if parsed is None:
                continue
            return {
                "judge": judge_id,
                "verdict": str(parsed.get("verdict", "WARN")).upper(),
                "reason": parsed.get("reason", ""),
                "suggestions": parsed.get("suggestions", []) or [],
                "cli": cli,
                "cross_family": cli != "claude",
            }
        except subprocess.TimeoutExpired:
            continue
        except Exception:
            continue

    return {
        "judge": judge_id,
        "verdict": "WARN",
        "reason": f"no CLI reachable for judge '{judge_id}'; human review required",
        "suggestions": [],
        "cli": "none",
        "cross_family": False,
    }


def _call_judge_sdk(judge_id: str, system_prompt: str, content: str) -> dict:
    """Anthropic SDK path — used only when all CLIs are unavailable and ANTHROPIC_API_KEY is set."""
    try:
        import anthropic  # type: ignore
    except ImportError:
        return {
            "judge": judge_id,
            "verdict": "WARN",
            "reason": "anthropic SDK not installed; judge skipped",
            "suggestions": [],
            "cli": "sdk-unavailable",
        }
    try:
        client = anthropic.Anthropic()
        response = client.messages.create(
            model=_SDK_FALLBACK_MODEL,
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": content}],
        )
    except Exception as e:
        return {
            "judge": judge_id,
            "verdict": "WARN",
            "reason": f"SDK judge call failed: {e}",
            "suggestions": [],
            "cli": "sdk-error",
        }

    body = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            body += block.text
    body = body.strip()
    parsed = _extract_json(body)
    if parsed is None:
        return {
            "judge": judge_id,
            "verdict": "WARN",
            "reason": "SDK judge returned non-JSON output",
            "raw": body[:300],
            "suggestions": [],
            "cli": "sdk",
        }
    return {
        "judge": judge_id,
        "verdict": str(parsed.get("verdict", "WARN")).upper(),
        "reason": parsed.get("reason", ""),
        "suggestions": parsed.get("suggestions", []) or [],
        "cli": "sdk",
        "cross_family": False,
    }


def _call_judge(judge_id: str, system_prompt: str, content: str) -> dict:
    """Dispatch a single judge. CLI path (OAuth, no API key) first; SDK fallback if key present."""
    result = _call_judge_cli(judge_id, system_prompt, content)
    if result.get("cli") != "none":
        return result
    if os.environ.get("ANTHROPIC_API_KEY"):
        return _call_judge_sdk(judge_id, system_prompt, content)
    return result


def _run_judge_panel(text: str, title: str, platform: str) -> dict:
    if _SKIP_LLM_JUDGES:
        return {
            "verdict": "WARN",
            "reason": "LLM judges skipped (SKIP_LLM_JUDGES=1 or --ci flag); human review required before ship",
            "judges": [],
            "cli_used": {},
            "ci_mode": True,
        }

    payload_for_judge = (
        f"PLATFORM: {platform}\n"
        f"TITLE: {title}\n\n"
        f"DRAFT:\n---\n{text}\n---"
    )

    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(JUDGES)) as pool:
        futures = {
            pool.submit(_call_judge, jid, prompt, payload_for_judge): jid
            for jid, prompt in JUDGES
        }
        for fut in as_completed(futures):
            results.append(fut.result())

    by_id = {r["judge"]: r for r in results}
    ordered = [by_id[jid] for jid, _ in JUDGES if jid in by_id]

    verdicts = [r["verdict"] for r in ordered]
    blocks = sum(1 for v in verdicts if v == "BLOCK")
    warns = sum(1 for v in verdicts if v == "WARN")

    if blocks > 0 or warns > 1:
        panel_verdict = "BLOCK"
        reason = (
            f"panel BLOCK: {blocks} blocking, {warns} warning verdicts "
            "(rule: 0 BLOCK and <=1 WARN required to ship)"
        )
    elif warns == 1:
        panel_verdict = "WARN"
        reason = "panel WARN: 1 warning verdict; review before ship"
    else:
        panel_verdict = "PASS"
        reason = "panel PASS: all judges returned PASS"

    # Surface which CLIs were used so the operator can see cross-family coverage.
    cli_used = {r["judge"]: r.get("cli", "none") for r in ordered}

    return {
        "verdict": panel_verdict,
        "reason": reason,
        "judges": ordered,
        "cli_used": cli_used,
    }


def main() -> int:
    raw = _read_context()
    if not raw:
        return _emit_and_log(
            {
                "verdict": "BLOCK",
                "reason": (
                    "missing context JSON. Pass: "
                    '{"text":"...","platform":"...","title":"...","metadata":{...}}'
                ),
            },
            1,
        )

    try:
        ctx = json.loads(raw)
    except json.JSONDecodeError as e:
        return _emit_and_log(
            {"verdict": "BLOCK", "reason": f"Invalid JSON: {e}"},
            1,
        )

    text = (ctx.get("text") or "").strip()
    platform = (ctx.get("platform") or "").strip().lower()
    title = (ctx.get("title") or "").strip()
    metadata = ctx.get("metadata") or {}

    if not text:
        return _emit_and_log(
            {
                "verdict": "BLOCK",
                "platform": platform,
                "title": title,
                "reason": "text field is required and must be non-empty",
            },
            1,
        )

    metadata_result = _check_metadata(metadata, title, platform)
    panel_result = _run_judge_panel(text, title, platform)

    component_verdicts = [
        metadata_result.get("verdict", "WARN"),
        panel_result.get("verdict", "WARN"),
    ]
    if any(v == "BLOCK" for v in component_verdicts):
        verdict, exit_code = "BLOCK", 1
    elif any(v == "WARN" for v in component_verdicts):
        verdict, exit_code = "WARN", 2
    else:
        verdict, exit_code = "PASS", 0

    payload = {
        "verdict": verdict,
        "platform": platform,
        "title": title,
        "metadata_check": metadata_result,
        "panel": panel_result,
        "next_action": "ship" if verdict == "PASS" else (
            "review-and-rewrite" if verdict == "BLOCK" else "human-review-before-ship"
        ),
    }
    return _emit_and_log(payload, exit_code)


if __name__ == "__main__":
    sys.exit(main())
