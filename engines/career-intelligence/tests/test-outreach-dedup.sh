#!/usr/bin/env bash
# test-outreach-dedup.sh — Tests for warm-contact-outreach-dedup enforcement
#
# Validates that:
#   1. HOW.py BLOCKs when last_contact is within 14 days
#   2. HOW.py PASSes when last_contact is older than 14 days
#   3. HOW.py PASSes when no people file exists
#   4. HOW.py BLOCKs on missing contact_name
#   5. outreach-composer SKILL.md contains a mandatory STEP 0 dedup pre-flight
#
# Usage: bash tests/test-outreach-dedup.sh
# Exit: 0 = all pass, 1 = failures

set -uo pipefail

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1: $2"; }

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then pass "$desc"
    else fail "$desc" "expected '$expected', got '$actual'"; fi
}

assert_contains() {
    local desc="$1" haystack="$2" needle="$3"
    if grep -q "$needle" <<< "$haystack" 2>/dev/null; then pass "$desc"
    else fail "$desc" "expected to contain '$needle'"; fi
}

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/rules/warm-contact-outreach-dedup/HOW.py"
SKILL="$(cd "$(dirname "$0")/.." && pwd)/skills/outreach-composer/SKILL.md"
TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

echo ""
echo "━━━ Test: warm-contact-outreach-dedup/HOW.py ━━━"
echo ""

# --- Test 1: BLOCK when last_contact is within 14 days ---
RECENT_DATE=$(python3 -c "import datetime; print((datetime.date.today() - datetime.timedelta(days=3)).isoformat())")
cat > "$TMPDIR_TEST/test-person.md" <<EOF
---
name: Test Person
last_contact: $RECENT_DATE
---
# Test Person
EOF

OUTPUT=$(python3 "$SCRIPT" "{\"contact_name\": \"Test Person\", \"people_dir\": \"$TMPDIR_TEST\"}" 2>&1)
EXIT_CODE=$?
assert_eq "BLOCK when last_contact 3 days ago (exit code)" "1" "$EXIT_CODE"
assert_contains "BLOCK when last_contact 3 days ago (verdict)" "$OUTPUT" '"verdict": "BLOCK"'
assert_contains "BLOCK when last_contact 3 days ago (days_since)" "$OUTPUT" '"days_since_outreach"'

# --- Test 2: PASS when last_contact is older than 14 days ---
OLD_DATE=$(python3 -c "import datetime; print((datetime.date.today() - datetime.timedelta(days=20)).isoformat())")
cat > "$TMPDIR_TEST/old-contact.md" <<EOF
---
name: Old Contact
last_contact: $OLD_DATE
---
# Old Contact
EOF

OUTPUT=$(python3 "$SCRIPT" "{\"contact_name\": \"Old Contact\", \"people_dir\": \"$TMPDIR_TEST\"}" 2>&1)
EXIT_CODE=$?
assert_eq "PASS when last_contact 20 days ago (exit code)" "0" "$EXIT_CODE"
assert_contains "PASS when last_contact 20 days ago (verdict)" "$OUTPUT" '"verdict": "PASS"'

# --- Test 3: PASS when no people file exists ---
OUTPUT=$(python3 "$SCRIPT" "{\"contact_name\": \"Nobody Exists\", \"people_dir\": \"$TMPDIR_TEST\"}" 2>&1)
EXIT_CODE=$?
assert_eq "PASS when no file exists (exit code)" "0" "$EXIT_CODE"
assert_contains "PASS when no file exists (verdict)" "$OUTPUT" '"verdict": "PASS"'

# --- Test 4: BLOCK on missing contact_name ---
OUTPUT=$(python3 "$SCRIPT" "{\"people_dir\": \"$TMPDIR_TEST\"}" 2>&1)
EXIT_CODE=$?
assert_eq "BLOCK on missing contact_name (exit code)" "1" "$EXIT_CODE"
assert_contains "BLOCK on missing contact_name (verdict)" "$OUTPUT" '"verdict": "BLOCK"'

