#!/usr/bin/env bash
# campaign-preflight/HOW.sh
# Pre-flight gate for any new campaign package generation.
# Reads canonical strategy docs before any content is drafted.
# Usage: bash HOW.sh '<{"campaign_dir":"<abs-path>","action":"new|validate"}>'
# Exit: 0=PASS, 1=BLOCK, 2=WARN
# Logs to: ~/.career-os-enforcement-log.jsonl

set -euo pipefail

CONTEXT="${1:-{}}"
CAMPAIGN_DIR=$(echo "$CONTEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('campaign_dir',''))" 2>/dev/null || echo "")
ACTION=$(echo "$CONTEXT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('action','new'))" 2>/dev/null || echo "new")

_PLUGIN_BASE=$(ls -d "${HOME}/.claude/plugins/cache/xos/career-intelligence/"*/ 2>/dev/null | sort -V | tail -1)
FLYWHEEL="${_PLUGIN_BASE}skills/social-distribution-engine/content-flywheel.md"
SCHEMA_DIR="${_PLUGIN_BASE}skills/social-distribution-engine/campaign-schema"
PLATFORM_SPECS="$SCHEMA_DIR/platform-asset-specs.json"
SCHEMA_JSON="$SCHEMA_DIR/campaign.schema.json"
VALIDATOR="$SCHEMA_DIR/validate-campaign.py"

BLOCKERS=()
WARNINGS=()

log_result() {
  local exit_code="$1"
  local summary="$2"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "{\"ts\":\"$ts\",\"rule\":\"campaign-preflight\",\"exit\":$exit_code,\"summary\":$(echo "$summary" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}" \
    >> "$HOME/.career-os-enforcement-log.jsonl" 2>/dev/null || true
}

# ── REQ 1: Strategy docs must exist and be readable ─────────────────────────
for f in "$FLYWHEEL" "$PLATFORM_SPECS" "$SCHEMA_JSON"; do
  if [[ ! -f "$f" ]]; then
    BLOCKERS+=("Missing strategy doc: $f — agents MUST read this before generating campaigns")
  fi
done

# ── REQ 2: For new campaigns, confirm agent has read the flywheel ────────────
if [[ "$ACTION" == "new" ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║          CAMPAIGN PRE-FLIGHT — REQUIRED READING                 ║"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  echo "║  Before drafting ANY campaign content, read these docs in full: ║"
  echo "║                                                                  ║"
  echo "║  1. $FLYWHEEL"
  echo "║     → Hub/spoke hierarchy, LinkedIn two-tier strategy,          ║"
  echo "║       sequencing order (Article BEFORE Post), algorithm rules   ║"
  echo "║                                                                  ║"
  echo "║  2. $PLATFORM_SPECS"
  echo "║     → Asset dimensions per platform, hashtag limits             ║"
  echo "║                                                                  ║"
  echo "║  3. $SCHEMA_JSON"
  echo "║     → Required campaign.json fields and structure               ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Key invariants this gate enforces:"
  echo "  ✓ LinkedIn Article = ARTICLE SEO HUB (Google-indexed, evergreen, publishes before Post Hub)"
  echo "  ✓ LinkedIn Post = POST HUB (campaign hub, all external spokes drive here)"
  echo "  ✓ External spokes → Post Hub → Article SEO Hub → Substack Honey Pot"
  echo "  ✓ campaign.json (machine) + content/*.md (human) both required"
  echo "  ✓ Assets generated before drafting (not after)"
  echo "  ✓ Platform hashtag limits enforced (LinkedIn ≤5, X ≤3, Instagram ≤30)"
  echo ""
fi

# ── REQ 3: If campaign_dir provided, validate existing campaign.json ─────────
if [[ -n "$CAMPAIGN_DIR" && -d "$CAMPAIGN_DIR" ]]; then
  CAMPAIGN_JSON="$CAMPAIGN_DIR/campaign.json"

  if [[ ! -f "$CAMPAIGN_JSON" ]]; then
    BLOCKERS+=("No campaign.json found at $CAMPAIGN_JSON — every campaign MUST have machine-readable state")
  else
    # Check hub type is article, not post
    HUB_TYPE=$(python3 -c "
import json, sys
with open('$CAMPAIGN_JSON') as f:
    d = json.load(f)
hub = d.get('hub', {})
print(hub.get('type','missing'))
" 2>/dev/null || echo "error")

    if [[ "$HUB_TYPE" == "post" ]]; then
      BLOCKERS+=("campaign.json hub.type='post' — WRONG. LinkedIn Post = Post Hub (campaign juice hub, all spokes drive here), but the JSON 'hub' field must be the Article SEO Hub (type='article'). Post Hub belongs in spokes[] with role='post_hub'. See content-flywheel.md → LinkedIn Two-Tier Strategy.")
    elif [[ "$HUB_TYPE" == "missing" || "$HUB_TYPE" == "error" ]]; then
      WARNINGS+=("campaign.json hub.type missing — should be 'article' (Article SEO Hub) for LinkedIn campaigns")
    fi

    # Check required content files exist
    for f in "content/01-substack-hub.md" "content/02-linkedin-post.md" "content/03-linkedin-article.md"; do
      # Allow alternate naming (02-linkedin-hub-post.md etc)
      base=$(basename "$f" .md)
      prefix=$(echo "$base" | cut -c1-2)
      matches=$(find "$CAMPAIGN_DIR/content" -name "${prefix}-*.md" 2>/dev/null | wc -l)
      if [[ "$matches" -eq 0 ]]; then
        WARNINGS+=("No content file found for $f prefix — check campaign package completeness")
      fi
    done

    # Run validate-campaign.py if available
    if [[ -f "$VALIDATOR" ]]; then
      echo "Running campaign validator..."
      python3 "$VALIDATOR" "$CAMPAIGN_JSON" || true
    fi
  fi
fi

# ── Emit result ──────────────────────────────────────────────────────────────
echo ""
if [[ ${#BLOCKERS[@]} -gt 0 ]]; then
  echo "BLOCK — campaign-preflight: ${#BLOCKERS[@]} blocker(s) found"
  for b in "${BLOCKERS[@]}"; do
    echo "  ❌ $b"
  done
  if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    for w in "${WARNINGS[@]}"; do
      echo "  ⚠ $w"
    done
  fi
  log_result 1 "BLOCK: ${BLOCKERS[*]}"
  exit 1
elif [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo "WARN — campaign-preflight: ${#WARNINGS[@]} warning(s)"
  for w in "${WARNINGS[@]}"; do
    echo "  ⚠ $w"
  done
  log_result 2 "WARN: ${WARNINGS[*]}"
  exit 2
else
  echo "PASS — campaign-preflight: strategy docs present, structure valid"
  log_result 0 "PASS"
  exit 0
fi
