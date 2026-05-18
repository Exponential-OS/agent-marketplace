#!/usr/bin/env python3
"""
AUDIT.py — flywheel-cta-quality-check compliance audit.
Detects past BLOCK events (campaigns shipped with weak/missing CTAs).

Input:  $1 or stdin JSON (optional): {"log_file": "..."}
Exit:   0=PASS  1=BLOCK  2=WARN (no data)
"""
import json
import pathlib
import sys

RULE_SLUG = "flywheel-cta-quality-check"
LOG_FILE_DEFAULT = pathlib.Path.home() / ".career-os-enforcement-log.jsonl"


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == "-":
        raw = sys.stdin.read()
    else:
        raw = sys.argv[1]
    try:
        ctx = json.loads(raw) if raw.strip() else {}
    except Exception:
        ctx = {}

    log_file = pathlib.Path(ctx.get("log_file", str(LOG_FILE_DEFAULT)))
    if not log_file.exists():
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "blocks": 0, "passes": 0,
                          "reasons": ["No enforcement log found."]}))
        return 2

    blocks, passes, warns = [], [], []
    with open(log_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("rule_slug") != RULE_SLUG:
                    continue
                v = r.get("verdict", "")
                if v == "block":
                    blocks.append(r)
                elif v == "pass":
                    passes.append(r)
                else:
                    warns.append(r)
            except Exception:
                continue

    total = len(blocks) + len(passes) + len(warns)
    if total == 0:
        print(json.dumps({"verdict": "WARN", "status": "NO_DATA", "blocks": 0, "passes": 0,
                          "reasons": ["No flywheel-cta-quality-check entries in log."]}))
        return 2

    if blocks:
        campaigns = list({r.get("campaign_id", "unknown") for r in blocks})
        print(json.dumps({
            "verdict": "BLOCK", "status": "CTA_VIOLATIONS",
            "blocks": len(blocks), "passes": len(passes), "warns": len(warns),
            "campaigns_with_violations": campaigns,
            "reasons": [f"{len(blocks)} campaign(s) had CTA violations that were logged as BLOCK."]
        }))
        return 1

    print(json.dumps({
        "verdict": "PASS", "status": "COMPLIANT",
        "blocks": 0, "passes": len(passes), "warns": len(warns),
        "reasons": [f"No CTA violations in {len(passes)} campaign checks."]
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
