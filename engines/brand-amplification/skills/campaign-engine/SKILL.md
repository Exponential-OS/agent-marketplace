---
name: campaign-engine
description: >
  The Master Planner. Initiates campaigns, defines the core thesis, builds the 
  Surface Coverage Matrix, and delegates the actual drafting and sequencing to the 
  Platform-Specific Modules to ensure algorithmic rules are decentralized.
triggers:
  - create campaign
  - build campaign
  - draft campaign
  - start campaign
---

# Campaign Engine

## Purpose

The Campaign Engine is the upstream planner. Rather than acting as a monolithic brain that knows every platform's rules, it acts as the **General Contractor**. It defines the core message and delegates the actual drafting and timing (e.g., "first-hour self-comment on LinkedIn") to the platform-specific modules. This ensures platform knowledge remains perfectly encapsulated.

## Capabilities

### Brain API (brain-kernel >= 1.0.0)

All reads go through `brain.read(path)` / `brain.list(prefix)`. Campaign master
files are written via `brain.write()`. Direct filesystem writes are FORBIDDEN.

### 1. Campaign Initialization
**Triggers:** "create campaign [topic/thesis]"
- Defines the core thesis, the Honey Pot (source material), and the target audience.
- Builds the **Surface Coverage Matrix** by reading `brain.read("identity/handles.md")` (primitive read — reads_from_primitives declared) to ensure no platforms are silently skipped.

### 2. Delegation (Drafting & Sequencing)
The Campaign Engine does **NOT** draft the LinkedIn or X posts directly. 
Instead, it invokes the Platform Modules in "Drafting Mode":
- Sends the core thesis to `linkedin-distribution-module`. The LinkedIn module applies its invisible rules (e.g., plans a comment cascade, schedules a T+15 min self-comment) and returns the draft + execution plan.
- Sends the core thesis to `reddit-distribution-module`. The Reddit module applies its anti-promotion rules and returns a highly technical case-study draft.

### 3. Ledger Generation
- Aggregates the drafts and execution plans from all modules.
- Generates the canonical `campaign-master-<date>.md` file via:
  ```
  brain.write("brand-amplification/campaigns/<campaign-slug>/master.md", content, {
    provenance: { who: "brand-amplification", why: "campaign ledger generated", source: "campaign-engine" },
    engine_id: "brand-amplification"
  })
  ```

### 4. Ground Zero Verification
- Enforces the **Visual-Asset Review Invariant**. It prevents the campaign from moving to the `social-distribution-engine` until a human or secondary reviewer has explicitly verified the visual assets for the generated drafts.
