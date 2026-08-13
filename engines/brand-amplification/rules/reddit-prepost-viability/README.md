# Reddit pre-post viability gate

This rule is deliberately offline and deterministic. It never fetches Reddit.

## Why there is no `submitted.json` fetch

On 2026-08-13, both of these anonymous requests were verified to return HTTP 403:

- `https://www.reddit.com/user/thewhyman007/submitted.json`
- `https://old.reddit.com/user/thewhyman007/submitted.json`

The XOS-236 premise that post history is available in one anonymous call is therefore false as of that date. A runtime fetch would make the gate fail on every run. History comes from `submission_history` in the input or from the workspace ledger instead.

## Workspace inputs

Default ledger:

`~/anand-career-os/brand-amplification/reddit-surface-history.json`

Schema:

```json
{"handle":"thewhyman007","updated":"2026-08-13","entries":[{"subreddit":"r/LocalLLaMA","date":"2026-08-13","outcome":"removed","removed_by":"moderator","title":"Building got free, so the moat moved"}]}
```

A verified bootstrap copy is included as `reddit-surface-history.seed.json`. Copy it to the default workspace path when initializing the Career OS ledger. The gate does not silently fall back to the bundled seed: if the workspace ledger is absent, `surface_history` returns WARN and explains how to create it.

Default citation research:

`~/anand-career-os/brand-amplification/research/50-subreddits-ai-citation-index-2026.md`

The parser reads Markdown table rows shaped like:

`| 1 | r/AskReddit | How-to & Technical | All engines |`

## Format classifier

The classifier makes no LLM call. It scores inspectable signals:

- Announcing: `I built`, `I'm excited`, `introducing`, `launching`, `check out`, `my new`, `just shipped`, a link in the first 200 body characters, or a product/tool-shaped title.
- Answering: a question-shaped opening, second-person address, concrete numbers or measurements, first-person testing language, method vocabulary, or a comparison table.

The output includes every matched signal and its points. `announcing` wins only when its score is strictly greater than the `answering` score; otherwise the classifier returns `answering`.

## Exit contract

- `0`: all four gates PASS
- `1`: one or more gates BLOCK
- `2`: no BLOCK, but one or more gates WARN

Every invocation prints exactly one aggregate JSON object.
