# Plugin manifest layout

`plugin.json` — this plugin's identity (name, version, author).

`marketplace.json.archive-2026-04-27` — the **deprecated** standalone marketplace definition. **Do not use.** Career-os ships under the unified `xos` marketplace, defined in the standalone repo `Exponential-OS/agent-marketplace`.

## Install path (canonical)

```
/plugin marketplace add Exponential-OS/agent-marketplace
/plugin install career-os@xos
```

## Legacy paths (still work, but deprecated)

These resolve via legacy mirrors but new users should use the canonical path above:
```
/plugin marketplace add Exponential-OS/prompt-engineering-in-action   # legacy mirror
/plugin install career-os@xos
```

The `career-os-marketplace` standalone marketplace was retired 2026-04-27 in favor of the single `xos` marketplace pattern. Don't use `/plugin install career-os@career-os-marketplace` — that marketplace name no longer points anywhere canonical.

## Why one marketplace per author (with standalone repo)

Standard pattern: ONE marketplace per author/org, listing all their plugins, hosted in its own repo. Per-plugin marketplaces fragment `/plugin marketplace list` and create install-syntax confusion. The standalone repo (`Exponential-OS/agent-marketplace`) decouples marketplace ownership from any single plugin — co-dialectic, career-os, and future xOS plugins (xTeamOS, xHumanOS, xFamilyOS, xCommunityOS) all ship under the unified `@xos` namespace.
