#!/usr/bin/env python3
"""
Campaign completeness validator — 7-requirement standard.
Usage: python3 validate-campaign.py <campaign.json> [--campaign-dir <path>]
Exit: 0=PASS, 1=BLOCK (hard failures), 2=WARN (soft gaps)
"""

import json
import os
import sys
import struct
import zlib
from pathlib import Path

SCHEMA_DIR = Path(__file__).parent

PLATFORM_HASHTAG_LIMITS = {
    "linkedin":  {"max": 5,  "min": 3},
    "x":         {"max": 3,  "min": 1},
    "instagram": {"max": 30, "min": 15},
    "facebook":  {"max": 3,  "min": 1},
    "reddit":    {"max": 0,  "min": 0},
    "substack":  {"max": 30, "min": 5},
}

PLATFORM_ASSET_DIMS = {
    "substack":  {"cover": (1456, 816)},
    "linkedin":  {"shared_post": (1200, 627), "article_header": (1200, 627)},
    "x":         {"tweet_image": (1200, 675), "tweet_image_sq": (1080, 1080)},
    "instagram": {"feed_post": (1080, 1080), "feed_post_tall": (1080, 1350), "story": (1080, 1920)},
    "facebook":  {"shared_post": (1200, 630)},
    "reddit":    {"post_image": (1080, 1080)},
}


def png_dims(path: Path):
    """Read PNG dimensions without Pillow."""
    try:
        with open(path, "rb") as f:
            sig = f.read(8)
            if sig != b"\x89PNG\r\n\x1a\n":
                return None
            f.read(4)  # chunk length
            chunk_type = f.read(4)
            if chunk_type != b"IHDR":
                return None
            w = struct.unpack(">I", f.read(4))[0]
            h = struct.unpack(">I", f.read(4))[0]
            return (w, h)
    except Exception:
        return None


def load_campaign(path: Path):
    with open(path) as f:
        return json.load(f)


def resolve(campaign_dir: Path, rel_path: str) -> Path:
    return campaign_dir / rel_path


def check_req1_schema(c, errors, warnings):
    """REQ 1: Full flywheel campaign JSON — all required sections present."""
    required = ["meta", "source", "hub", "spokes", "assets", "comment_cascade", "review"]
    for field in required:
        if field not in c:
            errors.append(f"REQ1: Missing top-level field '{field}'. Add it to campaign.json.")
    if "meta" in c:
        for f in ["id", "title", "ship_date", "folder", "status"]:
            if f not in c["meta"]:
                errors.append(f"REQ1: meta.{f} is missing.")
    if "hub" in c:
        hub_required = ["platform", "content_file", "hashtags"]
        # first_comment only applies to post-type hubs; article hubs use body CTAs instead
        if c["hub"].get("type") == "post":
            hub_required.append("first_comment")
        for f in hub_required:
            if f not in c["hub"]:
                errors.append(f"REQ1: hub.{f} is missing.")
    if "spokes" in c and len(c["spokes"]) == 0:
        errors.append("REQ1: spokes array is empty — campaign must have at least one spoke.")
    if "review" in c:
        if "ready_to_publish" not in c["review"]:
            errors.append("REQ1: review.ready_to_publish is missing — this is the execution gate.")


def check_req2_assets(c, campaign_dir: Path, errors, warnings):
    """REQ 2: All assets exist at correct platform dimensions, no sprawl."""
    if "assets" not in c:
        return
    for key, asset in c["assets"].items():
        if "file" not in asset:
            errors.append(f"REQ2: assets.{key} missing 'file' field.")
            continue
        p = resolve(campaign_dir, asset["file"])
        if not p.exists():
            if asset.get("status") == "missing":
                errors.append(
                    f"REQ2: Asset '{key}' is marked 'missing' and file does not exist: {asset['file']}\n"
                    f"       → Generate it before campaign can ship."
                )
            else:
                errors.append(
                    f"REQ2: Asset file not found: {asset['file']}\n"
                    f"       → Run generate-images.py or update the path."
                )
            continue
        expected_dims = asset.get("dims")
        if expected_dims:
            actual = png_dims(p)
            if actual is None:
                warnings.append(f"REQ2: Could not read dimensions for {asset['file']} — verify manually.")
            elif tuple(actual) != tuple(expected_dims):
                errors.append(
                    f"REQ2: Dimension mismatch for assets.{key}: "
                    f"expected {expected_dims[0]}×{expected_dims[1]}, "
                    f"got {actual[0]}×{actual[1]}.\n"
                    f"       → Regenerate at correct dimensions."
                )

    # Check spokes reference assets that exist
    for spoke in c.get("spokes", []):
        if spoke.get("asset") and spoke["asset"].get("file"):
            p = resolve(campaign_dir, spoke["asset"]["file"])
            if not p.exists():
                errors.append(
                    f"REQ2: Spoke '{spoke.get('id')}' references non-existent asset: {spoke['asset']['file']}"
                )


