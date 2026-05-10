"""
Career-OS Memory Adapter — Dolt-canonical (v0.21.0+ / Phase 3 cutover).

No fallback. Dolt is the source of truth. If the container is unreachable the
adapter raises `AdapterUnreachable` — it does NOT silently read markdown.
This is intentional: `.md` files are being deleted, and a silent fallback to
a source-of-truth that no longer exists would read stale data or empty.

Env vars:
    CYBORG_DB_HOST            default 127.0.0.1
    CYBORG_DB_PORT            default 3306
    CYBORG_DB_NAME            default cyborg_brain
    CYBORG_DB_USER            default root
    CYBORG_DB_PASSWORD        default "" (empty)
    CYBORG_DB_TIMEOUT         default 3 (seconds)

Usage:
    from memory_adapter import Adapter, AdapterUnreachable
    try:
        a = Adapter()
        roles = a.list_roles(min_score=80, decision="FULL_INVEST")
    except AdapterUnreachable as e:
        # Dolt container is not running — bring it up, do NOT degrade silently.
        ...
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

try:
    import mysql.connector as _mysql
except ImportError as e:  # pragma: no cover
    raise RuntimeError(
        "mysql-connector-python is required. "
        "Install in your plugin venv: pip install mysql-connector-python"
    ) from e

__version__ = "0.21.0"

# ---------------- config ----------------

def _db_config() -> dict:
    """Read env every call so tests monkeypatching env don't leak across tests."""
    return {
        "host": os.environ.get("CYBORG_DB_HOST", "127.0.0.1"),
        "port": int(os.environ.get("CYBORG_DB_PORT", "3306")),
        "user": os.environ.get("CYBORG_DB_USER", "root"),
        "password": os.environ.get("CYBORG_DB_PASSWORD", ""),
        "database": os.environ.get("CYBORG_DB_NAME", "cyborg_brain"),
        "connection_timeout": int(os.environ.get("CYBORG_DB_TIMEOUT", "3")),
    }


logger = logging.getLogger("career_os.memory_adapter")


class AdapterUnreachable(RuntimeError):
    """Raised when the Dolt server is unreachable. No fallback by design."""


# ---------------- dataclasses ----------------

@dataclass
class Role:
    slug: str
    company: str
    role_title: str
    score: Optional[int] = None
    decision: Optional[str] = None
    decision_tier: Optional[str] = None  # normalized: FULL_INVEST | APPLY | CHECK_DELTA | SKIP
    resume_track: Optional[str] = None
    warm_path: Optional[str] = None
    jd_url: Optional[str] = None
    outcome: Optional[str] = None
    batch_date: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Application:
    slug: str
    company: str
    role_title: str = ""
    section: Optional[str] = None
    status: Optional[str] = None
    comp: Optional[str] = None
    next_action: Optional[str] = None


@dataclass
class Story:
    slug: str
    title: Optional[str] = None
    story_date: Optional[str] = None
    category: Optional[str] = None
    competencies: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)


@dataclass
class SkillRow:
    slug: str
    category: str
    skill: str
    proficiency: Optional[str] = None
    recency: Optional[str] = None
    evidence: Optional[str] = None
    learnability: Optional[str] = None


@dataclass
class Person:
    slug: str
    name: str
    company: Optional[str] = None
    role: Optional[str] = None
    warmth: Optional[int] = None
    channel: Optional[str] = None


@dataclass
class AdapterHealth:
    backend: str = "dolt"
    reachable: bool = False
    tables: list[str] = field(default_factory=list)
    row_counts: dict[str, int] = field(default_factory=dict)
    error: Optional[str] = None


# ---------------- Adapter ----------------

