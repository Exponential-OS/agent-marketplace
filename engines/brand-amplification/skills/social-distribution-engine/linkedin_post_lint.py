#!/usr/bin/env python3
"""
linkedin_post_lint.py — the LinkedIn conventions Anand has already taught, as CODE.

WHY THIS FILE EXISTS (read this before adding another lessons doc)
==================================================================
Anand, 2026-09-10, asked twice in one session:
    "are we learning anything for permanent workflow automation"
    "how come those lessons are not becoming permanent workflow automation"

He was right, and the data is unambiguous. Audit run that night:

  keycap-numeral convention present in flywheel-execution-lessons.md ...... NO
  present in post_validator.py (the gate that ACTUALLY runs at draft time) . NO
  present in platforms.json ............................................... NO
  present in the LinkedIn formatting memory ............................... NO
  where it actually lived ....... a .bak file inside campaign 14's folder
  tickets filed since Sept 8 ............................................. 13
  of those, built .......................................................... 1

⭐ THE FAILURE IS NOT "WE DIDN'T WRITE IT DOWN". IT IS THAT WRITING IT DOWN FEELS
   LIKE CODIFYING AND ISN'T.

A lesson goes: correction → prose in a memory/lessons file → Linear ticket → Backlog.
Every step produces an artifact, so the loop *looks* healthy. But the only thing that
runs unprompted at draft time is the validator, and the validator never learns. So the
next campaign repeats the mistake and the human catches it again.

  ⛔ Filing a ticket is DEFERRING with a paper trail. It is not codification.
  ✅ Codification means: a check that fires without anyone remembering to run it.

Litmus for any future lesson: "If every human forgot this tomorrow, what would still
catch it?" If the honest answer is "an agent might grep the right file" — not codified.

WHAT THIS ENCODES (each rule traces to a specific correction)
--------------------------------------------------------------
1. keycap numerals for enumerable lists  — campaign 14; Anand 2026-09-10:
   "didn't you learn about special number chars for points?"
2. tight line grouping                   — memory feedback_linkedin_post_formatting:
   "blank line between blocks, NOT between every line"
3. no markdown bleed                     — memory feedback_plain_text_for_copy_paste
4. link CONTEXT, not link placement      — ⛔ REVISED 2026-09-13, see below
5. hashtag floor                         — BAE Draft Handoff Gate: 0 hashtags is a defect
6. no engagement bait                    — LinkedIn deck: platform-stated distribution penalty
7. close on a question                   — LinkedIn deck: Hook → Explain → Engage → Interact

⚠️ AUTHORITY RULING, Anand 2026-09-13: "linkedin deck is the authority."
   Source: "[Tech & AI] Elevating Your LinkedIn Content", LinkedIn Creator Enablement, 16pp
   (ref-linkedin-elevating-content-2026.pdf, this folder).
   Our rules were INFERRED from our own campaigns. LinkedIn's are STATED by the platform that
   owns the ranker. On conflict theirs wins — P20, primary source over inference.
   Two of our BLOCKs were contradicted and are now corrected:
     • body links   BLOCK → WARN-if-bare. 3 of 5 exemplars carry body links; one is captioned
                    "Example: Post with external link".
     • hashtags     dropped the "never inline" claim. The deck annotates Asahi Pompey's inline
                    #banker/#financials/#customer approvingly.

⚠️ PLATFORM CONSTRAINT, VERIFIED BY PROBE 2026-09-10 — do not re-derive:
   LinkedIn's post composer is **Quill**. It has NO soft line break reachable via CDP.
   Probe: insertText("AAA") + Shift+Enter + insertText("BBB") → `<p>AAA</p><p>BBB</p>`.
   Shift+Enter, execCommand('insertLineBreak') and a literal <br> in insertHTML ALL
   normalize to separate paragraphs, and every paragraph renders with a blank line.

   ⭐ CONSEQUENCE FOR AUTHORING: a "block" must be written as ONE line. You cannot get
   2-4 tight lines inside a block. Join them with spaces instead. This is why
   check_line_grouping() measures blocks-as-lines rather than hunting for soft breaks.

   ⛔ Also: execCommand('insertParagraph') RESETS THE CARET TO THE START — building a
   post line-by-line with it silently produces the post in REVERSE ORDER. Use
   insertHTML with one <p> per block instead; order is preserved.

Usage:
    python3 linkedin_post_lint.py --text "$(cat post.txt)"
    python3 linkedin_post_lint.py --file post.txt
    from linkedin_post_lint import lint; lint(text)   # -> {"PASS":bool,"findings":[...]}
"""
import re, sys, json, argparse

