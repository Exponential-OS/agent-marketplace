---
description: Fast short-code form of /exponential-developer:ship-feature — runs the Agentic SDLC pipeline (staged build, cost routing, quality gates, cross-family judge).
argument-hint: "[ticket id or what to build/fix/ship]"
---

# /xdev:ship — fast-invoke for the Agentic SDLC pipeline

This is the short-code alias for `/exponential-developer:ship-feature`. It holds no copy of the
pipeline — it delegates to the single source of truth.

**Do this now:** invoke the `exponential-developer:ship-feature` skill via the Skill tool, forwarding
the user's request verbatim (ticket id / build / fix / ship instruction). That skill is the canonical
Agentic SDLC pipeline — Stage 0 claim, the 9 core stages, Gate-A.5 change-manifest, Gate-A.7
design-review, Stage 5.5–5.8 quality gates, the unskippable cross-family judge, and Stage 10 completion.

Requires `exponential-developer@xos` installed (this wrapper depends on it). If the
`exponential-developer:ship-feature` skill is not available, tell the user to install
`exponential-developer@xos` and stop — do not hand-roll the pipeline.
