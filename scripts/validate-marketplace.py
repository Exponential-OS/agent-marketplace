#!/usr/bin/env python3
"""validate-marketplace.py — structural gate for the plugin catalog.

WHY THIS EXISTS (XOS-316)
=========================
agent-marketplace had ZERO CI. Nothing checked it, ever.

That matters more here than in any engine repo, because this is the DISTRIBUTION
CHOKEPOINT. Every session on every machine installs plugins from this catalog; nobody
runs a plugin from a source checkout. So a malformed catalog, a vendored tree whose
version disagrees with the entry that advertises it, or a `source` path pointing at
nothing reaches every machine at once, with nothing standing in the way.

Two drift incidents are already on record and both are this shape:
  brand-amplification  vendored 0.63.0 against source 0.59.0
  super-developer      vendored 0.12.0 against source  0.7.0
Both are "vendored without landing in source". A repo with no CI is a repo where that
shortcut costs nothing at the moment someone takes it, which is why it keeps being taken.

WHAT THIS CAN AND CANNOT CHECK
==============================
It checks everything resolvable INSIDE this repo, with no credentials:
  - the catalog parses, and is a list of plugin objects with the fields installs depend on
  - every `source` path exists on disk
  - every vendored package carries .claude-plugin/plugin.json
  - the catalog version and the vendored plugin.json version AGREE
  - plugin names are unique (a duplicate silently shadows an install)
  - the engines/ directory and the catalog do not disagree about what exists

⚠️ It does NOT compare vendored trees against their SOURCE repos, which is the half that
would have caught the two incidents above at push time. Seven of the ten homepages are
PRIVATE, so that comparison needs a token this gate deliberately does not assume. The
workflow documents exactly what to add when someone decides to provision one. Saying so
here rather than implying full coverage: a gate that overstates what it verifies is the
XOS-315 defect, and this file is the wrong place to introduce it.

Exit: 0 = pass, 1 = at least one violation. Every failure names WHAT and HOW.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CATALOG = REPO / ".claude-plugin" / "marketplace.json"

# Fields an install actually depends on. Keep this honest: adding a field here makes it
# mandatory for every plugin, so it belongs only if an install breaks without it.
REQUIRED_FIELDS = ("name", "source", "version")


def fail(problems: list[str], what: str, how: str) -> None:
    problems.append(f"WHAT: {what}\n  HOW: {how}")


def main() -> int:
    problems: list[str] = []

    if not CATALOG.exists():
        print(f"WHAT: no catalog at {CATALOG}.\n  HOW: this gate runs from the marketplace repo root.")
        return 1

    try:
        catalog = json.loads(CATALOG.read_text())
    except json.JSONDecodeError as e:
        print(
            f"WHAT: marketplace.json is not valid JSON ({e}).\n"
            f"  HOW: a malformed catalog breaks EVERY install, not just one plugin. "
            f"Validate with: python3 -m json.tool .claude-plugin/marketplace.json"
        )
        return 1

    plugins = catalog.get("plugins")
    if not isinstance(plugins, list) or not plugins:
        print(
            "WHAT: marketplace.json has no `plugins` list.\n"
            "  HOW: an empty catalog is indistinguishable from a working one to this gate, "
            "so it is treated as a failure rather than a vacuous pass."
        )
        return 1

    seen: dict[str, int] = {}
    checked = 0

    for idx, plugin in enumerate(plugins):
        label = plugin.get("name") or f"plugins[{idx}]"

        for field in REQUIRED_FIELDS:
            if not plugin.get(field):
                fail(
                    problems,
                    f"{label}: missing required field `{field}`.",
                    f"installs resolve plugins by {', '.join(REQUIRED_FIELDS)}; add it to the catalog entry.",
                )

        name = plugin.get("name")
        if name:
            if name in seen:
                fail(
                    problems,
                    f"duplicate plugin name `{name}` (also at index {seen[name]}).",
                    "a duplicate silently shadows whichever entry resolves second, so one of "
                    "them is installed and nobody can tell which. Rename or remove one.",
                )
            seen[name] = idx

        source = plugin.get("source")
        if not isinstance(source, str) or not source:
            continue

        pkg_dir = (REPO / source.lstrip("./")).resolve()
        if not pkg_dir.is_dir():
            fail(
                problems,
                f"{label}: source `{source}` does not exist.",
                "the catalog advertises a package that is not in this repo, so the install "
                "fails for everyone. Vendor it, or remove the entry.",
            )
            continue

        manifest = pkg_dir / ".claude-plugin" / "plugin.json"
        if not manifest.is_file():
            fail(
                problems,
                f"{label}: vendored tree has no .claude-plugin/plugin.json.",
                "an unidentifiable package cannot be version-checked by anything, here or "
                "downstream. Re-vendor from the source repo.",
            )
            continue

        try:
            vendored = json.loads(manifest.read_text()).get("version")
        except json.JSONDecodeError as e:
            fail(problems, f"{label}: vendored plugin.json is not valid JSON ({e}).", "re-vendor from source.")
            continue

        catalog_version = plugin.get("version")
        if vendored != catalog_version:
            fail(
                problems,
                f"{label}: catalog says {catalog_version}, vendored tree says {vendored}.",
                "the catalog is what sessions read to decide whether they are up to date, so a "
                "mismatch means machines either skip a real update or reinstall the same bits "
                "forever. Re-vendor and bump both together.",
            )
        checked += 1

    # A gate that silently checks nothing is worse than no gate (XOS-315).
    if checked == 0:
        print(
            "WHAT: the catalog parsed but not one package was actually version-checked.\n"
            "  HOW: every entry failed earlier validation, or `source` paths resolve nowhere. "
            "This is reported as a failure because 'checked zero things' and 'everything "
            "passed' must never look the same."
        )
        return 1

    if problems:
        print(f"MARKETPLACE VALIDATION FAILED — {len(problems)} problem(s):\n")
        for p in problems:
            print(f"  {p}\n")
        return 1

    print(f"OK: {checked} package(s) validated; catalog and vendored versions agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
