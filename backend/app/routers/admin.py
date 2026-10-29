"""Admin-only: the moderation queue, identity resolution, role assignment.

Professors can't reach any of these; require_role("admin") checks the role
stored on the users row."""
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import public_user, require_role
from app.db import get_conn
from app.indexing import reindex_fingerprint, reindex_post
from app.moderation import resolve_open
from app.routers.fingerprints import _fingerprint, review_revision

router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_role("admin")


@router.get("/moderation")
def queue(status: Literal["open", "resolved"] = "open", conn=Depends(get_conn), admin=Depends(admin_only)):
    rows = conn.execute("SELECT * FROM moderation_queue WHERE status = ? ORDER BY created_at, id", (status,)).fetchall()
    items = []
    for row in rows:
        if row["content_kind"] == "post":
            content = conn.execute("SELECT id, course_id, parent_id, post_type, body, status FROM posts WHERE id = ?",
                                   (row["content_id"],)).fetchone()
        else:
            content = conn.execute("SELECT r.id, f.course_id, r.fingerprint_id, r.question, r.review_status "
                                   "FROM fingerprint_revisions r JOIN fingerprints f ON f.id = r.fingerprint_id "
                                   "WHERE r.id = ?", (row["content_id"],)).fetchone()
        items.append({**dict(row), "reasons": json.loads(row["reasons"]),
                      "content": dict(content) if content else None})
    return {"items": items}


class Resolution(BaseModel):
    # posts: publish | hide. fingerprint revisions: publish (= approve) | hide (= reject).
    # "hide" keeps the row; nothing is ever deleted.
    action: Literal["publish", "hide"]


@router.post("/moderation/{item_id}/resolve")
def resolve(item_id: int, body: Resolution, request: Request, conn=Depends(get_conn), admin=Depends(admin_only)):
    item = conn.execute("SELECT * FROM moderation_queue WHERE id = ?", (item_id,)).fetchone()
    if item is None:
        raise HTTPException(404, "No such queue item.")
    if item["status"] != "open":
        raise HTTPException(409, "Already resolved.")

    if item["content_kind"] == "post":
        with conn:
            conn.execute("UPDATE posts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                         ("published" if body.action == "publish" else "hidden", item["content_id"]))
            resolve_open(conn, "post", item["content_id"], body.action, admin["id"])
        reindex_post(conn, item["content_id"], request.app.state.embed_fn)
    else:
        rev = conn.execute("SELECT fingerprint_id, review_status FROM fingerprint_revisions WHERE id = ?",
                           (item["content_id"],)).fetchone()
        if rev["review_status"] == "pending":
            fp = _fingerprint(conn, rev["fingerprint_id"])
            review_revision(conn, fp, item["content_id"], admin, "approve" if body.action == "publish" else "reject")
            reindex_fingerprint(conn, fp["id"], request.app.state.embed_fn)
        else:                      # a flagged edit that went live; nothing to change but the queue
            with conn:
                resolve_open(conn, "fingerprint_revision", item["content_id"], body.action, admin["id"])
    return {"ok": True}


@router.get("/posts/{post_id}/author")
def post_author(post_id: int, conn=Depends(get_conn), admin=Depends(admin_only)):
    row = conn.execute("SELECT u.* FROM posts p JOIN users u ON u.id = p.author_user_id WHERE p.id = ?",
                       (post_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such post.")
    return {"post_id": post_id, "author": public_user(row)}


class RoleChange(BaseModel):
    role: Literal["student", "professor", "admin"]


@router.post("/users/{user_id}/role")
def set_role(user_id: int, body: RoleChange, conn=Depends(get_conn), admin=Depends(admin_only)):
    with conn:
        changed = conn.execute("UPDATE users SET role = ? WHERE id = ?", (body.role, user_id)).rowcount
    if not changed:
        raise HTTPException(404, "No such user.")
    return public_user(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