KEYCAPS = ["1\ufe0f\u20e3","2\ufe0f\u20e3","3\ufe0f\u20e3","4\ufe0f\u20e3",
           "5\ufe0f\u20e3","6\ufe0f\u20e3","7\ufe0f\u20e3","8\ufe0f\u20e3",
           "9\ufe0f\u20e3","\U0001f51f"]  # list, not a str — each keycap is 3 codepoints,
# so slicing the string cut mid-emoji and printed "1\ufe0f\u20e32" in a fix hint.
KEYCAP_RE = re.compile(r'[0-9]️?⃣')
# plain enumerations a human would render as a list
ENUM_RE = re.compile(r'^\s*(?:\d+[\.\)]\s+|[-*•]\s+)', re.M)


def _blocks(text):
    return [l for l in text.split("\n") if l.strip()]


def check_keycap_numerals(text):
    """Enumerable content must use keycap numerals, not '1.' / '-' / bare lines.

    Origin: Anand — "didn't you learn about special number chars for points?"
    LinkedIn renders plain text; markdown list markers do not render as lists, and a
    bare enumeration reads as a wall. Keycaps survive and scan.
    """
    if KEYCAP_RE.search(text):
        return None
    plain = ENUM_RE.findall(text)
    if plain:
        return {"rule": "keycap_numerals", "severity": "BLOCK",
                "detail": f"{len(plain)} markdown-style list marker(s) and no keycap numerals",
                "fix": f"Replace list markers with keycaps ({' '.join(KEYCAPS[:4])} …). LinkedIn does not render markdown lists."}
    # heuristic: 3+ consecutive short blocks that each start a new assertion = a latent list
    bs = _blocks(text)
    run = 0
    for b in bs:
        if 25 < len(b) < 145 and not b.startswith("#"):
            run += 1
            if run >= 4:
                return {"rule": "keycap_numerals", "severity": "WARN",
                        "detail": f"{run} consecutive short blocks read as a latent list with no keycap numerals",
                        "fix": f"If these are parallel points, number them {' '.join(KEYCAPS[:4])} so they scan."}
        else:
            run = 0
    return None


def check_line_grouping(text):
    """Blank line BETWEEN blocks, never after every line.

    Origin: memory feedback_linkedin_post_formatting — Anand fixed this by hand once.
    ⚠️ Because Quill has no soft break (see module docstring), the ONLY way to comply is
    to author each block as a single line. So this check flags the authoring shape:
    many very short lines means the author intended tight groups that Quill will explode
    into blank-line-separated paragraphs.
    """
    bs = _blocks(text)
    if len(bs) < 4:
        return None
    short = [b for b in bs if len(b) < 60 and not b.startswith("#") and not KEYCAP_RE.match(b.strip()[:3])]
    ratio = len(short) / len(bs)
    if ratio > 0.5:
        return {"rule": "line_grouping", "severity": "WARN",
                "detail": f"{len(short)}/{len(bs)} blocks are under 60 chars (ratio {ratio:.2f})",
                "fix": "Quill renders EVERY line as its own paragraph with a blank line after it. "
                       "Join lines that belong together into one line, or the post ships airy."}
    return None


def check_markdown_bleed(text):
    """No markdown survives LinkedIn. Origin: feedback_plain_text_for_copy_paste."""
    hits = []
    if re.search(r'\*\*[^*]+\*\*', text): hits.append("**bold**")
    if re.search(r'(?<!\w)_[^_]+_(?!\w)', text): hits.append("_italic_")
    if "|" in text: hits.append("pipe character")
    if re.search(r'`[^`]+`', text): hits.append("backtick")
    if re.search(r'^\s*#{1,6}\s+\S', text, re.M): hits.append("# heading")
    if re.search(r'^\s*>', text, re.M): hits.append("> blockquote")
    if hits:
        return {"rule": "markdown_bleed", "severity": "BLOCK",
                "detail": "renders literally on LinkedIn: " + ", ".join(hits),
                "fix": "Strip to plain prose. Emphasis via line breaks and word choice only."}
    return None


