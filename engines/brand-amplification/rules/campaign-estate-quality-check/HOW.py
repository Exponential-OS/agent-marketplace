#!/usr/bin/env python3
"""
campaign-estate-quality-check/HOW.py — Semantic gate evaluating the entire
campaign package against the SDE Estate Model distribution thesis.

Uses OAuth CLI (claude → gemini → codex fallback) — no API key required.
Set SKIP_LLM_JUDGES=1 to bypass in CI environments (returns WARN).

Input JSON:
    {"campaign_file": "/abs/path/to/campaign.json"}

Exit:
    0 = PASS   (Estate model correctly implemented)
    1 = BLOCK  (hard Estate model violation)
    2 = WARN   (advisory issues or CI mode)

Stdout: JSON {"status": "pass|block|warn", "verdict": "...", "findings": [...], "message": str}
"""

from __future__ import annotations

import datetime
import json
import os
import pathlib
import subprocess
import sys

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
SLUG = SCRIPT_DIR.name
PROMPT_FILE = SCRIPT_DIR / "PROMPT.md"
LOG_PATH = pathlib.Path.home() / ".career-os-enforcement-log.jsonl"

_SKIP_LLM_JUDGES = bool(os.environ.get("SKIP_LLM_JUDGES")) or "--ci" in sys.argv

_CLI_ORDER = ["claude", "gemini", "codex"]
_CLI_TIMEOUT = {"claude": 120, "gemini": 30, "codex": 120}

STATUS_MAP = {"PASS": "pass", "WARN": "warn", "BLOCK": "block"}
EXIT_MAP = {"pass": 0, "block": 1, "warn": 2}


def _which(cmd: str) -> bool:
    return subprocess.run(["which", cmd], capture_output=True).returncode == 0


def _extract_json(body: str) -> dict | None:
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
        return json.loads(body[start:end + 1])
    except json.JSONDecodeError:
        return None


def _read_content_file(path: str, campaign_dir: pathlib.Path) -> str:
    """Read a content file relative to the campaign directory."""
    p = pathlib.Path(path)
    if not p.is_absolute():
        p = campaign_dir / p
    if p.exists():
        try:
            return p.read_text(encoding="utf-8")
        except OSError:
            return f"[ERROR: could not read {path}]"
    return f"[MISSING: {path}]"


def _build_judge_package(campaign: dict, campaign_dir: pathlib.Path) -> str:
    """Assemble full campaign package as text for the judge."""
    lines: list[str] = []

    lines.append("=== CAMPAIGN META ===")
    lines.append(json.dumps(campaign.get("meta", {}), indent=2))

    lines.append("\n=== REVIEW FLAGS ===")
    lines.append(json.dumps(campaign.get("review", {}), indent=2))

    # Source (Substack)
    source = campaign.get("source", {})
    lines.append(f"\n=== SOURCE ({source.get('platform', 'substack')}) ===")
    lines.append(f"Status: {source.get('status', 'unknown')}")
    if source.get("content_file"):
        lines.append(f"--- content ({source['content_file']}) ---")
        lines.append(_read_content_file(source["content_file"], campaign_dir))

    # Hub (LinkedIn Article)
    hub = campaign.get("hub", {})
    lines.append(f"\n=== HUB ({hub.get('platform', 'linkedin')} / {hub.get('type', 'article')}) ===")
    lines.append(f"Status: {hub.get('status', 'unknown')}")
    if hub.get("content_file"):
        lines.append(f"--- content ({hub['content_file']}) ---")
        lines.append(_read_content_file(hub["content_file"], campaign_dir))

    # Spokes
    for spoke in campaign.get("spokes", []):
        sid = spoke.get("id", "unknown")
        platform = spoke.get("platform", "unknown")
        role = spoke.get("role", "spoke")
        lines.append(f"\n=== SPOKE: {sid} ({platform} / {role}) ===")
        lines.append(f"Status: {spoke.get('status', 'unknown')}")
        if spoke.get("content_file"):
            lines.append(f"--- content ({spoke['content_file']}) ---")
            lines.append(_read_content_file(spoke["content_file"], campaign_dir))

    # Comment cascade (may be dict or list depending on schema version)
    cascade = campaign.get("comment_cascade")
    if cascade:
        lines.append("\n=== COMMENT CASCADE ===")
        if isinstance(cascade, dict):
            if cascade.get("content_file"):
                lines.append(_read_content_file(cascade["content_file"], campaign_dir))
            for day_key in ("day_1_targets", "day_2_targets"):
                targets = cascade.get(day_key, [])
                if targets:
                    lines.append(f"\n-- {day_key} ({len(targets)} entries) --")
                    for t in targets[:3]:
                        if isinstance(t, dict):
                            lines.append(f"  platform: {t.get('platform','?')}, text: {str(t.get('text',''))[:120]}")
        elif isinstance(cascade, list):
            for entry in cascade:
                if isinstance(entry, dict):
                    target = entry.get("target", "unknown")
                    lines.append(f"\n-- Cascade target: {target} --")
                    if entry.get("content_file"):
                        lines.append(_read_content_file(entry["content_file"], campaign_dir))

    return "\n".join(lines)


