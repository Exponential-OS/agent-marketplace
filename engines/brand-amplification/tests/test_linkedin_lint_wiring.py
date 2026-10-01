#!/usr/bin/env python3
"""XOS-328 — the conventions linter is actually invoked at draft time.

linkedin_post_lint.py encoded nine checks and NOTHING CALLED IT for three weeks. Its own
header names this exact failure and names post_validator.py as the gate that does run:

    "the only thing that runs unprompted at draft time is the validator, and the validator
     never learns."
    "⭐ THE FAILURE IS NOT 'WE DIDN'T WRITE IT DOWN'. IT IS THAT WRITING IT DOWN FEELS LIKE
     CODIFYING AND ISN'T."

These tests exist to make "the linter is wired" a property that fails loudly rather than a
claim in a commit message. Three of them would pass trivially if the linter were silently
unplugged again, so each asserts an OBSERVED finding, not just the absence of a crash.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "social-distribution-engine"))

import post_validator as pv  # noqa: E402


def _rules(result):
    """Rules the LINTER reported, parsed out of the merged violation/warning lines."""
    return sorted(
        {
            line.split("]")[0][1:]
            for line in result["violations"] + result["warnings"]
            if line.startswith("[")
        }
    )


# ── the linter actually runs ────────────────────────────────────────────────

def test_keycap_convention_now_fails_the_gate():
    """The convention Anand taught by hand -- "didn't you learn about special number chars
    for points?" -- now blocks a draft instead of waiting to be caught by eye."""
    r = pv.validate("linkedin_post", "Here are three points.\n1. first\n2. second\n3. third")
    assert r["verdict"] == "fail", r
    assert "keycap_numerals" in _rules(r)
    assert r["lint"]["ran"] is True
    assert r["lint"]["blocking"] >= 1


def test_lint_state_is_reported_so_a_silent_skip_is_visible():
    """Without this field, "linted and clean" and "never linted" are indistinguishable in
    the output -- the XOS-315 defect class, and how this linter stayed dark for weeks."""
    r = pv.validate("linkedin_post", "A claim.\n\nBody.\n\nWhat do you think?")
    assert r["lint"]["ran"] is True
    assert r["lint"]["profile"] == "feed_post"
    assert "findings" in r["lint"] and "stats" in r["lint"]


def test_block_findings_fail_the_verdict_not_just_advise():
    """The linter runs BEFORE the verdict is computed. If it ran after, BLOCK findings would
    be advice appended to an already-decided pass."""
    r = pv.validate("linkedin_post", "Three points.\n1. a\n2. b\n3. c")
    assert r["verdict"] == "fail"
    assert any(line.startswith("[keycap_numerals]") for line in r["violations"])


# ── surfaces are opted in by DATA, never inferred ───────────────────────────

def test_unopted_surface_is_not_linted():
    """Five LinkedIn surfaces exist and the linter has three validated profiles, so any
    automatic mapping would be a guess. Absence of lint_profile means NOT LINTED."""
    r = pv.validate("linkedin_dm", "Hi there.\n1. one\n2. two\n3. three")
    assert r["lint"]["ran"] is False
    assert r["lint"]["reason"] == "no lint_profile for this platform"
    assert "keycap_numerals" not in _rules(r)


def test_opted_surfaces_carry_their_profile_in_data():
    platforms = pv._load_platforms()
    assert platforms["linkedin_post"]["lint_profile"] == "feed_post"
    assert platforms["linkedin_group"]["lint_profile"] == "group_post"
    # Deliberately absent. If a future change opts these in, it must pick a profile
    # consciously rather than inherit feed rules by accident.
    for key in ("linkedin_dm", "linkedin_connection", "linkedin_article"):
        assert "lint_profile" not in platforms[key], key


def test_group_profile_suppresses_the_rules_written_for_a_feed():
    """The linter's header records its hashtag rule false-positiving THREE times in one
    session because feed rules were applied to group posts and comments."""
    text = "A claim that stands on its own.\n\nBody text explaining the claim.\n\nWhat do you think?"
    r = pv.validate("linkedin_group", text)
    assert r["lint"]["profile"] == "group_post"
    assert "hashtags" not in _rules(r)


# ── no double-voicing ───────────────────────────────────────────────────────

def test_rules_the_validator_already_owns_are_not_reported_twice():
    """The linter and the validator independently check markdown, body links and hashtags.
    Reporting each twice in two voices trains the reader to skim past both."""
    r = pv.validate("linkedin_post", "**bold** and a [link](http://x.com) plus padding body text here.")
    reported = _rules(r)
    for owned in ("markdown_bleed", "body_links", "hashtags"):
        assert owned not in reported, f"{owned} double-reported: {reported}"
    # ...and the validator's own versions still fire, so nothing was lost by skipping them.
    assert any("Markdown detected" in v for v in r["violations"])
    assert any("External link" in v for v in r["violations"])


def test_the_skip_set_matches_what_the_validator_actually_enforces():
    """Coupling test. If the validator stops checking one of these, the linter's version
    must be re-enabled or the rule goes dark entirely -- which is this ticket's own bug."""
    assert pv._LINT_ALREADY_ENFORCED == frozenset({"markdown_bleed", "body_links", "hashtags"})
    src = (
        Path(pv.__file__).parent / "post_validator.py"
    ).read_text()
    assert "Markdown detected" in src
    assert "External link(s) detected in body" in src
    assert "Too many hashtags" in src


# ── XOS-328 item 4: the witness-claims false positive ───────────────────────

def test_named_as_bare_verb_is_not_a_witness_claim():
    """"a third way that nobody named" means nobody GAVE IT A NAME, not "nobody said".

    This false-positived on a real shipped post. A linter that flags correct prose on a real
    draft is how it gets ignored -- which this file's own header warns about for the hashtag
    rule. Fixed grammatically, not by phrase allowlist: the exemption requires a relative
    pronoun earlier in the clause AND "named" sitting clause-final with no object.
    """
    from linkedin_post_lint import check_witness_claims as c
    assert c("There is a third way of working with AI that nobody named.") is None
    assert c("A pattern which no one named, until now.") is None


def test_reported_speech_still_flags():
    """The exemption is one verb in one construction. Everything else is untouched."""
    from linkedin_post_lint import check_witness_claims as c
    assert c("Nobody named a single concern in the room.") is not None   # has an object
    assert c("Nobody said anything about the risk.") is not None         # said
    assert c("None of them mentioned the deadline.") is not None         # mentioned
    assert c("They all said the same thing.") is not None                # unanimity
    assert c("Everyone agreed it was the right call.") is not None       # unanimity


def test_the_exemption_is_narrow_by_construction():
    """Guards against a future widening. If the exemption ever matches without a relative
    pronoun, "Nobody named." alone would stop being a claim -- and the regex would be doing
    phrase-matching rather than grammar."""
    from linkedin_post_lint import _NAMED_AS_BARE_VERB
    assert _NAMED_AS_BARE_VERB.search("that nobody named.") is not None
    assert _NAMED_AS_BARE_VERB.search("Nobody named.") is None


# ── non-LinkedIn surfaces are untouched ─────────────────────────────────────

def test_other_platforms_are_unaffected():
    for key in ("substack_post", "x_post", "email_body"):
        r = pv.validate(key, "A plain body of text that says something.")
        assert r["lint"]["ran"] is False, key


if __name__ == "__main__":
    import traceback

    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS  {name}")
            except Exception:
                failed += 1
                print(f"  FAIL  {name}")
                traceback.print_exc()
    print(f"\n{'FAILED' if failed else 'ALL PASS'} ({failed} failure(s))")
    sys.exit(1 if failed else 0)