def check_no_body_links(text):
    """⛔ DOWNGRADED FROM BLOCK — 2026-09-13. LinkedIn's own deck overrules us.

    We blocked external body links on the belief that LinkedIn suppresses them. LinkedIn's
    creator-enablement deck showcases THREE of its five exemplar posts WITH links in the body,
    one of them captioned verbatim "Example: Post with external link" (Brendan Gahan), plus
    Burcin Kaplanoglu's paper link and Arianna Huffington's study link.

    Anand ruled 2026-09-13: the deck is the authority. A rule we inferred does not outrank the
    platform stating otherwise.

    ⭐ What the exemplars DO have in common is that the link is introduced, never bare:
    "Great piece via Lara O'Reilly", "*Paper: https://…". So the surviving rule is about
    CONTEXT, not placement.
    """
    urls = [u for u in re.findall(r'https?://[^\s]+', text) if "linkedin.com" not in u]
    if not urls:
        return None
    bare = []
    for u in urls:
        line = next((ln for ln in text.splitlines() if u in ln), u)
        if len(line.strip()) - len(u) < 12:          # URL is essentially the whole line
            bare.append(u)
    if bare:
        return {"rule": "body_links", "severity": "WARN",
                "detail": f"{len(bare)} bare URL(s) with no introduction: {bare[:2]}",
                "fix": "Introduce the link the way LinkedIn's own exemplars do — name the source "
                       "or say what it is ('Great piece via …', '*Paper: …'). Placement in the "
                       "body is fine; an unexplained URL is what reads as a drop."}
    return None


def check_hashtags(text, lo=3, hi=5):
    n = len(re.findall(r'(?<!\w)#\w+', text))
    if n == 0:
        return {"rule": "hashtags", "severity": "BLOCK", "detail": "0 hashtags",
                "fix": f"Add {lo}-{hi} hashtags: brand + niche + reach. Inline IS fine — LinkedIn's own deck "
                       f"annotates Asahi Pompey's inline #banker/#financials/#customer approvingly. "
                       f"End-of-post is still the safe default for a hub post."}
    if n < lo:
        return {"rule": "hashtags", "severity": "WARN", "detail": f"only {n} hashtag(s)",
                "fix": f"Use {lo}-{hi}: brand + niche + reach."}
    if n > hi:
        return {"rule": "hashtags", "severity": "WARN", "detail": f"{n} hashtags exceeds {hi}",
                "fix": f"Trim to {hi}."}
    return None



# claims about what OTHER PEOPLE said — the agent cannot know these
# ⚠️ WIDENED 2026-09-11. The original pattern required "of them" and so MISSED
# "Not one said model quality" — the exact sentence this gate exists to catch, in the
# group-post copy, hours after the feed-post version was corrected. A gate that only
# catches one phrasing of its own founding error is not a gate.
WITNESS_RE = re.compile(
    r"\b(?:"
    r"not one\b(?:\s+of\s+them)?\s+(?:said|mentioned|raised|named)"
    r"|none\b(?:\s+of\s+them)?\s+(?:said|mentioned|raised|named)"
    r"|no\s+one\s+(?:said|mentioned|raised|named)"
    r"|nobody\s+(?:said|mentioned|raised|named)"
    r"|every\s+one\s+of\s+them|all\s+of\s+them\s+(?:said|agreed)"
    r"|they\s+all\s+said|each\s+of\s+them\s+said|unanimously"
    r"|everyone\s+(?:said|agreed)|to\s+a\s+person"
    r")\b", re.I)


# ⚠️ NARROW EXEMPTION for the ONE ambiguous verb in WITNESS_RE (XOS-328 item 4).
#
# "named" carries two unrelated senses and only one of them is a witness claim:
#
#   reported speech  "nobody named a single concern"     -> IS a claim about what people said
#   bare verb        "a third way that nobody named."    -> is "nobody gave it a name"
#
# The second shape false-positived on a real shipped post ("the third way of working with AI
# that nobody named"), and a linter that flags correct prose on a real draft is how it gets
# ignored -- which the header of this file already warns about for the hashtag rule.
#
# The disambiguator is grammatical, not a phrase allowlist: in the bare-verb sense the OBJECT
# OF "named" IS THE ANTECEDENT of a relative clause, so the verb is clause-final with nothing
# after it. Reported speech always carries what was said. So the exemption requires BOTH:
#   (a) a relative pronoun (that/which/who) earlier in the same clause, AND
#   (b) "named" sitting at the end of the clause, with no object following.
#
# Enumerated deliberately rather than loosened: this exempts one verb in one grammatical
# construction. "said", "mentioned" and "raised" are untouched, because none of them has a
# bare-verb reading that collides with reported speech.
_NAMED_AS_BARE_VERB = re.compile(
    r"\b(?:that|which|who)\b[^.?!\n]{0,90}?"
    r"\b(?:nobody|no\s+one|none(?:\s+of\s+them)?|not\s+one(?:\s+of\s+them)?)\s+named\b"
    r"\s*(?=[.,;:!?)\u2014-]|$)",
    re.I | re.M,
)


