#!/usr/bin/env python3
"""
judge-session.py — LLM quality judge for Career OS session responses.

Called by capture-response.sh after each Claude response is captured.
Uses claude-haiku (fast/cheap) to classify risk tier and flag issues.
Writes judgment to brain/sessions/judgments/YYYY-MM-DD.md.
Non-blocking: any failure exits 0 (judge is advisory, not gating).
"""
import sys
import os
import json
import argparse
from datetime import datetime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--workspace", default=os.getcwd())
    args = parser.parse_args()

    response_text = sys.stdin.read().strip()
    if not response_text:
        sys.exit(0)

    # Soft dependency — judge is advisory
    try:
        import anthropic
    except ImportError:
        sys.exit(0)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit(0)

    try:
        client = anthropic.Anthropic(api_key=api_key)

        # Truncate to 3000 chars to keep cost minimal
        truncated = response_text[:3000]

        result = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            system="You are a session quality judge. Output valid JSON only. No explanation.",
            messages=[{
                "role": "user",
                "content": f"""Classify this AI response for risk. Output JSON:

Response (first 3000 chars):
{truncated}

Output exactly:
{{"tier": "T0|T1|T2|T3|T4", "biographical_claim_risk": "low|medium|high", "hallucination_risk": "low|medium|high", "flags": ["list specific issues or empty array"]}}

Tier guide: T0=trivial/private, T1=internal notes, T2=shared files/config, T3=architecture/strategy, T4=outreach to real humans/public publishing/biographical claims"""
            }]
        )

        verdict_raw = result.content[0].text.strip()
        # Strip markdown fences if model wraps response
        if verdict_raw.startswith("```"):
            verdict_raw = verdict_raw.split("```")[1]
            if verdict_raw.startswith("json"):
                verdict_raw = verdict_raw[4:]
            verdict_raw = verdict_raw.strip()
        verdict = json.loads(verdict_raw)

    except Exception:
        sys.exit(0)

    # Write to judgments file
    judgments_dir = os.path.join(args.workspace, "brain", "sessions", "judgments")
    os.makedirs(judgments_dir, exist_ok=True)

    judgments_file = os.path.join(judgments_dir, f"{args.date}.md")
    timestamp = datetime.now().strftime("%H:%M:%S")

    tier = verdict.get("tier", "T1")
    bio_risk = verdict.get("biographical_claim_risk", "low")
    halluc_risk = verdict.get("hallucination_risk", "low")
    flags = verdict.get("flags", [])

    # Only write if T3+ or any medium/high risk or any flag
    is_notable = (
        tier in ("T3", "T4") or
        bio_risk in ("medium", "high") or
        halluc_risk in ("medium", "high") or
        len(flags) > 0
    )

    if not is_notable:
        sys.exit(0)

    entry_lines = [
        f"## {timestamp} — {tier}",
        "",
        f"- **Biographical claim risk:** {bio_risk}",
        f"- **Hallucination risk:** {halluc_risk}",
    ]
    if flags:
        entry_lines.append(f"- **Flags:** {'; '.join(flags)}")
    entry_lines.extend(["", "---", ""])

    # Create file with header if new
    if not os.path.exists(judgments_file):
        with open(judgments_file, "w") as f:
            f.write(f"# Session Judgments — {args.date}\n\n")

    with open(judgments_file, "a") as f:
        f.write("\n".join(entry_lines))

    # Print summary to stdout for session log
    if tier in ("T3", "T4") or bio_risk == "high" or halluc_risk == "high":
        print(f"⚠️  Judge: {tier} | bio:{bio_risk} | halluc:{halluc_risk}" +
              (f" | {flags[0]}" if flags else ""))


if __name__ == "__main__":
    main()
