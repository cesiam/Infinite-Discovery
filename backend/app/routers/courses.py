"""Tab 1: Course Description."""
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import require_role
from typing import Literal

from app.catalog import require_course, seasons, summaries
from app.db import get_conn
from app.prereqs import course_prereqs
from app.rag import hybrid_search

router = APIRouter(tags=["courses"])

SNIPPET_CHARS = 220


def _snippet(text):
    text = " ".join((text or "").split())
    return text if len(text) <= SNIPPET_CHARS else text[:SNIPPET_CHARS].rsplit(" ", 1)[0] + "…"


_COURSE_NUMBER = re.compile(r"\b(?:[0-9]{1,2}[A-Z]?|[A-Z]{2,4})\.[0-9A-Z]{1,6}\b", re.I)


def expand_course_numbers(conn, q: str) -> str:
    """'6.3930' -> '6.3930 AI and Decision Making in Medicine: From Disease to Therapy'.

    A bare number gives the keyword side an exact hit but the embedding side nothing to
    go on, so the rest of the results are noise. Adding the title makes both halves of
    the hybrid search look for classes related by name; the number itself still ranks
    its own class first (course_id carries the heaviest BM25 weight)."""
    titles = []
    for number in dict.fromkeys(m.group(0).upper() for m in _COURSE_NUMBER.finditer(q)):
        row = conn.execute("SELECT title FROM documents WHERE doc_key = ?", (f"catalog:{number}",)).fetchone()
        if row and row["title"].lower() not in q.lower():
            titles.append(row["title"])
    return " ".join([q, *titles])


def search_courses(conn, request, q, top_k, departments=None, source_types=None):
    q = expand_course_numbers(conn, q)
    embedding = request.app.state.embed_fn([q])[0]
    filters = {"department": departments} if departments else None
    return hybrid_search(conn, q, query_embedding=embedding, top_k=top_k,
                         candidate_k=max(100, top_k), source_types=source_types, filters=filters)


@router.get("/courses/search")
def search(request: Request, q: str = Query(min_length=1, max_length=300), top_k: int = Query(10, ge=1, le=50),
           dept: list[str] | None = Query(None), units: int | None = Query(None, ge=1, le=60),
           term: Literal["Fall", "IAP", "Spring", "Summer"] | None = None, conn=Depends(get_conn)):
    """Hybrid search over every source (catalog, fingerprints, posts), one result per course.

    dept goes to the search itself. units and term are checked against each
    course's catalog entry afterwards (fingerprint and post documents don't
    carry them), so the search fetches extra candidates when they're set."""
    post_filter = units is not None or term is not None
    hits = search_courses(conn, request, q, min(top_k * 5, 100) if post_filter else top_k, dept)
    catalog = summaries(conn, [hit.course_id for hit in hits])
    results = []
    for hit in hits:
        info = catalog.get(hit.course_id)
        if info is None:          # a fingerprint/post for a course that left the catalog
            continue
        if units is not None and info["units_total"] != units:
            continue
        if term is not None and term not in info["terms"]:
            continue
        results.append({
            "course_id": hit.course_id,
            "number": hit.course_id,
            **info,
            "score": round(hit.score, 6),
            "matched": [{"source_type": h.source_type, "snippet": _snippet(h.text)}
                        for h in [hit, *hit.also_matched]],
        })
        if len(results) == top_k:
            break
    return {"query": q, "results": results}


@router.get("/courses")
def list_courses(q: str = Query("", max_length=100), limit: int = Query(20, ge=1, le=100), conn=Depends(get_conn)):
    """Course picker: number prefix first ("6.39"), then title words ("machine")."""
    q = q.strip()
    rows = conn.execute("""
        SELECT course_id, title FROM documents
        WHERE source_type = 'catalog' AND (course_id LIKE ? OR title LIKE ?)
        ORDER BY course_id NOT LIKE ?, length(course_id), course_id
        LIMIT ?
    """, (f"{q}%", f"%{q}%", f"{q}%", limit)).fetchall()
    return {"courses": [{"id": r["course_id"], "number": r["course_id"], "title": r["title"]} for r in rows]}


@router.get("/courses/batch")
def batch(id: list[str] = Query(default=[], max_length=200), conn=Depends(get_conn)):
    """Summaries for many courses at once (the plan board's units and terms)."""
    return {"courses": {course_id: {"id": course_id, "number": course_id, **info}
                        for course_id, info in summaries(conn, id).items()}}


@router.get("/courses/{course_id}")
def course_detail(course_id: str, conn=Depends(get_conn)):
    course = require_course(conn, course_id)
    return {
        "id": course["course_id"],
        "number": course["course_id"],
        "title": course["title"],
        "units": course["units"],
        "units_total": course["units_total"],
        "department": course["department"],
        "description": course["description"],
        "prereq_text": course["prereq_text"],
        "prereqs": course_prereqs(conn, course_id),
        "terms": seasons(course["terms"]),
        "instructors": course["instructors"],
    }


class SoftPrereq(BaseModel):
    prereq_course_id: str = Field(min_length=1, max_length=20)
    note: str = Field(default="", max_length=500)


@router.post("/courses/{course_id}/prereqs/soft", status_code=201)
def suggest_soft_prereq(course_id: str, body: SoftPrereq, conn=Depends(get_conn),
                        user=Depends(require_role("student", "professor"))):
    """Soft prereq: "it helps to have taken X first". One suggestion per person per edge."""
    require_course(conn, course_id)
    require_course(conn, body.prereq_course_id)
    if body.prereq_course_id == course_id:
        raise HTTPException(422, "A course can't be its own prerequisite.")
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO prereqs (course_id, prereq_course_id, kind, source, created_by, note) "
            "VALUES (?, ?, 'soft', ?, ?, ?)",
            (course_id, body.prereq_course_id, user["role"], user["id"], body.note.strip()),
        )
    return {"prereqs": course_prereqs(conn, course_id)}