class Adapter:
    """Dolt-canonical memory adapter. No fallback. Fail-fast."""

    def __init__(self):
        self._conn = None
        cfg = _db_config()
        try:
            self._conn = _mysql.connect(**cfg)
        except Exception as e:
            raise AdapterUnreachable(
                f"Cannot connect to Dolt at "
                f"{cfg['host']}:{cfg['port']}/{cfg['database']}. "
                f"Start the cyborg-brain-db container. Underlying: "
                f"{type(e).__name__}: {str(e)[:200]}"
            ) from e

    # ---- connection / diagnostics ----

    def backend(self) -> str:
        return "dolt"

    # Whitelist of tables healthcheck() will COUNT(*). Prevents arbitrary
    # identifier injection if SHOW TABLES ever returned something unexpected
    # (Gemini v0.21.0 finding #4 hardening). Update when schema grows.
    _HEALTHCHECK_TABLES = frozenset({
        "people", "roles", "applications", "stories", "projects", "references",
        "identity", "scoring_metadata", "skills_matrix", "events",
        "interview_prep", "tasks", "migration_log",
    })

    @staticmethod
    def _is_safe_identifier(s: str) -> bool:
        """Identifier must be a non-empty string of [A-Za-z0-9_], length ≤64.
        MySQL/Dolt identifier rules — keeps healthcheck COUNT(*) safe even if
        SHOW TABLES returns something exotic."""
        return bool(s) and len(s) <= 64 and all(
            c.isalnum() or c == "_" for c in s
        ) and not s[0].isdigit()

    def healthcheck(self) -> AdapterHealth:
        cur = self._conn.cursor()
        try:
            cur.execute("SHOW TABLES")
            raw_tables = [r[0] for r in cur.fetchall()]
            counts: dict[str, int] = {}
            for t in raw_tables:
                # Defense-in-depth: only COUNT(*) tables that pass identifier
                # validation AND are in the known whitelist. Either gate fails
                # → -1 (visible in healthcheck output, not silently zero).
                if not self._is_safe_identifier(t):
                    counts[t] = -1
                    continue
                if t not in self._HEALTHCHECK_TABLES:
                    # Unknown table — could be a new one we haven't whitelisted
                    # yet; count it cautiously by binding via SHOW TABLE STATUS
                    # (no f-string interpolation of the identifier into SQL).
                    try:
                        cur.execute("SHOW TABLE STATUS WHERE Name = %s", (t,))
                        row = cur.fetchone()
                        # Approximate row-count from table-status (Rows column)
                        counts[t] = int(row[4]) if row and row[4] is not None else -1
                    except Exception:
                        counts[t] = -1
                    continue
                # Whitelisted + identifier-validated → backtick-quoted COUNT.
                # f-string is safe here: t passed both validations above.
                try:
                    cur.execute(f"SELECT COUNT(*) FROM `{t}`")
                    counts[t] = cur.fetchone()[0]
                except Exception:
                    counts[t] = -1
            return AdapterHealth(backend="dolt", reachable=True,
                                 tables=raw_tables, row_counts=counts)
        finally:
            cur.close()

    def close(self):
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    # ---- read helpers ----

    def _q(self, sql: str, params: tuple | list = ()) -> list[dict]:
        cur = self._conn.cursor(dictionary=True)
        try:
            cur.execute(sql, params)
            return list(cur.fetchall())
        finally:
            cur.close()

    def _exec(self, sql: str, params: tuple | list = ()) -> int:
        cur = self._conn.cursor()
        try:
            cur.execute(sql, params)
            self._conn.commit()
            return cur.rowcount
        finally:
            cur.close()

    # ---- roles ----

    def list_roles(self,
                   decision: Optional[str] = None,
                   min_score: Optional[int] = None,
                   company: Optional[str] = None,
                   tier: Optional[str] = None,
                   batch_after: Optional[str] = None,
                   batch_before: Optional[str] = None) -> list[Role]:
        """Filter roles. `tier` uses the normalized decision_tier index (fast);
        `decision` falls back to UPPER(decision) LIKE substring match (slow,
        unindexed, v0.21.0-compatible). Prefer tier for known enums
        (FULL_INVEST / APPLY / CHECK_DELTA / SKIP)."""
        where: list[str] = []
        params: list[Any] = []
        if tier:
            where.append("decision_tier = %s")
            params.append(tier.upper())
        elif decision:
            # Auto-promote known enums to indexed lookup.
            d_up = decision.upper().strip()
            KNOWN_TIERS = {"FULL_INVEST", "APPLY", "CHECK_DELTA", "SKIP"}
            if d_up in KNOWN_TIERS:
                where.append("decision_tier = %s")
                params.append(d_up)
            else:
                where.append("UPPER(decision) LIKE %s")
                params.append(f"%{d_up}%")
        if min_score is not None:
            where.append("score >= %s")
            params.append(min_score)
        if company:
            where.append("company LIKE %s")
            params.append(f"%{company}%")
        # v0.23.0: indexed date-window queries via parallel batch_date_dt column.
        # Accepts ISO 'YYYY-MM-DD' string. NULL batch_date_dt rows excluded by design.
        if batch_after:
            where.append("batch_date_dt >= %s")
            params.append(batch_after)
        if batch_before:
            where.append("batch_date_dt <= %s")
            params.append(batch_before)
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        rows = self._q(
            f"SELECT slug, company, role_title, score, decision, decision_tier, "
            f"resume_track, warm_path, jd_url, outcome, batch_date FROM roles{where_sql} "
            f"ORDER BY score DESC, batch_date DESC",
            params,
        )
        return [Role(**r) for r in rows]

    def get_role(self, slug: str) -> Optional[Role]:
        rows = self._q(
            "SELECT slug, company, role_title, score, decision, decision_tier, "
            "resume_track, warm_path, jd_url, outcome, batch_date FROM roles WHERE slug = %s",
            (slug,),
        )
        return Role(**rows[0]) if rows else None

    def upsert_role(self, r: Role) -> None:
        """Write-through API (Phase 3). Skills that own role writes
        (job-match-scorer) should prefer this over rewriting match-tracker.md.
        Normalizes decision_tier from r.decision if r.decision_tier is None."""
        from datetime import datetime, timezone as _tz
        now = datetime.now(_tz.utc).isoformat()
        tier = r.decision_tier or _normalize_decision_tier(r.decision)
        self._exec(
            "REPLACE INTO roles "
            "(slug, batch_date, company, role_title, score, decision, decision_tier, "
            " resume_track, warm_path, jd_url, outcome, "
            " source_path, ingest_status, ingested_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (r.slug, r.batch_date, r.company, r.role_title, r.score, r.decision, tier,
             r.resume_track, r.warm_path, r.jd_url, r.outcome,
             "adapter:upsert_role", "ok", now),
        )

    # ---- applications ----

    def list_applications(self, section: Optional[str] = None,
                          status: Optional[str] = None,
                          company: Optional[str] = None) -> list[Application]:
        """Filter by section (active/warm_intros/inactive/rejected/inactive_rejected),
        status substring (e.g. 'APPLIED', 'DEAD'), or company substring."""
        where: list[str] = []
        params: list[Any] = []
        if section:
            where.append("section = %s")
            params.append(section)
        if status:
            where.append("UPPER(status) LIKE %s")
            params.append(f"%{status.upper()}%")
        if company:
            where.append("company LIKE %s")
            params.append(f"%{company}%")
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        rows = self._q(
            f"SELECT slug, company, role_title, section, status, comp, next_action "
            f"FROM applications{where_sql} ORDER BY section, company",
            params,
        )
        return [Application(**r) for r in rows]

    def get_application(self, slug: str) -> Optional[Application]:
        rows = self._q(
            "SELECT slug, company, role_title, section, status, comp, next_action "
            "FROM applications WHERE slug = %s",
            (slug,),
        )
        return Application(**rows[0]) if rows else None

    def upsert_application(self, a: Application) -> None:
        """Write-through API (Phase 3). Skills that own app writes (apply-tracker)
        should prefer this over parsing/rewriting job-pipeline.md."""
        from datetime import datetime, timezone as _tz
        now = datetime.now(_tz.utc).isoformat()
        self._exec(
            "REPLACE INTO applications "
            "(slug, company, role_title, section, status, comp, next_action, "
            " body_md, source_path, source_mtime, ingest_status, ingested_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (a.slug, a.company, a.role_title, a.section, a.status, a.comp,
             a.next_action, None, "adapter:upsert_application", now, "ok", now),
        )

    # ---- stories ----

    def count_stories_recursive(self) -> int:
        rows = self._q("SELECT COUNT(*) AS n FROM stories")
        return int(rows[0]["n"]) if rows else 0

    def list_recent_stories(self, since: str) -> list[Story]:
        """v0.23.0: indexed date-window query. `since` is 'YYYY-MM-DD'.
        Uses idx_stories_story_date_dt for fast range scan. NULL story_date_dt
        rows excluded — they're stories without parseable dates in YAML
        frontmatter."""
        rows = self._q(
            "SELECT slug, title, story_date, category, competencies_json, tags_json "
            "FROM stories WHERE story_date_dt >= %s ORDER BY story_date_dt DESC",
            (since,),
        )
        return [
            Story(
                slug=r["slug"], title=r["title"], story_date=r["story_date"],
                category=r["category"],
                competencies=_parse_json_list(r.get("competencies_json")),
                tags=_parse_json_list(r.get("tags_json")),
            )
            for r in rows
        ]

    def list_stories(self, category: Optional[str] = None,
                     competency: Optional[str] = None,
                     tag: Optional[str] = None) -> list[Story]:
        """List stories filtered by category (dir), competency (JSON field),
        or tag (JSON field). Filters compose with AND."""
        where: list[str] = []
        params: list[Any] = []
        if category:
            where.append("category = %s")
            params.append(category)
        if competency:
            where.append("JSON_CONTAINS(competencies_json, JSON_QUOTE(%s))")
            params.append(competency)
        if tag:
            where.append("JSON_CONTAINS(tags_json, JSON_QUOTE(%s))")
            params.append(tag)
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        rows = self._q(
            f"SELECT slug, title, story_date, category, competencies_json, tags_json "
            f"FROM stories{where_sql} ORDER BY story_date DESC",
            params,
        )
        return [
            Story(
                slug=r["slug"], title=r["title"], story_date=r["story_date"],
                category=r["category"],
                competencies=_parse_json_list(r.get("competencies_json")),
                tags=_parse_json_list(r.get("tags_json")),
            )
            for r in rows
        ]

    def get_story(self, slug: str) -> Optional[Story]:
        rows = self._q(
            "SELECT slug, title, story_date, category, competencies_json, tags_json "
            "FROM stories WHERE slug = %s",
            (slug,),
        )
        if not rows:
            return None
        r = rows[0]
        return Story(
            slug=r["slug"], title=r["title"], story_date=r["story_date"],
            category=r["category"],
            competencies=_parse_json_list(r.get("competencies_json")),
            tags=_parse_json_list(r.get("tags_json")),
        )

    # ---- skills ----

    def list_skills(self, category: Optional[str] = None) -> list[SkillRow]:
        if category:
            rows = self._q(
                "SELECT slug, category, skill, proficiency, recency, evidence, learnability "
                "FROM skills_matrix WHERE category = %s ORDER BY skill",
                (category,),
            )
        else:
            rows = self._q(
                "SELECT slug, category, skill, proficiency, recency, evidence, learnability "
                "FROM skills_matrix ORDER BY category, skill"
            )
        return [SkillRow(**r) for r in rows]

    def get_skill(self, category: str, name: str) -> Optional[SkillRow]:
        """Fetch a single skill row by (category, skill_name). Spec §6.1."""
        rows = self._q(
            "SELECT slug, category, skill, proficiency, recency, evidence, learnability "
            "FROM skills_matrix WHERE category = %s AND skill = %s",
            (category, name),
        )
        return SkillRow(**rows[0]) if rows else None

    # ---- people ----

    def list_people(self, warmth_min: Optional[int] = None,
                    last_contact_before: Optional[str] = None,
                    last_contact_after: Optional[str] = None) -> list[Person]:
        """v0.23.0: optional date-window filters on last_contact_dt
        (indexed). 'last_contact_before' surfaces decay-aware re-contact
        candidates ("warm contacts not pinged since 30 days ago")."""
        where: list[str] = []
        params: list[Any] = []
        if warmth_min is not None:
            where.append("warmth >= %s")
            params.append(warmth_min)
        if last_contact_before:
            where.append("last_contact_dt < %s")
            params.append(last_contact_before)
        if last_contact_after:
            where.append("last_contact_dt >= %s")
            params.append(last_contact_after)
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        rows = self._q(
            f"SELECT slug, name, company, role, warmth, channel FROM people"
            f"{where_sql} ORDER BY warmth DESC, name",
            params,
        )
        return [Person(**r) for r in rows]

    # ---- identity & scoring ----

    def get_identity(self, key: str) -> Optional[dict]:
        rows = self._q(
            "SELECT `key`, title, body_md FROM identity WHERE `key` = %s",
            (key,),
        )
        return rows[0] if rows else None

    def get_scoring_metadata(self, key: str) -> Optional[dict]:
        rows = self._q(
            "SELECT `key`, title, body_md FROM scoring_metadata WHERE `key` = %s",
            (key,),
        )
        return rows[0] if rows else None

    # ---- tasks ----

    def append_task(self, slug: str, title: str, priority: str = "P2",
                    description: Optional[str] = None,
                    status: str = "open") -> None:
        """Write-through API. Skills (pipeline-sync, apply-tracker, cruise-control)
        that queue tasks should prefer this over editing Tasks.md in place."""
        from datetime import datetime, timezone as _tz
        now = datetime.now(_tz.utc).isoformat()
        self._exec(
            "REPLACE INTO tasks "
            "(slug, priority, status, title, description, "
            " source_path, source_mtime, ingest_status, ingested_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (slug, priority, status, title[:200], description or title,
             "adapter:append_task", now, "ok", now),
        )


