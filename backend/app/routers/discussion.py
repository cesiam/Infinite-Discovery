"""Tab 3: Discussion, Stack Overflow / Reddit style.

Anonymity: anonymous to the public, verified to the system. Posts are stored
with the author's user id, but no response here ever includes it. Authors
show as their per-course pseudonym. The only route that maps a post back to a
person is GET /admin/posts/{id}/author, and it is admin-only (and admins are
never professors: a user has exactly one role).
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import pseudonyms
from app.auth import current_user, optional_user
from app.catalog import require_course, summaries
from app.db import get_conn
from app.indexing import reindex_post
from app.moderation import POST_STATUS, enqueue
from app.rag import PostSource, vector_search_exact

router = APIRouter(tags=["discussion"])

PostType = Literal["Taught me", "Wish I knew", "Question"]
VISIBLE = PostSource.VISIBLE_STATUSES
SIMILAR_LIMIT = 3
SIMILAR_MIN_CHARS = 12


def _post_rows(conn, where, params, viewer_id):
    return conn.execute(f"""
        SELECT p.id, p.course_id, p.parent_id, p.post_type, p.body, p.status, p.created_at,
               ps.handle,
               p.author_user_id = ? AS mine,
               COALESCE(SUM(v.value = 1), 0) AS upvotes,
               COALESCE(SUM(v.value = -1), 0) AS downvotes,
               (SELECT value FROM votes WHERE post_id = p.id AND user_id = ?) AS my_vote
        FROM posts p
        JOIN pseudonyms ps ON ps.user_id = p.author_user_id AND ps.course_id = p.course_id
        LEFT JOIN votes v ON v.post_id = p.id
        WHERE {where}
        GROUP BY p.id
    """, [viewer_id, viewer_id, *params]).fetchall()


def post_json(row, viewer):
    """The only shape a post leaves the API in. No author id, email or name."""
    data = {
        "id": row["id"],
        "course_id": row["course_id"],
        "parent_id": row["parent_id"],
        "type": row["post_type"],
        "body": row["body"],
        "author": pseudonyms.display(row["handle"]),
        "upvotes": row["upvotes"],
        "downvotes": row["downvotes"],
        "score": row["upvotes"] - row["downvotes"],
        "my_vote": row["my_vote"] or 0,
        "mine": bool(row["mine"]),
        "created_at": row["created_at"],
        "replies": [],
    }
    # moderation status is between the author and the admins
    if row["mine"] or (viewer is not None and viewer["role"] == "admin"):
        data["status"] = row["status"]
    return data


def _visible_clause(viewer):
    """Published/flagged posts, plus the viewer's own held ones so they can see they're waiting."""
    statuses = ",".join("?" * len(VISIBLE))
    if viewer is None:
        return f"p.status IN ({statuses})", list(VISIBLE)
    return f"(p.status IN ({statuses}) OR (p.author_user_id = ? AND p.status = 'held'))", [*VISIBLE, viewer["id"]]


@router.get("/courses/{course_id}/posts")
def list_posts(course_id: str, type: PostType | None = None, sort: Literal["top", "new"] = "top",
               conn=Depends(get_conn), viewer=Depends(optional_user)):
    require_course(conn, course_id)
    clause, params = _visible_clause(viewer)
    rows = _post_rows(conn, f"p.course_id = ? AND {clause}", [course_id, *params], viewer["id"] if viewer else -1)

    by_id = {row["id"]: post_json(row, viewer) for row in rows}
    roots = []
    for post in by_id.values():
        parent = by_id.get(post["parent_id"]) if post["parent_id"] else None
        if parent is not None:
            parent["replies"].append(post)
        elif post["parent_id"] is None:
            roots.append(post)
        # a reply whose parent is hidden is dropped along with its parent

    def order(posts):
        if sort == "new":
            posts.sort(key=lambda p: (p["created_at"], p["id"]), reverse=True)
        else:
            posts.sort(key=lambda p: (p["score"], p["created_at"], p["id"]), reverse=True)
        for post in posts:
            post["replies"].sort(key=lambda p: (p["created_at"], p["id"]))   # replies read top-down
        return posts

    if type is not None:
        roots = [post for post in roots if post["type"] == type]
    return {"course_id": course_id, "posts": order(roots)}


class NewPost(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    type: PostType | None = None
    parent_id: int | None = None


@router.post("/courses/{course_id}/posts", status_code=201)
def create_post(course_id: str, body: NewPost, request: Request, conn=Depends(get_conn), user=Depends(current_user)):
    require_course(conn, course_id)
    text = body.body.strip()
    if not text:
        raise HTTPException(422, "Post can't be empty.")
    if body.parent_id is None and body.type is None:
        raise HTTPException(422, "A post needs a type: Taught me, Wish I knew, or Question.")
    if body.parent_id is not None:
        if body.type is not None:
            raise HTTPException(422, "Replies don't take a type.")
        parent = conn.execute("SELECT course_id, status FROM posts WHERE id = ?", (body.parent_id,)).fetchone()
        if parent is None or parent["course_id"] != course_id or parent["status"] not in VISIBLE:
            raise HTTPException(404, "No such post to reply to in this course.")

    pseudonyms.handle_for(conn, user["id"], course_id)
    decision = request.app.state.moderator.review(text)
    with conn:
        post_id = conn.execute(
            "INSERT INTO posts (course_id, parent_id, author_user_id, post_type, body, status) VALUES (?, ?, ?, ?, ?, ?)",
            (course_id, body.parent_id, user["id"], body.type, text, POST_STATUS[decision.action]),
        ).lastrowid
        enqueue(conn, "post", post_id, decision)
    reindex_post(conn, post_id, request.app.state.embed_fn)

    row = _post_rows(conn, "p.id = ?", [post_id], user["id"])[0]
    return {"post": post_json(row, user), "moderation": {"action": decision.action, "reasons": decision.reasons}}


class Vote(BaseModel):
    value: Literal[-1, 0, 1]


@router.post("/posts/{post_id}/vote")
def vote(post_id: int, body: Vote, conn=Depends(get_conn), user=Depends(current_user)):
    post = conn.execute("SELECT author_user_id, status FROM posts WHERE id = ?", (post_id,)).fetchone()
    if post is None or post["status"] not in VISIBLE:
        raise HTTPException(404, "No such post.")
    if post["author_user_id"] == user["id"]:
        raise HTTPException(403, "You can't vote on your own post.")
    with conn:
        if body.value == 0:
            conn.execute("DELETE FROM votes WHERE post_id = ? AND user_id = ?", (post_id, user["id"]))
        else:
            conn.execute("INSERT INTO votes (post_id, user_id, value) VALUES (?, ?, ?) "
                         "ON CONFLICT (post_id, user_id) DO UPDATE SET value = excluded.value",
                         (post_id, user["id"], body.value))
    row = _post_rows(conn, "p.id = ?", [post_id], user["id"])[0]
    return {"id": post_id, "upvotes": row["upvotes"], "downvotes": row["downvotes"],
            "score": row["upvotes"] - row["downvotes"], "my_vote": row["my_vote"] or 0}


class Draft(BaseModel):
    text: str = Field(max_length=5000)


@router.post("/courses/{course_id}/posts/similar")
def similar_posts(course_id: str, body: Draft, request: Request, limit: int = Query(SIMILAR_LIMIT, ge=1, le=SIMILAR_LIMIT),
                  conn=Depends(get_conn), viewer=Depends(optional_user)):
    """Called while someone types a post: up to 3 existing posts in this course
    that already say something close. Debounce on the client; each call embeds the draft."""
    require_course(conn, course_id)
    text = body.text.strip()
    if len(text) < SIMILAR_MIN_CHARS:
        return {"course_id": course_id, "similar": []}

    embedding = request.app.state.embed_fn([text])[0]
    max_distance = request.app.state.settings.similar_post_max_distance
    hits = vector_search_exact(conn, embedding, candidate_k=limit * 4, source_types=["post"],
                               filters={"course_id": course_id, "post_kind": "post"})
    best = {}                          # post_id -> distance; a long post has several chunks
    doc_ids = [hit["id"] for hit in hits if hit["distance"] <= max_distance]
    if doc_ids:
        for row in conn.execute(f"SELECT id, json_extract(metadata, '$.post_id') AS post_id FROM documents "
                                f"WHERE id IN ({','.join('?' * len(doc_ids))})", doc_ids):
            distance = next(hit["distance"] for hit in hits if hit["id"] == row["id"])
            best[row["post_id"]] = min(distance, best.get(row["post_id"], 2.0))
    ranked = sorted(best.items(), key=lambda item: item[1])[:limit]
    if not ranked:
        return {"course_id": course_id, "similar": []}

    rows = {row["id"]: row for row in _post_rows(
        conn, f"p.id IN ({','.join('?' * len(ranked))}) AND p.status IN ({','.join('?' * len(VISIBLE))})",
        [post_id for post_id, _ in ranked] + list(VISIBLE), viewer["id"] if viewer else -1)}
    return {"course_id": course_id, "similar": [
        {"post": post_json(rows[post_id], viewer), "similarity": round(1 - distance, 4)}
        for post_id, distance in ranked if post_id in rows
    ]}


@router.get("/community")
def community(limit: int = Query(6, ge=1, le=20), conn=Depends(get_conn), viewer=Depends(optional_user)):
    """The campus conversation: the best-voted open questions across all courses,
    and the courses people are talking about most. Same anonymous post shape as above."""
    statuses = ",".join("?" * len(VISIBLE))
    viewer_id = viewer["id"] if viewer else -1
    question_rows = _post_rows(conn, f"p.parent_id IS NULL AND p.post_type = 'Question' AND p.status IN ({statuses})",
                               list(VISIBLE), viewer_id)
    questions = sorted((post_json(r, viewer) for r in question_rows),
                       key=lambda p: (p["score"], p["created_at"], p["id"]), reverse=True)[:limit]

    reply_counts = dict(conn.execute(f"""
        SELECT parent_id, COUNT(*) FROM posts WHERE parent_id IS NOT NULL AND status IN ({statuses}) GROUP BY parent_id
    """, list(VISIBLE)).fetchall())
    activity = conn.execute(f"""
        SELECT course_id, post_type, COUNT(*) AS n FROM posts
        WHERE parent_id IS NULL AND status IN ({statuses}) GROUP BY course_id, post_type
    """, list(VISIBLE)).fetchall()
    by_course: dict = {}
    for row in activity:
        by_course.setdefault(row["course_id"], {})[row["post_type"]] = row["n"]
    busiest = sorted(by_course, key=lambda c: (-sum(by_course[c].values()), c))[:limit]
    catalog = summaries(conn, [*busiest, *(q["course_id"] for q in questions)])
    descriptions = {r["course_id"]: r["content"] for r in conn.execute(
        f"SELECT course_id, content FROM documents WHERE source_type = 'catalog' AND course_id IN ({','.join('?' * len(busiest)) or 'NULL'})",
        busiest)}

    return {
        "questions": [{**q, "replies_count": reply_counts.get(q["id"], 0),
                       "course_title": catalog.get(q["course_id"], {}).get("title", "")} for q in questions],
        "courses": [{"id": c, "number": c, **catalog[c], "post_counts": by_course[c],
                     "description": descriptions.get(c, "")} for c in busiest if c in catalog],
    }