# --- Test 5: PASS at lookback boundary (exactly 14 days ago) ---
BOUNDARY_DATE=$(python3 -c "import datetime; print((datetime.date.today() - datetime.timedelta(days=14)).isoformat())")
cat > "$TMPDIR_TEST/boundary-person.md" <<EOF
---
name: Boundary Person
last_contact: $BOUNDARY_DATE
---
# Boundary Person
EOF

OUTPUT=$(python3 "$SCRIPT" "{\"contact_name\": \"Boundary Person\", \"people_dir\": \"$TMPDIR_TEST\"}" 2>&1)
EXIT_CODE=$?
# 14 days ago is exactly at the boundary — HOW.py uses days_ago <= lookback_days → BLOCK
assert_eq "BLOCK at exactly 14-day boundary (exit code)" "1" "$EXIT_CODE"

# --- Test 6: PASS with custom lookback_days override ---
RECENT_DATE_2=$(python3 -c "import datetime; print((datetime.date.today() - datetime.timedelta(days=5)).isoformat())")
cat > "$TMPDIR_TEST/custom-person.md" <<EOF
---
name: Custom Person
last_contact: $RECENT_DATE_2
---
# Custom Person
EOF

OUTPUT=$(python3 "$SCRIPT" "{\"contact_name\": \"Custom Person\", \"people_dir\": \"$TMPDIR_TEST\", \"lookback_days\": 3}" 2>&1)
EXIT_CODE=$?
assert_eq "PASS when 5 days ago with lookback_days=3 (exit code)" "0" "$EXIT_CODE"
assert_contains "PASS when 5 days ago with lookback_days=3 (verdict)" "$OUTPUT" '"verdict": "PASS"'

# --- Test 7: Fallback to conversation_history.last_message_sent ---
RECENT_DATE_3=$(python3 -c "import datetime; print((datetime.date.today() - datetime.timedelta(days=2)).isoformat())")
cat > "$TMPDIR_TEST/fallback-person.md" <<EOF
---
name: Fallback Person
conversation_history:
  last_message_sent: $RECENT_DATE_3
---
# Fallback Person
EOF

OUTPUT=$(python3 "$SCRIPT" "{\"contact_name\": \"Fallback Person\", \"people_dir\": \"$TMPDIR_TEST\"}" 2>&1)
EXIT_CODE=$?
assert_eq "BLOCK via conversation_history fallback (exit code)" "1" "$EXIT_CODE"
assert_contains "BLOCK via conversation_history fallback (verdict)" "$OUTPUT" '"verdict": "BLOCK"'

echo ""
echo "━━━ Test: outreach-composer SKILL.md contains mandatory STEP 0 ━━━"
echo ""

# --- Test 8: SKILL.md has STEP 0 dedup pre-flight section ---
if grep -q "STEP 0" "$SKILL" 2>/dev/null; then
    pass "SKILL.md contains 'STEP 0'"
else
    fail "SKILL.md contains 'STEP 0'" "outreach-composer SKILL.md is missing mandatory STEP 0 dedup pre-flight"
fi

# --- Test 9: SKILL.md references warm-contact-outreach-dedup ---
if grep -q "warm-contact-outreach-dedup" "$SKILL" 2>/dev/null; then
    pass "SKILL.md references warm-contact-outreach-dedup"
else
    fail "SKILL.md references warm-contact-outreach-dedup" "dedup rule not referenced in outreach-composer SKILL.md"
fi

# --- Test 10: SKILL.md has BLOCK behavior described ---
if grep -q "DEDUP BLOCK" "$SKILL" 2>/dev/null; then
    pass "SKILL.md has DEDUP BLOCK stop behavior"
else
    fail "SKILL.md has DEDUP BLOCK stop behavior" "BLOCK behavior not described in SKILL.md"
fi

# --- Summary ---
echo ""
echo "━━━ Results ━━━"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo ""

[ "$FAIL" -eq 0 ]
