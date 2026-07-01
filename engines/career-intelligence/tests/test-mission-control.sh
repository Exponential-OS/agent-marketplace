#!/usr/bin/env bash
# test-mission-control.sh — Eval suite for mission-control skill
#
# Tests mission-control's detection logic using fixture directories.
# Each fixture simulates a different Career OS state.
# Assertions check that the SKILL.md spec produces correct behavior signals.
#
# Usage: bash tests/test-mission-control.sh
# Exit: 0 = all pass, 1 = failures
#
# Tiers:
#   MC-001, MC-002: Happy path (returning user, first run)
#   MC-003, MC-004, MC-005: Boundary (empty pipeline, stale entry, missing index)
#   MC-006, MC-007: Environmental (missing files, large dataset)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES="$SCRIPT_DIR/fixtures/mission-control"

# --- Test framework (same as test-hooks.sh) ---
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1: $2"; }

assert_file_exists() {
    local desc="$1" path="$2"
    if [ -f "$path" ]; then pass "$desc"
    else fail "$desc" "file not found: $path"; fi
}

assert_dir_exists() {
    local desc="$1" path="$2"
    if [ -d "$path" ]; then pass "$desc"
    else fail "$desc" "directory not found: $path"; fi
}

assert_file_not_exists() {
    local desc="$1" path="$2"
    if [ ! -f "$path" ]; then pass "$desc"
    else fail "$desc" "file should not exist: $path"; fi
}

assert_file_contains() {
    local desc="$1" file="$2" needle="$3"
    if grep -q "$needle" "$file" 2>/dev/null; then pass "$desc"
    else fail "$desc" "file missing '$needle'"; fi
}

assert_line_count_gte() {
    local desc="$1" file="$2" min="$3"
    local count
    count=$(wc -l < "$file" 2>/dev/null | tr -d '[:space:]')
    if [ "$count" -ge "$min" ] 2>/dev/null; then pass "$desc"
    else fail "$desc" "expected >= $min lines, got $count"; fi
}

echo "==================================================="
echo " Mission Control Eval Suite"
echo " Plugin: $PLUGIN_ROOT"
echo " Fixtures: $FIXTURES"
echo "==================================================="
echo ""

# ============================================================
echo "-- Fixture Integrity ----------------------------"
# ============================================================

# Verify all 7 fixtures exist with expected structure
echo "[F0] Fixture directories exist"
for i in mc-001 mc-002 mc-003 mc-004 mc-005 mc-006 mc-007; do
    assert_dir_exists "fixture $i exists" "$FIXTURES/$i"
done
echo ""

# ============================================================
echo "-- MC-001: Returning user dashboard renders -----"
# ============================================================

F="$FIXTURES/mc-001"
assert_file_exists "pipeline exists" "$F/.career-os/memory/job-pipeline.md"
assert_file_exists "tasks exist" "$F/.career-os/tasks/Tasks.md"
assert_file_exists "people file 1" "$F/.career-os/memory/people/jane-doe.md"
assert_file_exists "people file 2" "$F/.career-os/memory/people/john-smith.md"

# Count pipeline entries (non-empty lines with | that aren't headers)
PIPELINE_ENTRIES=$(grep -c '^\s*|[^-]' "$F/.career-os/memory/job-pipeline.md" 2>/dev/null || echo 0)
if [ "$PIPELINE_ENTRIES" -ge 3 ]; then pass "pipeline has >= 3 entries"
else fail "pipeline has >= 3 entries" "got $PIPELINE_ENTRIES"; fi

# Count stories
STORY_COUNT=$(find "$F/.career-os/memory/stories" -name "*.md" ! -name "STORY_INDEX*" 2>/dev/null | wc -l | tr -d '[:space:]')
if [ "$STORY_COUNT" -ge 3 ]; then pass "has >= 3 stories"
else fail "has >= 3 stories" "got $STORY_COUNT"; fi

assert_file_exists "STORY_INDEX exists" "$F/.career-os/memory/stories/STORY_INDEX.md"

# Task priorities
assert_file_contains "tasks has P0 items" "$F/.career-os/tasks/Tasks.md" "P0"
assert_file_contains "tasks has P1 items" "$F/.career-os/tasks/Tasks.md" "P1"
echo ""

# ============================================================
echo "-- MC-002: First-run onboarding triggers --------"
# ============================================================

