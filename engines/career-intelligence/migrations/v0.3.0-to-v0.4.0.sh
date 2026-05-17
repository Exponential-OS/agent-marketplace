#!/usr/bin/env bash
# product-vs-solution: example — historical migration script (one-time use), Anand-personal references are provenance.
# Migration: v0.3.0 → v0.4.0
# Description: Reorganize flat folder structure into .career-os/ hierarchy
# This script is idempotent — safe to run multiple times.
#
# What changed in v0.4.0:
# - Flat memory/ folder → .career-os/memory/
# - Career_OS_Canonical.md → .career-os/memory/Career_OS_Canonical.md
# - TASKS.md → .career-os/tasks/Tasks.md
# - OUTREACH_TEMPLATES.md → .career-os/config/outreach-templates.md
# - GITHUB_STRATEGY.md → .career-os/config/github-strategy.md
# - Applications Submitted/ → .career-os/applications/
# - Job_Application_Tracker.xlsx → .career-os/applications/tracker.xlsx
# - daily-job-scan-*.md → .career-os/reference/job-scans/
# - OLD/ → .career-os/archive/
# - *.pages files deleted
# - Latest/ → Resumes & Cover Letters/Latest/

set -euo pipefail

CONTEXT_DIR="${1:-.}"
cd "$CONTEXT_DIR"

echo "Migration v0.3.0 → v0.4.0: Reorganizing to .career-os/ hierarchy"

# Create target directories (idempotent — mkdir -p)
mkdir -p .career-os/memory/stories
mkdir -p .career-os/memory/people
mkdir -p .career-os/tasks
mkdir -p .career-os/config
mkdir -p .career-os/reference/job-scans
mkdir -p .career-os/reference/jd-samples
mkdir -p .career-os/reference/linkedin-stories
mkdir -p .career-os/reference/mediassist-prds
mkdir -p .career-os/applications
mkdir -p .career-os/archive
mkdir -p .career-os/ledger
mkdir -p "Resumes & Cover Letters/Latest"

# Move memory/ → .career-os/memory/ (if old location exists)
[ -f "memory/glossary.md" ] && [ ! -f ".career-os/memory/glossary.md" ] && cp "memory/glossary.md" ".career-os/memory/glossary.md" && rm "memory/glossary.md"
[ -f "memory/job-pipeline.md" ] && [ ! -f ".career-os/memory/job-pipeline.md" ] && cp "memory/job-pipeline.md" ".career-os/memory/job-pipeline.md" && rm "memory/job-pipeline.md"
[ -f "memory/companies.md" ] && [ ! -f ".career-os/memory/companies.md" ] && cp "memory/companies.md" ".career-os/memory/companies.md" && rm "memory/companies.md"

# Move stories (preserve subfolder structure)
if [ -d "memory/stories" ]; then
  find "memory/stories" -type f | while read -r f; do
    rel="${f#memory/stories/}"
    target=".career-os/memory/stories/$rel"
    target_dir="$(dirname "$target")"
    mkdir -p "$target_dir"
    [ ! -f "$target" ] && cp "$f" "$target" && rm "$f"
  done
fi

# Move protocol-audits
if [ -d "memory/protocol-audits" ]; then
  mkdir -p ".career-os/memory/protocol-audits"
  find "memory/protocol-audits" -type f | while read -r f; do
    base="$(basename "$f")"
    [ ! -f ".career-os/memory/protocol-audits/$base" ] && cp "$f" ".career-os/memory/protocol-audits/$base" && rm "$f"
  done
fi

# Move Career_OS_Canonical.md
[ -f "Career_OS_Canonical.md" ] && [ ! -f ".career-os/memory/Career_OS_Canonical.md" ] && cp "Career_OS_Canonical.md" ".career-os/memory/Career_OS_Canonical.md" && rm "Career_OS_Canonical.md"

# Move TASKS.md → tasks/Tasks.md
[ -f "TASKS.md" ] && [ ! -f ".career-os/tasks/Tasks.md" ] && cp "TASKS.md" ".career-os/tasks/Tasks.md" && rm "TASKS.md"

