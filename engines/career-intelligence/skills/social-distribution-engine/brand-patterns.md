---
name: branding-signaling-framework
type: branding-protocol
scope: all articles, posts, threads, newsletter issues, outreach — any externally-published artifact under the customer's brand
created: 2026-04-24
updated: 2026-05-17
why: >
  Articles are branding and signaling artifacts, not tutorials. High-value target tracks
  select for category-defining operators, not content-mill output. A tutorial voice
  ("here are 5 plugins to install") actively anti-signals for investor/operator tracks
  because it positions the author as a student, not a peer. Every article must be
  calibrated to its target track before the first paragraph is written.
customer-config: "$CAREER_HOME/brain/social-distribution-engine/brand-patterns.md"
related:
  - content-flywheel.md
  - CONSTITUTION.md slugs: learning-velocity, signal-curation, zero-flattery, learning-flywheel, signal-amplification, feedback-loop, complementary-composition
---


# Article Signaling Framework — Track-Calibrated

## Architectural context

This framework operates inside the **EMERGENT CYBORG INVARIANT** umbrella (Constitution Ground Zero). All six co-equal frameworks apply when drafting external artifacts: `learning-flywheel` (codify lessons across sessions); `signal-amplification` (separate signal from noise — see anti-move list below); `feedback-loop` (cross-family judges before ship); `complementary-composition` (multi-LLM review); `ship-fast-ship-small-learn-faster-cadence` (small drafts, fast cycles, decaying value); `context-understanding` (read shared state before any cross-thread action).

The customer's specific track targets (Track 1 / Track 2 / Track 3 audiences), biographical shape, and worked examples are declared in `$CAREER_HOME/brain/social-distribution-engine/brand-patterns.md`. This file contains the generic framework only.

## Why this exists

Articles under a personal brand are branding and signaling artifacts. Every one is calibrated for one of three tracks, which select for different things:

| Track | Target audience | What they select for |
|---|---|---|
| **Track 3 (golden)** | Investors, VCs, operator-fellowships, category-defining roles | **Category-defining voice.** Seeing the shape of the market before it's legible. Principled contrarian. Operator-architect, not developer-user. Receipts from real shipped systems. First-mover or convergent timing. |
| **Track 1** | Domain-specific companies (AI-native, technical-depth roles) | **Staff/Principal IC depth.** Substrate-native fluency. Architectural judgment. Independent verification discipline. Real systems in production. |
| **Track 2** | General employers (large tech, non-domain-specific) | **Senior engineering leadership.** Systems thinking, delivery velocity, team scaling, pragmatic tradeoffs. Less substrate-specific. |

Same topic, three different articles. Track 3 ≠ Track 1 ≠ Track 2. Never write a Track 2 article and hope it pulls Track 3 readers — the calibration is legible to the reader within the first paragraph.

The customer's specific Track 3 target companies, Track 1 target companies, and biographical shape are declared in `$CAREER_HOME/brain/social-distribution-engine/brand-patterns.md`.

---

## The eight Track-3 signaling moves

These are the moves that distinguish a fund-partner-voice article from a
content-mill article. Every Track-3 piece should deploy at least four.

### 1. Convergence is stronger than adoption

Do not write "I tried X and it's great." Write "I shipped X six months
ago; the market's leading implementation just shipped the same X — here's
what the convergence tells us about where the category is going."

*Pattern:* A leading open-source tool ships a feature set whose roles match 2/3 of the customer's custom architecture, which has been running for months with a documented governance layer. "I independently converged on the same architecture, but with the governance layer the leading tool still hasn't added" is the Track-3 headline. "Here are 5 [tools]" is the Track-2 floor. The customer's specific worked examples are in their `$CAREER_HOME/brain/social-distribution-engine/brand-patterns.md`.

### 2. Audit, don't recite

