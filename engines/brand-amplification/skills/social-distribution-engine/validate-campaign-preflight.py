#!/usr/bin/env python3
"""
validate-campaign-preflight.py — Meta-harness that runs all campaign gate checks
in sequence and produces a consolidated CI report.

This is the machine-actionable pre-flight check for the SDE distribute-campaign flow.
It runs the 8 structural gates + 2 semantic gates and exits with the worst result.

Gate sequence (fail-fast within each, report all):
  Phase 1 — Planning:
    1. campaign-schema-validator      — required fields + file refs
    2. channel-status-check           — no banned/low-ROI channels
    3. surface-coverage-check         — all handles.md surfaces accounted for
  Phase 2 — Content:
    4. content-url-resolution-check   — no unresolved [TOKEN] placeholders
  Phase 3 — Pre-distribution:
    5. flywheel-sequence-guard        — Estate publish order dependencies met
    6. visual-asset-review-check      — assets_reviewed=true
    7. image-brand-completeness-gate  — every image has brand signature + substantive SVG
    8. golden-hour-scheduling-check   — scheduled_at timestamps within platform golden windows
  Phase 4 — Semantic:
    9. campaign-estate-quality-check  — Estate model packaging (hub-spoke routing, Post Hub hook)
   10. flywheel-cta-quality-check     — CTA strength + platform-appropriateness per component

Complements (does not replace):
  - campaign-schema/validate-campaign.py — comprehensive human-readable report (run for human review)

Usage:
    python3 validate-campaign-preflight.py <campaign.json> [options]
    python3 validate-campaign-preflight.py <campaign.json> --target spoke-x-thread  # flywheel check for specific target

Exit:
    0 = ALL PASS
    1 = ONE OR MORE BLOCKS
    2 = WARNS only (no blocks)

Output: structured console report + JSON summary to stdout on last line.
"""

import json
import os
import pathlib
import subprocess
import sys

RULES_DIR = pathlib.Path(__file__).parent.parent.parent / "rules"
_CAREER_HOME_RAW = os.environ.get("CAREER_HOME") or os.environ.get("CAREER_OS_HOME")
if not _CAREER_HOME_RAW:
    print(json.dumps({"verdict": "BLOCK", "reason": "CAREER_HOME env var not set. Run career-intelligence-onboarding first."}), file=sys.stderr)
    sys.exit(1)
CAREER_HOME = str(pathlib.Path(_CAREER_HOME_RAW).expanduser())
if not pathlib.Path(CAREER_HOME).is_dir():
    print(json.dumps({"verdict": "BLOCK", "reason": f"CAREER_HOME={CAREER_HOME} does not exist or is not a directory."}), file=sys.stderr)
    sys.exit(1)


GATES = [
    # (phase, gate_slug, extra_args_fn, timeout_seconds)
    ("Planning",  "campaign-schema-validator",     lambda cf, _: {"campaign_file": cf},                                                                                                                                                        30),
    # SPEC-DRIFT-DETECTED: these gate scripts read brain paths directly via $CAREER_HOME.
    # Migration target: channel_dir_file → brain.read("brand-amplification/campaigns/social-channel-directory.md")
    #                   handles_file     → brain.read("identity/handles.md")
    # These subprocess gates cannot call brain.write() without a runtime brain instance;
    # migrating requires the gate-script API to accept pre-resolved file paths or a brain proxy.
    ("Planning",  "channel-status-check",          lambda cf, _: {"campaign_file": cf, "channel_dir_file": str(pathlib.Path(CAREER_HOME) / "brain/social-distribution-engine/social-channel-directory.md")},                              30),
    ("Planning",  "surface-coverage-check",        lambda cf, _: {"campaign_file": cf, "handles_file": str(pathlib.Path(CAREER_HOME) / "brain/identity/handles.md")},                                                                     30),
    ("Content",   "content-url-resolution-check",  lambda cf, _: {"campaign_file": cf},                                                                                                                                                        30),
    ("Pre-Dist",  "flywheel-sequence-guard",        lambda cf, t: {"campaign_file": cf, "target": t or ""},                                                                                                                                    30),
    ("Pre-Dist",  "visual-asset-review-check",        lambda cf, _: {"campaign_file": cf},                                                                                                                                                        30),
    ("Pre-Dist",  "image-brand-completeness-gate",  lambda cf, _: {"campaign_file": cf},                                                                                                                                                        30),
    ("Pre-Dist",  "golden-hour-scheduling-check",   lambda cf, _: {"campaign_file": cf},                                                                                                                                                        30),
    ("Semantic",  "campaign-estate-quality-check", lambda cf, _: {"campaign_file": cf},                                                                                                                                                       180),
    ("Semantic",  "flywheel-cta-quality-check",    lambda cf, _: {"campaign_file": cf},                                                                                                                                                       180),
]

