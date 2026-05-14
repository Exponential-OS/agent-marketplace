---
title: "Job Search Config — {{USER_NAME}}"
type: job-search-config
created: {{DATE}}
updated: {{DATE}}
who: {{USER_NAME}}
why: >
  Loaded by job-match-scorer, mission-control, and job-search-scheduler to score
  roles against preferences and filter the pipeline. User never re-states preferences
  per session — this file is the standing config.
---

# Job Search Preferences

## Target Roles

```yaml
target_titles:
  - {{TARGET_TITLE_1}}
  - {{TARGET_TITLE_2}}

target_levels:
  - {{TARGET_LEVEL}}

target_functions:
  - {{TARGET_FUNCTION}}

target_company_types:
  - {{COMPANY_TYPE_1}}   # e.g., Series B startup, growth-stage, FAANG, enterprise
  - {{COMPANY_TYPE_2}}

target_industries:
  - {{INDUSTRY_1}}
  - {{INDUSTRY_2}}
```

## Location

```yaml
preferred_locations:
  - {{LOCATION_1}}

work_style: {{WORK_STYLE}}   # remote / hybrid / onsite
travel_tolerance: {{TRAVEL}}  # none / occasional / up to X%
```

## Compensation

```yaml
target_base_salary: "{{BASE_SALARY}}"
target_total_comp: "{{TOTAL_COMP}}"
equity_required: {{EQUITY_REQUIRED}}   # true / false
```

## Non-Negotiables (auto-reject if violated)

```yaml
hard_nos:
  - {{HARD_NO_1}}
  - {{HARD_NO_2}}
```

## Job-Match Scoring Weights

These weights are used by job-match-scorer to calculate fit scores. Adjust after your first few scored roles.

```yaml
scoring_weights:
  title_match: 30          # % weight on role title/level alignment
  location_match: 20       # % weight on location/work-style match
  company_type_match: 20   # % weight on company stage/type match
  compensation_match: 15   # % weight on comp alignment
  industry_match: 15       # % weight on industry fit
```

## Pipeline Settings

```yaml
tier_definitions:
  tier_1: "Top target — invest full prep time"
  tier_2: "Strong fit — standard apply + outreach"
  tier_3: "Exploratory — apply if low effort"

cooldown_days_after_rejection: 180   # days before re-applying to same company
max_active_applications: 20          # pipeline health ceiling
```