Claim-by-claim verification is the partner-caliber move. A content-mill writer passes through unverified claims because a sub-agent said so. A fund-voice writer fetches live data and names the discrepancy: "A sub-agent asserted [X]; I fetched the source live and the real answer is [Y]." Name the verification discipline explicitly. It distinguishes you from 99% of the timeline.

### 3. Category thinking, not tool thinking

"Here's the full stack: Input / Hardware / Governance / Execution / Verification" is category voice. "Here are 5 plugins" is tool voice. Category voice makes the reader think "this person sees the shape of the market." Tool voice makes the reader think "this person uses the tools."

### 4. Principled contrarian, not neutral reviewer

Pick a side on every claim. "[Tool X] is brilliant for parallel orchestration but still missing a principled governance layer — which is why we built [Y]" is a position. "Both approaches have tradeoffs" is content-mill. Neutrality reads as absence of conviction; funds invest in conviction.

### 5. Biographical shape, repeated

Every article reinforces the biographical core specific to the customer — their years of experience at their most distinctive employer, their shipped systems, their open-source or published work. Not as credential spam — as *the shape the audience selects for*. An article that positions the author as "a developer who uses [tool]" actively erodes this shape. Every article must RE-establish it in the opening paragraphs. This is what Reid Hoffman calls "small plates, same table" — same biography served differently every time.

The customer's biographical shape is declared in `$CAREER_HOME/brain/social-distribution-engine/brand-patterns.md` and `$CAREER_HOME/brain/identity/experience-history.md`. Read those before drafting any article — never from memory.

### 6. Receipts from real shipped systems

First-hand paths, real CLI version checks, real hallucinations caught and named, real commits. Never synthetic examples ("imagine a workspace with three agents"). The reader — especially a fund partner — can smell synthetic receipts instantly. Real systems + shipped artifacts + honest blast-radius audits beat any amount of architectural theorizing.

### 7. Name the hallucination

When a model or sub-agent hallucinates, publish the correction explicitly.
This is distinctive because 99% of AI-written content quietly ships the hallucination. "A sub-agent returned [X claim] — that doesn't exist; the verified answer is [Y]" is a reputation-building moment. The fund partner reads that paragraph and thinks "this person has the verification discipline my portfolio companies need."

### 8. Receipts for the moat, not the feature

Funds don't invest in features; they invest in moats. An article that shows "here's the governance layer that governs 20+ repos from one file, and here's what happens when it's missing (the before/after vignette)" is moat-voice. An article that shows "here's a cool hook I wrote" is feature-voice. Every Track-3 piece must answer: *what's the moat, and what happens without it?*

---

## The nine anti-moves (signals Track-2 at best)

- ❌ Opening with a tool/plugin name before establishing architectural frame.
- ❌ "Here are 5/7/10 [X]" listicle structure.
- ❌ Screenshots of terminal output without architectural commentary.
- ❌ "In this article, we'll cover…" / "By the end you'll know…" tutorial-voice scaffolding.
- ❌ Neutrality when a position is available.
- ❌ Synthetic examples when real ones exist.
- ❌ Credential spam (resume dump) without relating it to the argument.
- ❌ Fake numbers from training recall (Ground Zero PRIOR-ART-FRESHNESS).
- ❌ **Asking the user A/B/C on drafting choices the agent has info to make.**
  Drafting is a two-way door (`autonomous-execution` / Kinetic Framework): pick the angle, write
  the draft, let the customer redline. Three headline options + two structure options + "your call on both"
  is a waiter move, not a partner move. Each permission round-trip costs Sacred Time (P13).
  *Origin: the branding framework itself says "pick a side; neutrality reads as absence of conviction."
  Asking A/B/C on drafts contradicts the framework's own first principle.*

---

## Calibration checklist (run before publishing)

Before any article ships, answer these out loud:

1. **Which track is this article for?** (If the answer is "all three," it's miscalibrated — pick one.)
2. **What is the single thesis?** (One sentence. If it takes two, the piece isn't ready.)
3. **What's the moat being shown?** (Not the feature — the thing that compounds.)
4. **Which three of the eight signaling moves does this deploy?** (If fewer than three, it's Track-2 at best.)
5. **What hallucination / easy-miss does the article call out?** (Absent = zero verification-discipline signal.)
6. **Is the biographical shape re-established in the opening?** (Not resume — the *shape*.)
7. **Does the reader arrive at a POSITION the author holds, or a survey they produced?** (Position = Track 3. Survey = Track 2.)
8. **Where's the receipt?** (Real path, real commit, real version string — not synthetic.)

An article that scores ≥6/8 is Track-3 ready. 4–5 is Track-1 floor. ≤3 is Track-2 or content-mill; do not publish under the customer's brand unless explicitly writing to that track.

---

## Agent operating mode: draft-first, ask-never

Every agent working on branded artifacts operates in **draft-first mode**:

- **Default to action on every two-way door.** Drafts, outlines, headline
  choices, structural decisions — all reversible. Pick, draft, let the customer
  redline. Never ask A/B/C.
- **Present work, not questions.** End of turn = "here's the draft at
  `/path/to/file`; I picked headline A and structure Y because
  [one-sentence reason]; redline it or tell me to pivot." Never end with
  "what would you like me to do?"
- **Irreversibles still ask.** Publishing, sending outreach, pushing to
  public repos — these still get explicit approval. Drafts into `WIP/` or
  `research/` never do.
- **When the agent pivots mid-draft, it pivots — doesn't ask.** If mid-way
  through drafting v0.3 the agent realizes Part 3 should be first, it
  re-orders, writes a one-line status, keeps going.
- **Volume is the signal.** Ten drafts the customer redlines beats one draft the
  customer approved after two rounds of "which option do you prefer?" The compounding
  is in the iteration cycle, not the pre-agreement.

*Origin: same 2026-04-24 incident. This section was added inside the same
session the slip happened in — the framework evolves in real-time, which
is the point.*

---

## Applying the calibration checklist to a specific article

When evaluating a draft against this framework, score each of the 8 moves as ✅ or ❌, then note which moves are missing and what would add them. Example pattern:

**Draft scores 5/8:**
- ✅ Category thinking (the "one sentence" thesis)
- ✅ Receipts (real system artifacts, real failure vignette)
- ✅ Biographical shape (established in opening)
- ✅ Position held (clear contrarian claim)
- ✅ Moat voice (the compounding asset is named)
- ❌ No convergence move (didn't locate the author inside the broader ecosystem)
- ❌ No hallucination-naming move (no verification-discipline receipt)
- ❌ Tool-adjacent in places (tactical sections without architectural commentary)

**To reach 7/8:** add a convergence opener, a hallucination-naming paragraph, and elevate one tactical section to a named primitive.

Track-3 angle ≠ Track-1 angle for the same evidence:
- **Track 3:** *"I shipped the architecture the market's leading tool just converged on — [N] months early, with the one layer that leading tool is still missing."*
- **Track 1:** *"[N]-month receipts from a [system] engineering workflow, with the governance layer open-sourced."*

Same evidence. Different framing. Pick the track, then write.

The customer's specific worked examples (their actual articles and scoring) are in `$CAREER_HOME/brain/social-distribution-engine/brand-patterns.md`.

---

## Reference artifacts this framework draws on

- CONSTITUTION.md: P17 (learning velocity), P20 (signal curation), P22
  (boundary-first qualification), Zero Flattery invariant.
- Customer's `$CAREER_HOME/brain/social-distribution-engine/brand-patterns.md`:
  specific track targets, biographical shape, and worked examples for this customer.
- Customer's `$CAREER_HOME/brain/identity/experience-history.md`:
  Biographical shape source — read before drafting any article or outreach.
- `content-flywheel.md`: Campaign-completeness + visual-review invariants
  that govern the ship surface.
- Customer's `$CAREER_HOME/brain/identity/professional-brand.md`:
  Related positioning artifact — cross-reference before any Track-3 article is published.