def check_req3_hub_adaptations(c, campaign_dir: Path, errors, warnings):
    """REQ 3: Hub readaptation texts — each spoke content file must exist and be non-trivial."""
    if "hub" in c:
        hub_file = resolve(campaign_dir, c["hub"].get("content_file", ""))
        if not hub_file.exists():
            errors.append(
                f"REQ3: Hub content file not found: {c['hub'].get('content_file')}\n"
                f"       → Write the LinkedIn hub post before shipping."
            )
    for spoke in c.get("spokes", []):
        if "content_file" not in spoke:
            errors.append(f"REQ3: Spoke '{spoke.get('id')}' is missing 'content_file'.")
            continue
        p = resolve(campaign_dir, spoke["content_file"])
        if not p.exists():
            errors.append(
                f"REQ3: Spoke '{spoke.get('id')}' content file not found: {spoke['content_file']}\n"
                f"       → Write the adaptation before shipping."
            )
        else:
            # Check it's non-trivial (>200 chars of actual content)
            text = p.read_text(encoding="utf-8")
            non_comment = "\n".join(l for l in text.splitlines() if not l.strip().startswith("#"))
            if len(non_comment.strip()) < 200:
                warnings.append(
                    f"REQ3: Spoke '{spoke.get('id')}' content file looks too short (<200 chars of copy). "
                    f"Verify it's a real adaptation, not a placeholder."
                )

    if "source" in c:
        src_file = resolve(campaign_dir, c["source"].get("content_file", ""))
        if not src_file.exists():
            errors.append(
                f"REQ3: Source (Substack) content file not found: {c['source'].get('content_file')}"
            )


def check_req4_formatting(c, campaign_dir: Path, errors, warnings):
    """REQ 4: Formatting — check for known formatting anti-patterns in content files."""
    bad_patterns = {
        "[LinkedIn hub post URL — fill in after publishing spoke 1]": (
            "BODY_URL_PLACEHOLDER",
            "URL placeholder in publishable post body. Remove from copy — put the URL in a comment or instruction block."
        ),
        "[PART-3-URL]": (
            "UNRESOLVED_URL_TOKEN",
            "Unresolved URL token in copy. Fill in after publishing, or use a placeholder instruction outside publishable text."
        ),
        "[LinkedIn hub post URL]": (
            "BODY_URL_PLACEHOLDER",
            "URL placeholder in publishable post body."
        ),
    }
    files_to_check = []
    for spoke in c.get("spokes", []):
        if "content_file" in spoke:
            files_to_check.append((spoke.get("id", "spoke"), spoke["content_file"]))
    if "hub" in c and "content_file" in c["hub"]:
        files_to_check.append(("hub", c["hub"]["content_file"]))

    for label, rel_path in files_to_check:
        p = resolve(campaign_dir, rel_path)
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        for pattern, (code, msg) in bad_patterns.items():
            if pattern in text:
                # Only flag if it's NOT inside a clearly-labeled instruction block
                lines = text.splitlines()
                for i, line in enumerate(lines):
                    if pattern in line:
                        # Check if PRECEDING lines indicate an instruction block.
                        # Do NOT check the matching line itself — patterns often contain
                        # "fill in after" which would cause false negatives.
                        preceding = lines[max(0, i-3):i]
                        is_instruction = any(
                            l.strip().startswith(">") or
                            "instruction" in l.lower() or
                            l.strip().startswith("##") and "instruction" in l.lower()
                            for l in preceding
                        )
                        if not is_instruction:
                            errors.append(
                                f"REQ4 [{code}] in {label} ({rel_path}), line {i+1}:\n"
                                f"       Text: {line.strip()[:100]}\n"
                                f"       → {msg}"
                            )
                        break


def check_req5_hashtags(c, errors, warnings):
    """REQ 5: Hashtags — within platform limits and non-empty for relevant platforms."""
    # Hub
    if "hub" in c:
        hub_tags = c["hub"].get("hashtags", [])
        platform = c["hub"].get("platform", "linkedin")
        limits = PLATFORM_HASHTAG_LIMITS.get(platform, {})
        n = len(hub_tags)
        if n == 0:
            errors.append(f"REQ5: Hub ({platform}) has no hashtags.")
        elif limits.get("max", 99) and n > limits["max"]:
            errors.append(
                f"REQ5: Hub ({platform}) has {n} hashtags, max is {limits['max']}. "
                f"Remove {n - limits['max']} to avoid algorithm suppression."
            )
        elif limits.get("min", 0) and n < limits["min"]:
            warnings.append(
                f"REQ5: Hub ({platform}) has only {n} hashtags; sweet spot is {limits['min']}–{limits['max']}."
            )

    # Spokes
    for spoke in c.get("spokes", []):
        platform = spoke.get("platform", "")
        tags = spoke.get("hashtags", [])
        limits = PLATFORM_HASHTAG_LIMITS.get(platform, {})
        n = len(tags)

        if platform == "reddit":
            if n > 0:
                warnings.append(f"REQ5: Spoke '{spoke.get('id')}' (Reddit) has hashtags — Reddit ignores them. Remove for cleanliness.")
            continue

        if n == 0 and platform not in ("reddit",):
            errors.append(f"REQ5: Spoke '{spoke.get('id')}' ({platform}) has no hashtags.")
        elif limits.get("max") and n > limits["max"]:
            errors.append(
                f"REQ5: Spoke '{spoke.get('id')}' ({platform}) has {n} hashtags, max is {limits['max']}. "
                f"Reduce to {limits['max']} or algorithm may suppress."
            )
        elif limits.get("min") and n < limits["min"]:
            warnings.append(
                f"REQ5: Spoke '{spoke.get('id')}' ({platform}) has {n} hashtags; "
                f"sweet spot is {limits['min']}–{limits['max']}."
            )