# Move config files
[ -f "OUTREACH_TEMPLATES.md" ] && [ ! -f ".career-os/config/outreach-templates.md" ] && cp "OUTREACH_TEMPLATES.md" ".career-os/config/outreach-templates.md" && rm "OUTREACH_TEMPLATES.md"
[ -f "GITHUB_STRATEGY.md" ] && [ ! -f ".career-os/config/github-strategy.md" ] && cp "GITHUB_STRATEGY.md" ".career-os/config/github-strategy.md" && rm "GITHUB_STRATEGY.md"

# Move Applications Submitted/ → .career-os/applications/
if [ -d "Applications Submitted" ]; then
  find "Applications Submitted" -type f | while read -r f; do
    rel="${f#Applications Submitted/}"
    target=".career-os/applications/$rel"
    target_dir="$(dirname "$target")"
    mkdir -p "$target_dir"
    [ ! -f "$target" ] && cp "$f" "$target" && rm "$f"
  done
fi

# Move tracker
[ -f "Job_Application_Tracker.xlsx" ] && [ ! -f ".career-os/applications/tracker.xlsx" ] && cp "Job_Application_Tracker.xlsx" ".career-os/applications/tracker.xlsx" && rm "Job_Application_Tracker.xlsx"

# Move job scans
for f in daily-job-scan-*.md "LinkedIn Job Scan"*.md; do
  [ -f "$f" ] && [ ! -f ".career-os/reference/job-scans/$f" ] && cp "$f" ".career-os/reference/job-scans/" && rm "$f"
done

# Move reference files
for pair in \
  "linkedin-groups-posting-reminder.md:.career-os/reference/linkedin-groups-posting-reminder.md" \
  "Recruiter_Outreach.md:.career-os/reference/recruiter-outreach.md" \
  "Adobe_Friend_Email.md:.career-os/reference/adobe-friend-email.md" \
  "FQHC_MultiAgent_System_Design.md:.career-os/reference/fqhc-multiagent-design.md" \
  "NEXT_SESSION_WAKEUP.md:.career-os/reference/next-session-wakeup.md" \
  "VALLAMSETLA-ANAND-RHETIResults.pdf:.career-os/reference/rheti-results.pdf" \
  "Career_OS_Founders_Memo.pdf:.career-os/reference/founders-memo.pdf" \
  "Job Focus.pdf:.career-os/reference/job-focus.pdf" \
  "Other Stories.pdf:.career-os/reference/other-stories.pdf" \
  "Rockland interview Berkeley Update.txt:.career-os/reference/rockland-berkeley-update.txt"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  [ -f "$src" ] && [ ! -f "$dst" ] && cp "$src" "$dst" && rm "$src"
done

# Move PRDs
for f in PRD_Phase*.md; do
  [ -f "$f" ] && [ ! -f ".career-os/reference/mediassist-prds/$f" ] && cp "$f" ".career-os/reference/mediassist-prds/" && rm "$f"
done

# Move JD samples
for f in "JD Samples"*.pdf; do
  [ -f "$f" ] && [ ! -f ".career-os/reference/jd-samples/$f" ] && cp "$f" ".career-os/reference/jd-samples/" && rm "$f"
done

# Move LinkedIn story images
for f in "Linkedin Story "*.png; do
  [ -f "$f" ] && [ ! -f ".career-os/reference/linkedin-stories/$f" ] && cp "$f" ".career-os/reference/linkedin-stories/" && rm "$f"
done

# Move OLD/ → .career-os/archive/
if [ -d "OLD" ]; then
  find "OLD" -type f | while read -r f; do
    base="$(basename "$f")"
    [ ! -f ".career-os/archive/$base" ] && cp "$f" ".career-os/archive/$base" && rm "$f"
  done
fi

# Move Latest/ → Resumes & Cover Letters/Latest/
if [ -d "Latest" ]; then
  find "Latest" -type f \( -name "*.docx" -o -name "*.pdf" \) | while read -r f; do
    base="$(basename "$f")"
    [ ! -f "Resumes & Cover Letters/Latest/$base" ] && cp "$f" "Resumes & Cover Letters/Latest/$base" && rm "$f"
  done
fi

# Delete .pages files
find . -maxdepth 1 -name "*.pages" -delete 2>/dev/null || true

# Clean up empty directories
for d in "memory/stories" "memory/protocol-audits" "memory" "Applications Submitted" "OLD" "Latest"; do
  [ -d "$d" ] && rmdir "$d" 2>/dev/null || true
done

# Set version
echo "0.4.0" > .career-os/config/version

echo "✅ Migration v0.3.0 → v0.4.0 complete"
