#!/usr/bin/env bash
# WATCH.sh — evolution candidates for content-format-check
# Scans log for patterns that suggest rule needs expanding or relaxing.
# Emits: keep | modify | kill verdicts per check category.

set -euo pipefail

LOG_FILE="$HOME/.cyborg-enforcement-log.jsonl"

echo "=== content-format-check WATCH — evolution scan ==="

if [[ ! -f "$LOG_FILE" ]]; then
  echo "No log file — cannot evaluate evolution candidates."
  exit 0
fi

# Count reasons per violation category
python3 - "$LOG_FILE" <<'EOF'
import sys, json, collections

log_path = sys.argv[1]
reasons = collections.Counter()
total = 0

with open(log_path) as f:
    for line in f:
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("rule") != "content-format-check":
            continue
        result = d.get("result", {})
        verdict = result.get("verdict", "")
        if verdict in ("BLOCK", "WARN"):
            reason = result.get("reason", "")
            # Split compound reasons
            for part in reason.split(";"):
                part = part.strip()
                if part:
                    # Normalize to category
                    if "double space" in part:
                        reasons["double-space"] += 1
                    elif "trailing whitespace" in part:
                        reasons["trailing-whitespace"] += 1
                    elif "blank lines" in part:
                        reasons["excess-blank-lines"] += 1
                    elif "LinkedIn" in part or "linkedin" in part:
                        reasons["linkedin-specific"] += 1
                    elif "Twitter" in part or "twitter" in part or "280" in part:
                        reasons["twitter-specific"] += 1
                    elif "Substack" in part or "substack" in part:
                        reasons["substack-specific"] += 1
                    elif "Instagram" in part or "instagram" in part:
                        reasons["instagram-specific"] += 1
                    elif "Reddit" in part or "reddit" in part:
                        reasons["reddit-specific"] += 1
                    else:
                        reasons["other"] += 1
        total += 1

if not reasons:
    print("No violations found in log — all categories: keep as-is.")
else:
    print(f"Violations by category (out of {total} total checks):")
    for cat, count in reasons.most_common():
        rate = count / total * 100
        verdict = "keep" if rate > 5 else "watch"
        if rate < 1 and total > 20:
            verdict = "consider-removing"
        print(f"  {cat:30s} {count:4d} hits ({rate:5.1f}%)  → {verdict}")
EOF

echo ""
echo "Micro-experiment candidates:"
echo "  [ ] Add check for em-dash spacing (— vs -- vs space-dash-space)"
echo "  [ ] Add check for Oxford comma consistency"
echo "  [ ] Add LinkedIn: detect 3+ consecutive line breaks (creates visual gap spam)"
echo "  [ ] Add Substack: detect unpaired quotes or stray smart-quote artifacts"
echo "  [ ] Add Twitter: detect tweets that end mid-sentence (likely split wrong)"