STATUS_ICON = {"pass": "✅", "block": "🚫", "warn": "⚠️ "}
EXIT_MAP = {"pass": 0, "block": 1, "warn": 2}
# Severity ordering for worst-status tracking (block > warn > pass, independent of exit codes)
SEVERITY = {"block": 2, "warn": 1, "pass": 0}


def run_gate(slug, input_json, timeout=30):
    how_py = RULES_DIR / slug / "HOW.py"
    if not how_py.exists():
        return {"status": "warn", "message": f"HOW.py not found: {how_py}"}
    try:
        result = subprocess.run(
            [sys.executable, str(how_py), json.dumps(input_json)],
            capture_output=True, text=True, timeout=timeout
        )
        try:
            return json.loads(result.stdout.strip())
        except json.JSONDecodeError:
            return {"status": "warn", "message": result.stdout.strip() or result.stderr.strip()}
    except subprocess.TimeoutExpired:
        return {"status": "warn", "message": f"Gate timed out after {timeout}s"}
    except Exception as e:
        return {"status": "warn", "message": str(e)}


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print("Usage: validate-campaign-preflight.py <campaign.json> [--target <spoke_id>]")
        sys.exit(2)

    campaign_file = sys.argv[1]
    target = ""
    if "--target" in sys.argv:
        idx = sys.argv.index("--target")
        if idx + 1 < len(sys.argv):
            target = sys.argv[idx + 1]

    campaign_path = pathlib.Path(campaign_file)
    if not campaign_path.exists():
        print(f"ERROR: campaign.json not found: {campaign_file}", file=sys.stderr)
        sys.exit(2)

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERROR: Cannot parse campaign.json: {e}", file=sys.stderr)
        sys.exit(2)

    campaign_id = campaign.get("meta", {}).get("id", campaign_path.parent.name)

    print("=" * 60)
    print(f"SDE Pre-Flight: {campaign_id}")
    print("=" * 60)

    results = []
    worst_status = "pass"  # track by severity, not exit code

    current_phase = None
    for phase, slug, args_fn, timeout in GATES:
        if phase != current_phase:
            print(f"\n── Phase: {phase} ──")
            current_phase = phase

        input_json = args_fn(str(campaign_path.absolute()), target)
        result = run_gate(slug, input_json, timeout=timeout)

        status = result.get("status", "warn")
        icon = STATUS_ICON.get(status, "?? ")
        message = result.get("message", "")

        # Truncate long messages for display
        display_msg = message[:120] + "…" if len(message) > 120 else message

        print(f"  {icon} [{slug}] {display_msg}")

        if SEVERITY.get(status, 1) > SEVERITY.get(worst_status, 0):
            worst_status = status

        results.append({
            "phase": phase,
            "gate": slug,
            "status": status,
            "message": message,
            "detail": {k: v for k, v in result.items() if k not in ("status", "message")}
        })

    worst_exit = EXIT_MAP.get(worst_status, 2)

    print("\n" + "=" * 60)
    if worst_status == "pass":
        print("✅  ALL GATES PASS — Campaign ready for distribution.")
    elif worst_status == "block":
        blocks = [r["gate"] for r in results if r["status"] == "block"]
        print(f"🚫  BLOCKED — {len(blocks)} gate(s) failed: {', '.join(blocks)}")
        print("    Resolve all blocks before distributing.")
    else:
        warns = [r["gate"] for r in results if r["status"] == "warn"]
        print(f"⚠️   WARNINGS — {len(warns)} gate(s) warn: {', '.join(warns)}")
        print("    Review warnings before distributing.")
    print("=" * 60)

    # JSON summary on last line for machine parsing
    summary = {
        "campaign_id": campaign_id,
        "overall": worst_status,
        "gates": results
    }
    print(json.dumps(summary))

    sys.exit(worst_exit)


if __name__ == "__main__":
    main()
