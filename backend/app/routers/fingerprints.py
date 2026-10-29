"""Tab 2: Fingerprints, edited Wikipedia-style.

Every change is a new fingerprint_revisions row; nothing is overwritten (the
table's triggers refuse it). A fingerprint points at two revisions:

  latest_revision_id     the newest edit, whatever its review status
  displayed_revision_id  what the public sees: the newest approved one

Review policy: an edit goes live immediately, unless
  - moderation holds it, or
  - a student edits a fingerprint whose displayed text a professor or admin
    wrote or approved; then it waits for a professor/admin to review it.
Reverting is an edit whose text is copied from an older revision.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Literal

from app import pseudonyms
from app.auth import current_user, optional_user, require_role
from app.catalog import require_course
from app.db import get_conn
from app.indexing import reindex_fingerprint
from app.moderation import Decision, enqueue, resolve_open

router = APIRouter(tags=["fingerprints"])

STAFF = ("professor", "admin")


def _insert_revision(conn, fingerprint_id, question, editor, *, parent=None, summary="",
                     status="approved", reverted_from=None):
    return conn.execute("""
        INSERT INTO fingerprint_revisions (fingerprint_id, parent_revision_id, question, editor_kind,
            editor_user_id, edit_summary, reverted_from_revision_id, review_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (fingerprint_id, parent, question, "human" if editor else "ai", editor["id"] if editor else None,
          summary, reverted_from, status)).lastrowid


def create_fingerprint(conn, course_id, question, editor=None, summary="", decision=None):
    """New fingerprint. editor=None is an AI draft. A held human submission
    gets no displayed revision until it's reviewed."""
    held = decision is not None and decision.action == "hold"
    with conn:
        fp_id = conn.execute("INSERT INTO fingerprints (course_id) VALUES (?)", (course_id,)).lastrowid
        rev_id = _insert_revision(conn, fp_id, question, editor, summary=summary or ("AI draft" if not editor else ""),
                                  status="pending" if held else "approved")
        conn.execute("UPDATE fingerprints SET latest_revision_id = ?, displayed_revision_id = ? WHERE id = ?",
                     (rev_id, None if held else rev_id, fp_id))
        if decision is not None:
            enqueue(conn, "fingerprint_revision", rev_id, decision)
    return fp_id


def ensure_drafts(conn, course, drafter, embed_fn):
    """Every course gets AI drafts the first time anyone opens its fingerprints."""
    if conn.execute("SELECT 1 FROM fingerprints WHERE course_id = ?", (course["course_id"],)).fetchone():
        return
    questions = drafter.draft(course)
    source = getattr(drafter, "last_source", "AI draft")
    for question in questions:
        fp_id = create_fingerprint(conn, course["course_id"], question, summary=source)
        reindex_fingerprint(conn, fp_id, embed_fn)