def _witness_hits(text):
    """WITNESS_RE matches, minus any that are the bare-verb sense of "named".

    Returns the matched phrases, so the caller's reporting is unchanged.
    """
    exempt_spans = [m.span() for m in _NAMED_AS_BARE_VERB.finditer(text)]
    hits = []
    for m in WITNESS_RE.finditer(text):
        start, end = m.span()
        if any(a <= start and end <= b for a, b in exempt_spans):
            continue
        hits.append(m.group(0))
    return hits


def check_witness_claims(text):
    """Flag reported speech about real people the agent did not hear.

    ⭐ ORIGIN — Anand, 2026-09-10, on a hub post one click from publishing:
        "'Not one of them said model quality. They said cost against latency. Every time.'
         that is wrong - they all want quality with cost vs latency as a balance."

    He was at that bank dinner. The agent was not. The line was INVENTED because it made a
    punchier hook — the same failure mode as the fabrication memory: a model fabricates when
    the output requirement REWARDS inventing a claim, not merely when a gate is absent. A
    strong opening rewards a crisp absolute, so the agent supplied one.

    ⚠️ It was also self-contradicting: the linked article argues "Precision is the GOAL; cost
    and latency are bars." The post claimed quality never came up. Both cannot be true, and
    the published piece would have been the witness against the post.

    RULE: an absolute about what real people said is HIS to make, never the agent's. Attribute
    to one named source he confirmed, soften to what was observed, or cut it.
    """
    hits = _witness_hits(text)
    if hits:
        return {"rule": "witness_claims", "severity": "BLOCK",
                "detail": "absolute claim(s) about what other people said: " + ", ".join(sorted(set(h.lower() for h in hits))),
                "fix": "You were not in the room. Ground it in what Anand actually reported, "
                       "attribute to one confirmed source, or cut the absolute. Then check it does "
                       "not contradict the linked article's thesis."}
    return None



# first line reads as SETUP (an action the author took) rather than a CLAIM
SETUP_OPENER_RE = re.compile(
    r"^\s*(?:I|We)\s+(?:asked|was|went|sat|spoke|talked|met|attended|ran|did|spent|had|"
    r"noticed|realised|realized|started|decided|wanted)\b", re.I)


def check_hook_is_claim(text):
    """The first line must be a CLAIM someone could argue with, not a SETUP for one.

    ⭐ ORIGIN — campaign 20, measured not guessed. The hub post opened:
        "I asked a room of bank engineering leaders what actually blocks AI from reaching customers."
    It reached **547 impressions in 10 hours with ZERO inbound comments or reactions.** Reach was
    fine and still climbing; nobody stopped. Seven group posts carrying the same opener also went
    to zero.

    The defect: that line PROMISES a finding and DELAYS it. On mobile the reader must tap "…more"
    before any claim lands, so the payload is behind a click that a scroller never makes. The line
    actually doing work sat four paragraphs down:

        "Cost drift is when the answers stay exactly as good and the economics move underneath them."

    That one is arguable. Arguable is what earns a comment.

    ⚠️ DIAGNOSTIC, worth more than the check: **high impressions + near-zero engagement is a HOOK
    problem, not a distribution problem.** Do not respond by posting to more surfaces — that
    multiplies a hook nobody is biting on. Rough read: several hundred impressions and still zero
    inbound after a few hours means the first line is not doing its job.

    ✅ THE FIX THAT WORKED: a self-reply leading with the cost-drift claim cold, no setup, ending
    on a genuine question. Cheap, additive, and it tests the hypothesis without touching live copy.

    RULE: lead with the most arguable sentence you have. Setup, credentials and provenance go
    AFTER the claim, or in the article, or nowhere.
    """
    first = next((l.strip() for l in text.split("\n") if l.strip()), "")
    if not first:
        return None
    if SETUP_OPENER_RE.match(first):
        return {"rule": "hook_is_claim", "severity": "WARN",
                "detail": f"opens with setup, not a claim: {first[:70]!r}",
                "fix": "Lead with the most arguable sentence in the piece — the line a reader "
                       "could disagree with. Move the setup below it. High impressions with zero "
                       "engagement is a hook problem, not a reach problem."}
    return None


