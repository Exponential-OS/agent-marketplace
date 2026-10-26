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
  - every vendored package ships at least one file outside .claude-plugin/
  - no NEW vendored file hardcodes a user-specific path (existing ones grandfathered)

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
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CATALOG = REPO / ".claude-plugin" / "marketplace.json"

# Fields an install actually depends on. Keep this honest: adding a field here makes it
# mandatory for every plugin, so it belongs only if an install breaks without it.
REQUIRED_FIELDS = ("name", "source", "version")

# Packages that are advertised but ship no code at all: only .claude-plugin/plugin.json,
# so installing one gets you an empty plugin. Both of these predate this check and are
# GRANDFATHERED rather than failed, so main does not go red over a pre-existing condition.
#
# This is a ratchet, not an exemption. A NEW empty package fails. Removing a name from
# this set is how you record that it was fixed; adding one is how you record, in the diff,
# that the catalog now advertises something that does nothing. Either way it is a visible
# decision instead of a silent state.
#
# Tracked: XOS-346. knowledge-graph and content-adapt are placeholders whose source repos
# do not exist (404 under Exponential-OS).
KNOWN_EMPTY_PACKAGES = {"knowledge-graph", "content-adapt"}

# ── User-specific content in published packages (XOS-349) ────────────────────
#
# This catalog is PUBLIC and vendors code from PRIVATE source repos, so a vendored tree
# is the moment private content becomes published. A plugin that hardcodes one person's
# home directory is both a leak and a product bug: installed anywhere else the path does
# not exist, and the resulting error shows the reader a directory tree they have never
# seen. Observed live -- brand-amplification shipped three such defaults (fixed in 0.65.0).
#
# Deliberately GENERATIVE rather than a list of one username. An absolute path under
# /Users/<name>/ or /home/<name>/ is user-specific whoever the user is, which is the
# property that matters; a hardcoded name only catches the person who already made the
# mistake. PRIVATE_TREES additionally names workspace roots that are private by
# convention even when written in ~ form.
USER_PATH_PATTERNS = (
    re.compile(r"/Users/[A-Za-z0-9._-]+/"),
    re.compile(r"/home/[A-Za-z0-9._-]+/"),
)
PRIVATE_TREES = ("anand-career-os",)

# Files carrying user-specific content TODAY. Grandfathered so this check can land
# without a 21-file cleanup blocking it; a NEW one fails. Shrinking this list is how the
# cleanup gets recorded, and nothing can be added to it without showing up in a diff.
# Tracked on XOS-349.
KNOWN_USER_CONTENT = {
    "engines/brand-amplification/platforms/substack.ts",
    "engines/brand-amplification/rules/reddit-prepost-viability/README.md",
    "engines/brand-amplification/skills/quote-flywheel/SKILL.md",
    "engines/career-intelligence/CHANGELOG.md",
    "engines/career-intelligence/CLAUDE.md",
    "engines/career-intelligence/docs/MEMORY-ACCESS.md",
    "engines/career-intelligence/rules/biographical-claim-precheck/README.md",
    "engines/career-intelligence/tests/test_outreach_dedup.py",
    "engines/co-dialectic/ARCHITECTURE-DECISIONS.md",
    "engines/co-dialectic/CHANGELOG.md",
    "engines/co-dialectic/hooks/codify-scan-on-md-edit.ts",
    "engines/co-dialectic/hooks/task-completed-judge-gate.ts",
    "engines/coordination/.claude-plugin/plugin.json",
    "engines/coordination/CHANGELOG.md",
    "engines/coordination/com.thewhyman.proactive-daemon.plist.template",
    "engines/coordination/hooks/quote-harvester.ts",
    "engines/coordination/proactive-daemon.ts",
    "engines/coordination/test/linear-bus.test.ts",
    "engines/exponential-developer/rules/cost-routing-gate/README.md",
    "engines/exponential-developer/rules/sdlc-worktree-isolation/SPEC.md",
    "engines/xos/commands/swarm-sync.md",
}

# Extensions worth scanning. Binaries and lockfiles are noise.
SCANNED_SUFFIXES = {".md", ".ts", ".js", ".py", ".sh", ".json", ".yaml", ".yml", ".template"}


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

        # Does this package actually ship anything? A tree containing only its own
        # manifest installs cleanly and delivers nothing, which no other check here
        # notices: the source path exists, the manifest parses, the versions agree.
        substantive = [
            f for f in pkg_dir.rglob("*")
            if f.is_file() and ".claude-plugin" not in f.relative_to(pkg_dir).parts
        ]
        if not substantive:
            if name in KNOWN_EMPTY_PACKAGES:
                print(
                    f"  note: {label} ships no code (only .claude-plugin/). Grandfathered "
                    f"via KNOWN_EMPTY_PACKAGES, tracked in XOS-346."
                )
            else:
                fail(
                    problems,
                    f"{label}: vendored tree contains nothing but .claude-plugin/.",
                    "this entry installs cleanly and delivers an empty plugin, which looks "
                    "to the user like the plugin is broken rather than absent. Vendor the "
                    "real package, remove the catalog entry, or — if it is a deliberate "
                    "placeholder — add its name to KNOWN_EMPTY_PACKAGES with a tracking "
                    "ticket, so that choice is recorded in the diff.",
                )

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

    # ── user-specific content sweep (XOS-349) ────────────────────────────
    engines_dir = REPO / "engines"
    scanned = 0
    new_offenders: list[tuple[str, str]] = []
    if engines_dir.is_dir():
        for f in sorted(engines_dir.rglob("*")):
            if not f.is_file() or f.suffix not in SCANNED_SUFFIXES:
                continue
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            scanned += 1
            rel = f.relative_to(REPO).as_posix()
            hit = None
            for pat in USER_PATH_PATTERNS:
                m = pat.search(text)
                if m:
                    hit = m.group(0)
                    break
            if hit is None:
                for tree in PRIVATE_TREES:
                    if tree in text:
                        hit = tree
                        break
            if hit and rel not in KNOWN_USER_CONTENT:
                new_offenders.append((rel, hit))

        if scanned == 0:
            fail(
                problems,
                "engines/ exists but not one file was scanned for user-specific content.",
                "every candidate was filtered out by SCANNED_SUFFIXES, which means this "
                "check silently verified nothing. Treated as a failure rather than a pass.",
            )

    for rel, hit in new_offenders:
        fail(
            problems,
            f"{rel}: contains user-specific content ({hit!r}).",
            "this catalog is PUBLIC and installs on other people's machines, so a path "
            "inside one person's home directory is both a leak and a product bug: it does "
            "not exist for anyone else, and the resulting error shows them a directory "
            "tree they have never seen. Resolve it from an env var with a generic "
            "fallback (see lesson_store.py in brand-amplification for the shape). If it "
            "is genuinely unavoidable, add the path to KNOWN_USER_CONTENT with a reason, "
            "so the decision is recorded in a diff rather than made silently.",
        )

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
