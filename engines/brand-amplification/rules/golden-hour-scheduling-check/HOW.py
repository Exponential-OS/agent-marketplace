#!/usr/bin/env python3
"""
golden-hour-scheduling-check/HOW.py — a Pre-Distribution scheduling gate in the
BAE pre-flight CI (advisory; one of the 10 gates run by validate-campaign-preflight.py).

Validates that campaign components are scheduled during platform-specific
golden-hour windows — the peak-velocity windows where early engagement
velocity carries maximum algorithmic weight.

Golden hour = first 60 min after publish (LinkedIn/Substack) or 30 min
(X/Instagram). Scheduling inside a window means real humans are online
to generate the velocity that locks in algorithmic distribution.

Input JSON:  {"campaign_file": "/abs/path/to/campaign.json"}
             Optional: {"timezone": "America/New_York"} overrides meta.timezone

Output JSON: {"status": "pass|warn|block", "message": "...", "findings": [...]}
Exit:        0=PASS  1=BLOCK  2=WARN

NOTE: This gate never BLOCKs — wrong timing degrades performance, it does
not invalidate the campaign. All findings are WARNs. BLOCK is reserved for
future integration with a mandatory scheduling system.
"""

import json
import pathlib
import sys
from datetime import datetime, time

try:
    import zoneinfo
except ImportError:
    import importlib
    zoneinfo = importlib.import_module("backports.zoneinfo")


# Golden windows per platform component type: list of (start_h, start_m, end_h, end_m)
# Research basis: LinkedIn algorithm data (Hootsuite/Sprout 2024), X engagement benchmarks,
# Instagram internal signal studies, Substack open-rate patterns.
GOLDEN_WINDOWS: dict[str, list[tuple[int, int, int, int]]] = {
    "linkedin_article": [(7, 30, 9, 0), (11, 30, 13, 0), (17, 0, 18, 30)],
    "linkedin_post":    [(7, 30, 9, 0), (11, 30, 13, 0), (17, 0, 18, 30)],
    "x_thread":         [(8, 0, 10, 0), (12, 0, 13, 0), (17, 0, 18, 0)],
    "instagram":        [(6, 0, 9, 0),  (11, 0, 13, 0), (19, 0, 21, 0)],
    "substack":         [(6, 0, 10, 0)],
    "reddit":           [(6, 0, 8, 0),  (12, 0, 14, 0)],
    "facebook":         [(9, 0, 13, 0)],
}

# Days to avoid (0=Mon … 6=Sun); empty = any day is fine
BAD_DAYS: dict[str, list[int]] = {
    "linkedin_article": [4, 5, 6],   # Fri–Sun: B2B audience offline
    "linkedin_post":    [4, 5, 6],
    "x_thread":         [5, 6],
    "instagram":        [],
    "substack":         [4, 5, 6],   # Newsletter readers on Thu or earlier
    "reddit":           [5, 6],
    "facebook":         [5, 6],
}

MIN_SPACING_HOURS = 2   # Minimum gap between posts on the same platform


def _platform_key(component_type: str, spoke: dict | None = None) -> str | None:
    """Map campaign component type to a GOLDEN_WINDOWS key."""
    t = component_type.lower()
    if "article" in t or t == "hub":
        return "linkedin_article"
    if t in ("post_hub", "linkedin_post", "linkedin"):
        return "linkedin_post"
    if "x_thread" in t or "twitter" in t or t == "x":
        return "x_thread"
    if "instagram" in t:
        return "instagram"
    if "reddit" in t:
        return "reddit"
    if "facebook" in t:
        return "facebook"
    if "substack" in t or t in ("source", "newsletter"):
        return "substack"
    # Fall back to spoke fields
    if spoke:
        sid = (spoke.get("id", "") + spoke.get("platform", "")).lower()
        for key in GOLDEN_WINDOWS:
            if key.split("_")[0] in sid:
                return key
    return None


def _get_scheduled_at(component: dict) -> str | None:
    """Extract scheduled_at from a component dict (various schema shapes)."""
    return (
        component.get("scheduled_at")
        or component.get("distribution", {}).get("scheduled_at")
        or component.get("meta", {}).get("scheduled_at")
    )


def _parse_dt(raw: str, tz) -> datetime | None:
    """Parse ISO datetime string and localise to tz."""
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=tz)
        else:
            dt = dt.astimezone(tz)
        return dt
    except ValueError:
        return None


def _in_golden_window(t: time, windows: list[tuple]) -> bool:
    return any(time(sh, sm) <= t <= time(eh, em) for sh, sm, eh, em in windows)


def _window_str(windows: list[tuple]) -> str:
    return ", ".join(f"{sh:02d}:{sm:02d}–{eh:02d}:{em:02d}" for sh, sm, eh, em in windows)