def _call_cli(prompt: str, package: str) -> dict | None:
    """Try CLIs in order. Return parsed JSON result or None if all fail."""
    full_prompt = f"{prompt}\n\n{package}"

    for cli in _CLI_ORDER:
        if not _which(cli):
            continue
        timeout = _CLI_TIMEOUT.get(cli, 60)
        try:
            if cli == "claude":
                proc = subprocess.run(
                    ["claude", "-p", full_prompt],
                    capture_output=True, text=True, timeout=timeout,
                )
            elif cli == "gemini":
                proc = subprocess.run(
                    ["gemini", "-p", prompt, "--yolo"],
                    input=package,
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
            if parsed and "verdict" in parsed:
                parsed["_cli_used"] = cli
                return parsed
        except subprocess.TimeoutExpired:
            continue
        except Exception:
            continue

    return None


def _log(status: str, campaign_id: str, findings_count: int) -> None:
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rec = {
        "ts": ts,
        "rule_slug": SLUG,
        "script_type": "HOW",
        "verdict": status,
        "campaign_id": campaign_id,
        "findings_count": findings_count,
    }
    try:
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(rec) + "\n")
    except OSError:
        pass


def out(exit_code: int, status: str, result: dict) -> None:
    print(json.dumps(result))
    sys.exit(exit_code)


def main() -> None:
    if len(sys.argv) < 2:
        out(2, "warn", {"status": "warn", "message": "No input provided."})

    try:
        ctx = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        out(1, "block", {"status": "block", "message": f"Invalid JSON: {e}"})

    campaign_file = ctx.get("campaign_file", "")
    if not campaign_file:
        out(2, "warn", {"status": "warn", "message": "campaign_file is required."})

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        out(2, "warn", {"status": "warn", "message": f"campaign.json not found: {campaign_file}"})

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        out(2, "warn", {"status": "warn", "message": f"Cannot parse campaign.json: {e}"})

    campaign_id = campaign.get("meta", {}).get("id", campaign_path.parent.name)
    campaign_dir = campaign_path.parent

    if _SKIP_LLM_JUDGES:
        result = {
            "status": "warn",
            "message": "WARN — LLM judge skipped (SKIP_LLM_JUDGES=1); human review of Estate model packaging required before ship.",
            "ci_mode": True,
            "campaign_id": campaign_id,
        }
        _log("warn", campaign_id, 0)
        out(2, "warn", result)

    if not PROMPT_FILE.exists():
        out(2, "warn", {"status": "warn", "message": f"PROMPT.md not found at {PROMPT_FILE}"})

    prompt = PROMPT_FILE.read_text(encoding="utf-8")
    package = _build_judge_package(campaign, campaign_dir)

    judge_result = _call_cli(prompt, package)

    if judge_result is None:
        result = {
            "status": "warn",
            "message": "WARN — no CLI available (claude/gemini/codex not on PATH); human review required.",
            "campaign_id": campaign_id,
        }
        _log("warn", campaign_id, 0)
        out(2, "warn", result)

    verdict = str(judge_result.get("verdict", "WARN")).upper()
    status = STATUS_MAP.get(verdict, "warn")
    findings = judge_result.get("findings", [])
    findings_count = len(findings)

    block_findings = [f for f in findings if f.get("severity") == "block"]
    warn_findings = [f for f in findings if f.get("severity") == "warn"]

    if status == "pass":
        message = f"PASS — Estate model correctly implemented. {findings_count} findings (0 blocks, 0 warns)."
    elif status == "warn":
        message = f"WARN — {len(warn_findings)} advisory finding(s). Review before ship. {judge_result.get('reason', '')}"
    else:
        message = f"BLOCK — {len(block_findings)} Estate model violation(s). {judge_result.get('reason', '')}"

    result = {
        "status": status,
        "message": message,
        "campaign_id": campaign_id,
        "verdict": verdict,
        "reason": judge_result.get("reason", ""),
        "findings": findings,
        "strengths": judge_result.get("strengths", []),
        "suggestions": judge_result.get("suggestions", []),
        "cli_used": judge_result.get("_cli_used", "unknown"),
    }

    _log(status, campaign_id, findings_count)
    exit_code = EXIT_MAP.get(status, 2)
    out(exit_code, status, result)


if __name__ == "__main__":
    main()