# ---------------- small utils ----------------

def _normalize_decision_tier(raw: Optional[str]) -> Optional[str]:
    """Mirror of migrate_career_os.py's _normalize_decision — kept in sync.
    Returns FULL_INVEST | APPLY | CHECK_DELTA | SKIP | None."""
    if not raw:
        return None
    u = raw.upper()
    if "FULL INVEST" in u or "FULL_INVEST" in u:
        return "FULL_INVEST"
    if "VERIFY+APPLY" in u:
        return "APPLY"
    if "CHECK DELTA" in u or "CHECK_DELTA" in u or "VERIFY" in u:
        return "CHECK_DELTA"
    if "PRE-SKIP" in u or "SKIP" in u:
        return "SKIP"
    if "APPLY" in u:
        return "APPLY"
    return None


def _parse_json_list(raw: Any) -> list:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    try:
        v = json.loads(raw) if isinstance(raw, (str, bytes, bytearray)) else raw
        return v if isinstance(v, list) else []
    except (TypeError, ValueError):
        return []


# ---------------- CLI (diagnostic) ----------------

def _cli():
    import argparse
    import sys as _sys
    ap = argparse.ArgumentParser()
    ap.add_argument("--health", action="store_true")
    ap.add_argument("--roles", action="store_true")
    ap.add_argument("--min-score", type=int, default=80)
    ap.add_argument("--decision", default=None)
    ap.add_argument("--count-stories", action="store_true")
    args = ap.parse_args()
    try:
        a = Adapter()
    except AdapterUnreachable as e:
        print(f"ERROR: {e}", file=_sys.stderr)
        _sys.exit(2)
    if args.health:
        print(json.dumps(asdict(a.healthcheck()), indent=2, default=str))
    if args.roles:
        roles = a.list_roles(decision=args.decision, min_score=args.min_score)
        for r in roles[:50]:
            print(f"{r.score or '??'} | {r.company:30s} | {r.role_title[:60]}")
        print(f"... total={len(roles)}")
    if args.count_stories:
        print(f"stories={a.count_stories_recursive()}")
    a.close()


if __name__ == "__main__":
    _cli()