# ══════════════════════════════════════════════════════════════════════════════
# LINKEDIN'S OWN DECK IS THE AUTHORITY  (Anand, 2026-09-13)
#
# Source: "[Tech & AI] Elevating Your LinkedIn Content", LinkedIn Creator Enablement,
#         16pp — ref-linkedin-elevating-content-2026.pdf in this folder.
#
# Our rules were INFERRED from our own campaign experiments. LinkedIn's are STATED by
# the platform that owns the ranker. On conflict, theirs wins (P20: primary source over
# inference). Two of our BLOCK rules were contradicted outright and are corrected below.
# ══════════════════════════════════════════════════════════════════════════════

BAIT_RE = re.compile(
    r"(?:"
    r"comment\s+(?:[\"']?yes[\"']?|below\s+if|if\s+you)"
    r"|like\s+if\s+you"
    r"|drop\s+a\s+[\"']?\w+[\"']?\s+(?:below|in\s+the\s+comments)"
    r"|tag\s+someone\s+who"
    r"|repost\s+if"
    r"|who\s+else\s+(?:agrees|is\s+with\s+me)"
    r")", re.I)


def check_engagement_bait(text):
    """LinkedIn names engagement bait as a distribution-slowing factor.

    Deck, "This could slow down distribution": Engagement bait — "Comment YES", "Like if…".
    Platform-stated penalty, so this is a BLOCK rather than a style note.
    ⚠️ Relevant to BAE specifically: our own CTA gates push bookmark/save/DM-share prompts,
    which sit close to this line. A prompt that asks for a REACTION is bait; one that offers
    a reason to save something is not.
    """
    m = BAIT_RE.search(text)
    if m:
        return {"rule": "engagement_bait", "severity": "BLOCK",
                "detail": f"engagement bait: {m.group(0)!r}",
                "fix": "Ask for a THOUGHT, not a reaction. 'What am I missing here?' invites a "
                       "reply worth reading; 'Comment YES' is the pattern LinkedIn down-ranks."}
    return None


def check_ends_with_engagement(text):
    """Deck, Anatomy of a Great LinkedIn Post → ENGAGE:
    "End your content with a question or an idea that encourages discussion."
    """
    body = re.sub(r"(?m)^\s*#\w+.*$", "", text).strip()      # ignore trailing hashtag block
    tail = "\n".join([b for b in _blocks(body)][-2:])
    if not tail:
        return None
    if "?" in tail:
        return None
    if re.search(r"\b(what|how|where|would you|curious|tell me|your take|disagree|push back)\b", tail, re.I):
        return None
    return {"rule": "ends_with_engagement", "severity": "WARN",
            "detail": "closing block neither asks a question nor invites discussion",
            "fix": "Close on a question or an open idea. LinkedIn's own post anatomy is "
                   "Hook → Explain → Engage → Interact; this post stops at Explain."}


CHECKS = (check_keycap_numerals, check_line_grouping, check_markdown_bleed,
          check_no_body_links, check_hashtags, check_witness_claims,
          check_hook_is_claim, check_engagement_bait, check_ends_with_engagement)


# ⚠️ CONTEXT PROFILES — added after the hashtag rule false-positived THREE times in one
# session (group post, first comment, self-reply). The rules were written for a FEED POST and
# then applied to every surface. A linter that cries wolf on two-thirds of what it sees gets
# ignored, which is worse than no linter.
#   feed_post  — the hub post. Hashtags expected.
#   group_post — LinkedIn group. ⛔ NO hashtags by deliberate choice (they add nothing inside a
#                group's own discovery context) and no body-link penalty.
#   comment    — first comment, self-reply, cascade. No hashtags, links ARE the point.
PROFILES = {
    "feed_post":  {"skip": set()},
    "group_post": {"skip": {"hashtags", "body_links"}},
    "comment":    {"skip": {"hashtags", "body_links"}},
}


def lint(text, profile="feed_post"):
    skip = PROFILES.get(profile, PROFILES["feed_post"])["skip"]
    findings = [f for f in (c(text) for c in CHECKS) if f and f["rule"] not in skip]
    blocks = [f for f in findings if f["severity"] == "BLOCK"]
    return {"PASS": not blocks, "blocking": len(blocks), "profile": profile, "findings": findings,
            "stats": {"chars": len(text), "blocks": len(_blocks(text)),
                      "keycaps": len(KEYCAP_RE.findall(text)),
                      "hashtags": len(re.findall(r'(?<!\w)#\w+', text))}}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--text"); ap.add_argument("--file")
    ap.add_argument("--profile", default="feed_post", choices=sorted(PROFILES))
    a = ap.parse_args()
    t = open(a.file).read() if a.file else (a.text or sys.stdin.read())
    r = lint(t, a.profile)
    print(json.dumps(r, indent=1, ensure_ascii=False))
    sys.exit(0 if r["PASS"] else 1)