F="$FIXTURES/mc-002"
# First run = no .career-os/ directory
if [ ! -d "$F/.career-os" ]; then pass "no .career-os/ (first run state)"
else fail "no .career-os/ (first run state)" ".career-os/ exists"; fi
echo ""

# ============================================================
echo "-- MC-003: Empty pipeline graceful handling ------"
# ============================================================

F="$FIXTURES/mc-003"
assert_file_exists "pipeline file exists" "$F/.career-os/memory/job-pipeline.md"

# Pipeline should have structure but no data entries
DATA_ROWS=$(grep -c '^\s*|[^-|]' "$F/.career-os/memory/job-pipeline.md" 2>/dev/null || echo 0)
HEADER_ROWS=$(grep -c '^\s*|.*Company\|^\s*|.*Role\|^\s*|.*Status' "$F/.career-os/memory/job-pipeline.md" 2>/dev/null || echo 0)
ACTUAL_DATA=$((DATA_ROWS - HEADER_ROWS))
if [ "$ACTUAL_DATA" -le 0 ]; then pass "pipeline has zero data entries"
else fail "pipeline has zero data entries" "got $ACTUAL_DATA data rows"; fi
echo ""

# ============================================================
echo "-- MC-004: Stale entry detection -----------------"
# ============================================================

F="$FIXTURES/mc-004"
assert_file_exists "pipeline exists" "$F/.career-os/memory/job-pipeline.md"
assert_file_contains "has old date" "$F/.career-os/memory/job-pipeline.md" "2026-02-15"
assert_file_contains "has waiting status" "$F/.career-os/memory/job-pipeline.md" "Waiting"
assert_file_contains "tasks has waiting entry" "$F/.career-os/tasks/Tasks.md" "Waiting"
echo ""

# ============================================================
echo "-- MC-005: STORY_INDEX gap detection -------------"
# ============================================================

F="$FIXTURES/mc-005"
STORY_COUNT=$(find "$F/.career-os/memory/stories" -name "*.md" ! -name "STORY_INDEX*" 2>/dev/null | wc -l | tr -d '[:space:]')
if [ "$STORY_COUNT" -ge 5 ]; then pass "has >= 5 story files"
else fail "has >= 5 story files" "got $STORY_COUNT"; fi

assert_file_not_exists "no STORY_INDEX.md" "$F/.career-os/memory/stories/STORY_INDEX.md"
echo ""

# ============================================================
echo "-- MC-006: Missing files don't crash -------------"
# ============================================================

F="$FIXTURES/mc-006"
assert_file_exists "pipeline exists" "$F/.career-os/memory/job-pipeline.md"
assert_file_not_exists "tasks intentionally missing" "$F/.career-os/tasks/Tasks.md"
if [ ! -f "$F/.career-os/memory/glossary.md" ]; then pass "glossary intentionally missing"
else fail "glossary intentionally missing" "file exists"; fi
echo ""

# ============================================================
echo "-- MC-007: Large dataset -------------------------"
# ============================================================

F="$FIXTURES/mc-007"

# Pipeline should have 20 entries
PIPELINE_LINES=$(grep -c '^\s*|[^-]' "$F/.career-os/memory/job-pipeline.md" 2>/dev/null || echo 0)
if [ "$PIPELINE_LINES" -ge 20 ]; then pass "pipeline has >= 20 entries"
else fail "pipeline has >= 20 entries" "got $PIPELINE_LINES"; fi

# Tasks should have 15 items
TASK_LINES=$(grep -c '^\s*-\s' "$F/.career-os/tasks/Tasks.md" 2>/dev/null || echo 0)
if [ "$TASK_LINES" -ge 15 ]; then pass "tasks has >= 15 items"
else fail "tasks has >= 15 items" "got $TASK_LINES"; fi

# Stories
STORY_COUNT=$(find "$F/.career-os/memory/stories" -name "*.md" ! -name "STORY_INDEX*" 2>/dev/null | wc -l | tr -d '[:space:]')
if [ "$STORY_COUNT" -ge 10 ]; then pass "has >= 10 stories"
else fail "has >= 10 stories" "got $STORY_COUNT"; fi

# People
PEOPLE_COUNT=$(find "$F/.career-os/memory/people" -name "*.md" 2>/dev/null | wc -l | tr -d '[:space:]')
if [ "$PEOPLE_COUNT" -ge 5 ]; then pass "has >= 5 people files"
else fail "has >= 5 people files" "got $PEOPLE_COUNT"; fi

