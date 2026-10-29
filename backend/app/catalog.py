"""Read-only access to the catalog documents the hybrid index already holds."""
import json

from fastapi import HTTPException


def get_course(conn, course_id: str):
    row = conn.execute(
        "SELECT course_id, title, content, metadata FROM documents WHERE doc_key = ?", (f"catalog:{course_id}",)
    ).fetchone()
    if row is None:
        return None
    meta = json.loads(row["metadata"])
    return {
        "course_id": row["course_id"],
        "title": row["title"],
        "description": row["content"],
        "department": meta.get("department", row["course_id"].split(".")[0]),
        "units": meta.get("units", ""),
        "units_total": meta.get("units_total"),
        "prereq_text": meta.get("prereqs", ""),
        "terms": meta.get("terms", []),
        "instructors": meta.get("instructors", {}),
    }


def require_course(conn, course_id: str):
    course = get_course(conn, course_id)
    if course is None:
        raise HTTPException(404, f"No course {course_id} in the catalog.")
    return course


# Catalog term codes are academic-year style (2027FA = Fall 2026); the UI speaks in seasons.
TERM_SEASONS = {"FA": "Fall", "JA": "IAP", "SP": "Spring", "SU": "Summer"}


def seasons(term_codes) -> list:
    found = {TERM_SEASONS.get(code[-2:]) for code in term_codes or []}
    return [season for season in TERM_SEASONS.values() if season in found]


def summaries(conn, course_ids) -> dict:
    """Title, department, units and offered seasons for a batch of courses."""
    ids = list(dict.fromkeys(course_ids))
    if not ids:
        return {}
    rows = conn.execute(
        f"SELECT course_id, title, metadata FROM documents "
        f"WHERE source_type = 'catalog' AND course_id IN ({','.join('?' * len(ids))})", ids
    ).fetchall()
    result = {}
    for row in rows:
        meta = json.loads(row["metadata"])
        result[row["course_id"]] = {
            "title": row["title"],
            "department": meta.get("department", row["course_id"].split(".")[0]),
            "units": meta.get("units", ""),
            "units_total": meta.get("units_total"),
            "terms": seasons(meta.get("terms")),
        }
    return result