def _check(label: str, platform_key: str, raw_dt: str, tz, findings: list) -> datetime | None:
    """Validate one component's scheduled_at. Appends findings, returns parsed datetime."""
    dt = _parse_dt(raw_dt, tz)
    if dt is None:
        findings.append({
            "severity": "warn",
            "component": label,
            "issue": f"Cannot parse scheduled_at value: '{raw_dt}'",
            "fix": "Use ISO 8601 format, e.g. '2026-05-08T08:00:00' or '2026-05-08T08:00:00-07:00'",
        })
        return None

    bad = BAD_DAYS.get(platform_key, [])
    if dt.weekday() in bad:
        findings.append({
            "severity": "warn",
            "component": label,
            "issue": f"Scheduled on {dt.strftime('%A')} — low-engagement day for {platform_key}",
            "fix": "Move to Mon–Thu for best algorithmic reach",
        })

    windows = GOLDEN_WINDOWS.get(platform_key, [])
    if windows and not _in_golden_window(dt.time(), windows):
        golden_hours = 60 if platform_key in ("linkedin_article", "linkedin_post", "substack") else 30
        findings.append({
            "severity": "warn",
            "component": label,
            "issue": (
                f"Scheduled at {dt.strftime('%H:%M')} ({tz.key}) — outside {platform_key} golden windows "
                f"({_window_str(windows)})"
            ),
            "fix": (
                f"Reschedule into a golden window so the first {golden_hours} min of engagement "
                "velocity reaches real humans and locks in algorithmic distribution"
            ),
        })

    return dt


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"status": "warn", "message": "No input JSON provided.", "findings": []}))
        sys.exit(2)

    try:
        inp = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"status": "warn", "message": f"Invalid input JSON: {e}", "findings": []}))
        sys.exit(2)

    campaign_path = pathlib.Path(inp.get("campaign_file", ""))
    if not campaign_path.exists():
        print(json.dumps({"status": "warn", "message": f"campaign.json not found: {campaign_path}", "findings": []}))
        sys.exit(2)

    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(json.dumps({"status": "warn", "message": f"Cannot parse campaign.json: {e}", "findings": []}))
        sys.exit(2)

    tz_name = (
        inp.get("timezone")
        or campaign.get("meta", {}).get("timezone", "America/Los_Angeles")
    )
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        tz = zoneinfo.ZoneInfo("America/Los_Angeles")

    findings: list[dict] = []
    scheduled: dict[str, list[datetime]] = {}   # platform_key → [datetime, ...]

    # --- source (Substack) ---
    source = campaign.get("source", {})
    if isinstance(source, dict):
        sat = _get_scheduled_at(source)
        if sat:
            dt = _check("source (Substack)", "substack", sat, tz, findings)
            if dt:
                scheduled.setdefault("substack", []).append(dt)

    # --- hub (LinkedIn Article) ---
    hub = campaign.get("hub", {})
    if isinstance(hub, dict):
        sat = _get_scheduled_at(hub)
        if sat:
            dt = _check("hub (LinkedIn Article)", "linkedin_article", sat, tz, findings)
            if dt:
                scheduled.setdefault("linkedin_article", []).append(dt)

    # --- spokes ---
    spokes = campaign.get("spokes", [])
    if isinstance(spokes, dict):
        spokes = list(spokes.values())
    for spoke in spokes:
        if not isinstance(spoke, dict):
            continue
        sat = _get_scheduled_at(spoke)
        if not sat:
            continue
        sid = spoke.get("id", "spoke")
        stype = spoke.get("type", spoke.get("platform", sid))
        pk = _platform_key(stype, spoke)
        if pk:
            dt = _check(f"spoke ({sid})", pk, sat, tz, findings)
            if dt:
                scheduled.setdefault(pk, []).append(dt)

    # --- spacing check ---
    for pk, times in scheduled.items():
        if len(times) < 2:
            continue
        times_sorted = sorted(times)
        for i in range(len(times_sorted) - 1):
            gap_h = (times_sorted[i + 1] - times_sorted[i]).total_seconds() / 3600
            if gap_h < MIN_SPACING_HOURS:
                findings.append({
                    "severity": "warn",
                    "component": f"{pk} spacing",
                    "issue": f"Two {pk} posts scheduled {gap_h:.1f}h apart (minimum {MIN_SPACING_HOURS}h recommended)",
                    "fix": f"Space {pk} posts ≥{MIN_SPACING_HOURS}h apart to avoid algorithm de-prioritisation",
                })

    # --- no scheduling info at all ---
    total_scheduled = sum(len(v) for v in scheduled.values())
    has_content = bool(source or hub or (spokes and len(spokes) > 0))
    if has_content and total_scheduled == 0:
        result = {
            "status": "warn",
            "message": (
                "No scheduled_at timestamps found in any component — golden hour cannot be validated. "
                "Add scheduled_at (ISO 8601) to each component or confirm manual posting with timing awareness."
            ),
            "findings": [],
        }
        print(json.dumps(result))
        sys.exit(2)

    if not findings:
        result = {
            "status": "pass",
            "message": f"All {total_scheduled} scheduled component(s) fall within platform golden windows.",
            "findings": [],
        }
        print(json.dumps(result))
        sys.exit(0)

    # This gate is advisory — all findings are WARNs (wrong timing ≠ invalid campaign)
    msg = f"{len(findings)} golden-hour warning(s): " + "; ".join(f["issue"] for f in findings[:2])
    if len(findings) > 2:
        msg += f" (+{len(findings) - 2} more)"
    result = {"status": "warn", "message": msg, "findings": findings}
    print(json.dumps(result))
    sys.exit(2)


if __name__ == "__main__":
    main()