assert_file_exists "STORY_INDEX exists" "$F/.career-os/memory/stories/STORY_INDEX.md"
echo ""

# ============================================================
echo "-- SKILL.md Spec Compliance ----------------------"
# ============================================================

SKILL="$PLUGIN_ROOT/skills/mission-control/SKILL.md"
assert_file_contains "has stale pipeline detection" "$SKILL" "Stale Pipeline Detection"
assert_file_contains "has 14-day threshold" "$SKILL" "14 days"
assert_file_contains "has pipeline-health.json reference" "$SKILL" "pipeline-health.json"
assert_file_contains "has stale alerts format" "$SKILL" "STALE ALERTS"
assert_file_contains "has first-run behavior" "$SKILL" "First Run"
assert_file_contains "has returning-user behavior" "$SKILL" "Returning User"
assert_file_contains "has beta metrics trigger" "$SKILL" "beta metrics"
assert_file_contains "delegates beta metrics to report.ts" "$SKILL" "src/telemetry/report.ts"
assert_file_contains "labels local NSM estimate" "$SKILL" "ESTIMATE"

# XOS-90: Unified career + brand health dashboard
echo "-- MC-009: Unified Career + Brand Dashboard -----"
assert_file_contains "has unified dashboard section" "$SKILL" "Unified career"
assert_file_contains "dashboard emits viewed telemetry" "$SKILL" "emitDashboardViewed"
assert_file_contains "dashboard has career data flag" "$SKILL" "has_career_data"
assert_file_contains "dashboard has brand data flag" "$SKILL" "has_brand_data"
assert_file_contains "dashboard reuses weekly inbound helper" "$SKILL" "summarizeWeeklyContentInbound"
assert_file_contains "dashboard reuses profile impact helper" "$SKILL" "summarizeProfileChangeImpact"
assert_file_contains "dashboard shows no-data state" "$SKILL" "no data yet"
assert_file_contains "dashboard keeps plain text output" "$SKILL" "no markdown tables"
echo ""

# MC-008: Contact Action Pre-Flight Protocol (v0.35.3)
echo "-- MC-008: Contact Action Pre-Flight Protocol ----"
assert_file_contains "protocol section exists" "$SKILL" "Contact Action Pre-Flight"
assert_file_contains "protocol reads people file" "$SKILL" "network/people/"
assert_file_contains "protocol checks interaction log" "$SKILL" "Interaction Log"
assert_file_contains "protocol has staleness check" "$SKILL" "last_contact"
assert_file_contains "protocol has suppress rule" "$SKILL" "SUPPRESS"
assert_file_contains "protocol is mandatory" "$SKILL" "MANDATORY"
echo ""

# NI-004: Relationship Origin Detection (v0.36.0)
echo "-- NI-004: Relationship Origin Detection ---------"
NI_SKILL="$PLUGIN_ROOT/skills/network-intelligence/SKILL.md"
assert_file_contains "NI: how-do-I-know trigger" "$NI_SKILL" "how do I know"
assert_file_contains "NI: LinkedIn contact_info fetch" "$NI_SKILL" "contact_info"
assert_file_contains "NI: LinkedIn experience fetch" "$NI_SKILL" "sections=\"experience\""
assert_file_contains "NI: LinkedIn inbox fetch" "$NI_SKILL" "search_conversations"
assert_file_contains "NI: experience-history cross-ref" "$NI_SKILL" "experience-history.md"
assert_file_contains "NI: relationship_origin schema field" "$NI_SKILL" "relationship_origin"
assert_file_contains "NI: conversation_history schema field" "$NI_SKILL" "conversation_history"
assert_file_contains "NI: cohort detection" "$NI_SKILL" "Cohort Detection"
assert_file_contains "NI: cohort schema field" "$NI_SKILL" "cohort:"
assert_file_contains "NI: dedup fallback documented" "$NI_SKILL" "conversation_history.last_message_sent"
DEDUP="$PLUGIN_ROOT/rules/warm-contact-outreach-dedup/HOW.py"
assert_file_contains "dedup: last_message_sent fallback in code" "$DEDUP" "last_message_sent"
assert_file_contains "dedup: conversation_history comment" "$DEDUP" "conversation_history"
echo ""

# ============================================================
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
