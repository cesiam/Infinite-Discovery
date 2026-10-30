"""Degree programs (imported from MIT's official pages) and progress against a plan."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import get_conn
from app.requirements import evaluate, program_courses

router = APIRouter(tags=["requirements"])


@router.get("/programs")
def list_programs(kind: Literal["gir", "major", "minor", "concentration"] | None = None,
                  q: str = Query("", max_length=100), conn=Depends(get_conn)):
    sql = """
        SELECT p.id, p.kind, p.name, p.code, p.source_url,
               COUNT(r.id) AS requirements,
               SUM(json_extract(r.rule, '$.type') != 'manual') AS checked
        FROM programs p LEFT JOIN program_requirements r ON r.program_id = p.id
        WHERE (? IS NULL OR p.kind = ?) AND (p.name LIKE ? OR p.code LIKE ?)
        GROUP BY p.id ORDER BY p.kind, p.name
    """
    rows = conn.execute(sql, (kind, kind, f"%{q}%", f"{q}%")).fetchall()
    return {"programs": [{**dict(r), "checked": r["checked"] or 0} for r in rows]}


@router.get("/programs/{program_id}")
def program_detail(program_id: str, conn=Depends(get_conn)):
    row = conn.execute("SELECT * FROM programs WHERE id = ?", (program_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"No program {program_id}.")
    return {**dict(row), "courses": program_courses(conn, program_id)}


# MIT (Registrar, "Declaring a minor"): a minor may include GIR subjects; subjects may count
# toward both a minor and the major only with approval from the major department and the
# Committee on Curricula; at most two minors.
OVERLAP_NOTE = ("Also counted toward your major. MIT allows this only with approval from your "
                "major department and the Committee on Curricula.")


class ProgressRequest(BaseModel):
    programs: list[str] = Field(default_factory=lambda: ["gir"], max_length=12)
    courses: list[str] = Field(default_factory=list, max_length=120)


@router.post("/requirements/progress")
def progress(body: ProgressRequest, conn=Depends(get_conn)):
    """Progress for each program. Stateless: the plan lives in the browser and is sent here."""
    if conn.execute("SELECT 1 FROM programs LIMIT 1").fetchone() is None:
        raise HTTPException(503, "This API's database has no degree programs. "
                                 "Run `python -m app.requirements_import` in backend/ on the server.")
    planned = list(dict.fromkeys(c.strip() for c in body.courses if c.strip()))
    results = []
    for program_id in dict.fromkeys(body.programs):
        result = evaluate(conn, program_id, planned)
        if result is None:
            raise HTTPException(404, f"No program {program_id}.")
        results.append(result)

    major_courses = {c for r in results if r["kind"] == "major" for req in r["requirements"]
                     if req["type"] == "courses" for c in req["credited"]}
    for r in results:
        r["overlap"] = []
        if r["kind"] == "minor":
            r["overlap"] = sorted({c for req in r["requirements"] if req["type"] == "courses"
                                   for c in req["credited"] if c in major_courses})
            r["overlap_note"] = OVERLAP_NOTE if r["overlap"] else ""
    minors = [r["name"] for r in results if r["kind"] == "minor"]
    warnings = ["MIT allows at most two minors."] if len(minors) > 2 else []
    return {"programs": results, "warnings": warnings}