def check_req6_name_tags(c, errors, warnings):
    """REQ 6: Self-comments should have @name tag structure in comment cascade."""
    cc = c.get("comment_cascade", {})
    targets = cc.get("day_1_targets", [])
    if not targets:
        errors.append("REQ6: comment_cascade.day_1_targets is empty — no flywheel comments defined.")
        return

    all_empty = all(len(t.get("name_tags", [])) == 0 for t in targets)
    if all_empty:
        warnings.append(
            "REQ6: All comment cascade targets have empty name_tags arrays.\n"
            "       → Before shipping, populate from engagement analytics on Parts 1 & 2:\n"
            "         who commented, liked, or shared — add their @handles to relevant targets.\n"
            "         Schema: [{\"handle\": \"@person\", \"reason\": \"Commented on Part 2\"}]"
        )

    for i, target in enumerate(targets):
        if "text" not in target or not target["text"].strip():
            errors.append(f"REQ6: comment_cascade.day_1_targets[{i}] has empty 'text'.")
        if "target_description" not in target:
            errors.append(f"REQ6: comment_cascade.day_1_targets[{i}] missing 'target_description'.")


def check_req7_review_gate(c, errors, warnings):
    """REQ 7: All content saved and human review gate in place."""
    review = c.get("review", {})

    if review.get("ready_to_publish") is True:
        # All review booleans must be True
        gates = ["content_reviewed", "assets_reviewed", "hashtags_reviewed",
                 "formatting_reviewed", "name_tags_verified"]
        incomplete = [g for g in gates if not review.get(g)]
        if incomplete:
            errors.append(
                f"REQ7: ready_to_publish is True but these review gates are not: {incomplete}\n"
                f"       → Complete all review gates before setting ready_to_publish=true."
            )
    else:
        # ready_to_publish is false (correct pre-review state) — just ensure content exists
        gates = ["content_reviewed", "assets_reviewed", "hashtags_reviewed",
                 "formatting_reviewed", "name_tags_verified"]
        false_gates = [g for g in gates if not review.get(g, False)]
        if false_gates:
            warnings.append(
                f"REQ7: Campaign not yet reviewed (ready_to_publish=false). "
                f"Pending review gates: {false_gates}\n"
                f"       → Human reviewer must set all to true, then set ready_to_publish=true before execution."
            )


def main():
    args = sys.argv[1:]
    if not args:
        print("Usage: validate-campaign.py <campaign.json> [--campaign-dir <path>]", file=sys.stderr)
        sys.exit(1)

    campaign_path = Path(args[0])
    campaign_dir = campaign_path.parent

    # Allow override
    if "--campaign-dir" in args:
        idx = args.index("--campaign-dir")
        campaign_dir = Path(args[idx + 1])

    if not campaign_path.exists():
        print(f"ERROR: Campaign file not found: {campaign_path}", file=sys.stderr)
        sys.exit(1)

    try:
        c = load_campaign(campaign_path)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in {campaign_path}: {e}", file=sys.stderr)
        sys.exit(1)

    errors = []
    warnings = []

    check_req1_schema(c, errors, warnings)
    check_req2_assets(c, campaign_dir, errors, warnings)
    check_req3_hub_adaptations(c, campaign_dir, errors, warnings)
    check_req4_formatting(c, campaign_dir, errors, warnings)
    check_req5_hashtags(c, errors, warnings)
    check_req6_name_tags(c, errors, warnings)
    check_req7_review_gate(c, errors, warnings)

    # Report
    campaign_id = c.get("meta", {}).get("id", str(campaign_path))
    print(f"\n{'='*60}")
    print(f"Campaign Validator — {campaign_id}")
    print(f"{'='*60}")

    if errors:
        print(f"\n🚫 BLOCKED — {len(errors)} hard failure(s):\n")
        for i, e in enumerate(errors, 1):
            print(f"  [{i}] {e}\n")

    if warnings:
        print(f"\n⚠️  WARNINGS — {len(warnings)} soft gap(s):\n")
        for i, w in enumerate(warnings, 1):
            print(f"  [{i}] {w}\n")

    if not errors and not warnings:
        print("\n✅ PASSED — all 7 requirements met. Human reviewer may set ready_to_publish=true.\n")
    elif not errors:
        print(f"\n✅ PASSED with warnings — no hard failures. Address warnings before ship.\n")
    else:
        print(f"\nResolve all 🚫 errors before setting ready_to_publish=true or executing any publish action.\n")

    sys.exit(1 if errors else (2 if warnings else 0))


if __name__ == "__main__":
    main()