def _fingerprint(conn, fingerprint_id):
    row = conn.execute("SELECT * FROM fingerprints WHERE id = ?", (fingerprint_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such fingerprint.")
    return row


def _is_staff_backed(conn, revision_id):
    """True if the revision was written or approved by a professor/admin."""
    if revision_id is None:
        return False
    row = conn.execute("""
        SELECT EXISTS (SELECT 1 FROM users WHERE id = r.editor_user_id AND role IN ('professor', 'admin'))
            OR EXISTS (SELECT 1 FROM users WHERE id = r.reviewed_by AND role IN ('professor', 'admin')) AS backed
        FROM fingerprint_revisions r WHERE r.id = ?
    """, (revision_id,)).fetchone()
    return bool(row and row["backed"])


def edit_fingerprint(conn, fp, editor, question, summary, decision: Decision, reverted_from=None):
    needs_review = decision.action == "hold" or (
        editor["role"] == "student" and _is_staff_backed(conn, fp["displayed_revision_id"]))
    status = "pending" if needs_review else "approved"
    with conn:
        rev_id = _insert_revision(conn, fp["id"], question, editor, parent=fp["latest_revision_id"],
                                  summary=summary, status=status, reverted_from=reverted_from)
        if status == "approved":
            conn.execute("UPDATE fingerprints SET latest_revision_id = ?, displayed_revision_id = ?, "
                         "updated_at = CURRENT_TIMESTAMP WHERE id = ?", (rev_id, rev_id, fp["id"]))
        else:
            conn.execute("UPDATE fingerprints SET latest_revision_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                         (rev_id, fp["id"]))
        enqueue(conn, "fingerprint_revision", rev_id, decision)
    return rev_id, status


def review_revision(conn, fp, revision_id, reviewer, action):
    rev = conn.execute("SELECT * FROM fingerprint_revisions WHERE id = ? AND fingerprint_id = ?",
                       (revision_id, fp["id"])).fetchone()
    if rev is None:
        raise HTTPException(404, "No such revision for this fingerprint.")
    if rev["review_status"] != "pending":
        raise HTTPException(409, f"Revision is already {rev['review_status']}.")
    with conn:
        conn.execute("UPDATE fingerprint_revisions SET review_status = ?, reviewed_by = ?, "
                     "reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
                     ("approved" if action == "approve" else "rejected", reviewer["id"], revision_id))
        if action == "approve":
            conn.execute("UPDATE fingerprints SET displayed_revision_id = ?, updated_at = CURRENT_TIMESTAMP "
                         "WHERE id = ?", (revision_id, fp["id"]))
        resolve_open(conn, "fingerprint_revision", revision_id, action, reviewer["id"])


def _editor_label(conn, row, course_id):
    """AI, "Prof. Name" for staff, or the student's course pseudonym. Never an email."""
    if row["editor_kind"] == "ai":
        # template drafts are machine-written but not AI; say which
        label = "Catalog draft" if (row["edit_summary"] or "").startswith("Catalog draft") else "AI draft"
        return {"kind": "ai", "label": label}
    if row["editor_role"] in STAFF:
        title = "Prof." if row["editor_role"] == "professor" else "Admin"
        return {"kind": row["editor_role"], "label": f"{title} {row['editor_name']}".strip()}
    return {"kind": "student", "label": pseudonyms.display(pseudonyms.handle_for(conn, row["editor_user_id"], course_id))}


_REVISION_SQL = """
    SELECT r.*, u.role AS editor_role, u.display_name AS editor_name
    FROM fingerprint_revisions r LEFT JOIN users u ON u.id = r.editor_user_id
"""


def _revision_json(conn, row, course_id, viewer):
    # Unapproved text can hold whatever moderation caught, so only staff and the
    # editor themselves see it.
    can_see = row["review_status"] == "approved" or (viewer is not None and (
        viewer["role"] in STAFF or viewer["id"] == row["editor_user_id"]))
    return {
        "id": row["id"],
        "parent_revision_id": row["parent_revision_id"],
        "question": row["question"] if can_see else None,
        "editor": _editor_label(conn, row, course_id),
        "edit_summary": row["edit_summary"] if can_see else "",
        "reverted_from_revision_id": row["reverted_from_revision_id"],
        "review_status": row["review_status"],
        "created_at": row["created_at"],
    }


def fingerprint_json(conn, fp, viewer=None):
    shown = conn.execute(_REVISION_SQL + " WHERE r.id = ?", (fp["displayed_revision_id"],)).fetchone()
    latest = conn.execute("SELECT review_status FROM fingerprint_revisions WHERE id = ?",
                          (fp["latest_revision_id"],)).fetchone()
    return {
        "id": fp["id"],
        "course_id": fp["course_id"],
        "question": shown["question"] if shown else None,
        "ai_draft": bool(shown and shown["editor_kind"] == "ai"),
        "last_editor": _editor_label(conn, shown, fp["course_id"]) if shown else None,
        "displayed_revision_id": fp["displayed_revision_id"],
        "latest_revision_id": fp["latest_revision_id"],
        "has_pending_edit": bool(latest and latest["review_status"] == "pending"),
        "updated_at": fp["updated_at"],
    }


@router.get("/courses/{course_id}/fingerprints")
def list_fingerprints(course_id: str, request: Request, conn=Depends(get_conn), viewer=Depends(optional_user)):
    course = require_course(conn, course_id)
    ensure_drafts(conn, course, request.app.state.drafter, request.app.state.embed_fn)
    rows = conn.execute("SELECT * FROM fingerprints WHERE course_id = ? AND displayed_revision_id IS NOT NULL "
                        "ORDER BY id", (course_id,)).fetchall()
    return {"course_id": course_id, "fingerprints": [fingerprint_json(conn, fp, viewer) for fp in rows]}


class NewFingerprint(BaseModel):
    question: str = Field(min_length=10, max_length=500)
    summary: str = Field(default="", max_length=200)


@router.post("/courses/{course_id}/fingerprints", status_code=201)
def add_fingerprint(course_id: str, body: NewFingerprint, request: Request, conn=Depends(get_conn),
                    user=Depends(current_user)):
    require_course(conn, course_id)
    decision = request.app.state.moderator.review(body.question)
    fp_id = create_fingerprint(conn, course_id, body.question.strip(), user, body.summary.strip(), decision)
    reindex_fingerprint(conn, fp_id, request.app.state.embed_fn)
    return {"fingerprint": fingerprint_json(conn, _fingerprint(conn, fp_id), user),
            "moderation": {"action": decision.action, "reasons": decision.reasons}}


class FingerprintEdit(BaseModel):
    question: str = Field(min_length=10, max_length=500)
    summary: str = Field(default="", max_length=200)


@router.put("/fingerprints/{fingerprint_id}")
def edit(fingerprint_id: int, body: FingerprintEdit, request: Request, conn=Depends(get_conn),
         user=Depends(current_user)):
    fp = _fingerprint(conn, fingerprint_id)
    decision = request.app.state.moderator.review(body.question)
    rev_id, status = edit_fingerprint(conn, fp, user, body.question.strip(), body.summary.strip(), decision)
    reindex_fingerprint(conn, fingerprint_id, request.app.state.embed_fn)
    return {"revision_id": rev_id, "review_status": status,
            "fingerprint": fingerprint_json(conn, _fingerprint(conn, fingerprint_id), user)}


@router.get("/fingerprints/{fingerprint_id}/history")
def history(fingerprint_id: int, conn=Depends(get_conn), viewer=Depends(optional_user)):
    fp = _fingerprint(conn, fingerprint_id)
    rows = conn.execute(_REVISION_SQL + " WHERE r.fingerprint_id = ? ORDER BY r.id DESC", (fingerprint_id,)).fetchall()
    return {"fingerprint": fingerprint_json(conn, fp, viewer),
            "revisions": [_revision_json(conn, row, fp["course_id"], viewer) for row in rows]}


class Revert(BaseModel):
    revision_id: int
    summary: str = Field(default="", max_length=200)


@router.post("/fingerprints/{fingerprint_id}/revert")
def revert(fingerprint_id: int, body: Revert, request: Request, conn=Depends(get_conn), user=Depends(current_user)):
    fp = _fingerprint(conn, fingerprint_id)
    target = conn.execute("SELECT * FROM fingerprint_revisions WHERE id = ? AND fingerprint_id = ?",
                          (body.revision_id, fingerprint_id)).fetchone()
    if target is None:
        raise HTTPException(404, "No such revision for this fingerprint.")
    if target["review_status"] != "approved":
        raise HTTPException(409, "Only a revision that was approved can be restored.")
    summary = body.summary.strip() or f"Revert to revision {target['id']}"
    decision = request.app.state.moderator.review(target["question"])
    rev_id, status = edit_fingerprint(conn, fp, user, target["question"], summary, decision, reverted_from=target["id"])
    reindex_fingerprint(conn, fingerprint_id, request.app.state.embed_fn)
    return {"revision_id": rev_id, "review_status": status,
            "fingerprint": fingerprint_json(conn, _fingerprint(conn, fingerprint_id), user)}


class Review(BaseModel):
    action: Literal["approve", "reject"]


@router.post("/fingerprints/{fingerprint_id}/revisions/{revision_id}/review")
def review(fingerprint_id: int, revision_id: int, body: Review, request: Request, conn=Depends(get_conn),
           user=Depends(require_role(*STAFF))):
    fp = _fingerprint(conn, fingerprint_id)
    review_revision(conn, fp, revision_id, user, body.action)
    reindex_fingerprint(conn, fingerprint_id, request.app.state.embed_fn)
    return {"fingerprint": fingerprint_json(conn, _fingerprint(conn, fingerprint_id), user)}
