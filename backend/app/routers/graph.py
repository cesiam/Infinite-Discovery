"""Tab 4: Graph."""
from fastapi import APIRouter, Depends, Query, Request

from app.db import get_conn
from app.routers.courses import search_courses

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("")
def graph(dept: list[str] | None = Query(None), course: list[str] | None = Query(None),
          include_soft: bool = True, unlocks: bool = False, conn=Depends(get_conn)):
    """Nodes are catalog courses, edges point prereq -> course with type hard/soft.

    With no filter this is the whole catalog (~6k nodes). dept= and course=
    narrow it to those courses plus the prereqs pointing into them, so a
    department view still shows where its prereqs come from. unlocks=true
    also adds the courses that list them as a prereq."""
    kinds = ("hard", "soft") if include_soft else ("hard",)
    edge_rows = conn.execute(f"""
        SELECT prereq_course_id AS source, course_id AS target, kind, COUNT(*) AS support
        FROM prereqs WHERE kind IN ({','.join('?' * len(kinds))})
        GROUP BY prereq_course_id, course_id, kind
    """, kinds).fetchall()
    node_rows = conn.execute("""
        SELECT course_id, title, json_extract(metadata, '$.department') AS department
        FROM documents WHERE source_type = 'catalog'
    """).fetchall()

    if dept or course:
        focus = {r["course_id"] for r in node_rows if (dept and r["department"] in dept) or (course and r["course_id"] in course)}
        edge_rows = [e for e in edge_rows if e["target"] in focus or (unlocks and e["source"] in focus)]
        keep = focus | {e["source"] for e in edge_rows} | {e["target"] for e in edge_rows}
        node_rows = [r for r in node_rows if r["course_id"] in keep]

    return {
        "nodes": [{"id": r["course_id"], "course_id": r["course_id"], "number": r["course_id"], "title": r["title"],
                   "department": r["department"]} for r in node_rows],
        "edges": [{"source": e["source"], "target": e["target"], "type": e["kind"],
                   "support": e["support"] if e["kind"] == "soft" else None} for e in edge_rows],
    }


@router.get("/group")
def group(request: Request, q: str = Query(min_length=1, max_length=300), top_k: int = Query(15, ge=1, le=60),
          conn=Depends(get_conn)):
    """The courses a query is about, for the frontend to circle as one group."""
    hits = search_courses(conn, request, q, top_k)
    return {"query": q, "course_ids": [hit.course_id for hit in hits],
            "scores": {hit.course_id: round(hit.score, 6) for hit in hits}}


def similarity_edges(conn, k: int):
    """Each catalog course linked to its k nearest courses by catalog-text embedding (the
    same vectors the hybrid search uses). Undirected, strongest link kept per pair."""
    import numpy as np

    rows = conn.execute("""
        SELECT d.course_id, v.embedding FROM documents d JOIN vec_documents v ON v.rowid = d.id
        WHERE d.source_type = 'catalog' ORDER BY d.course_id
    """).fetchall()
    ids = [r["course_id"] for r in rows]
    vectors = np.stack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-9
    best: dict = {}
    for start in range(0, len(ids), 512):       # 512 x 6000 similarity blocks keep memory small
        block = vectors[start:start + 512] @ vectors.T
        for i, row in enumerate(block):
            row[start + i] = -1                 # not yourself
            for j in np.argpartition(-row, k)[:k]:
                a, b = sorted((ids[start + i], ids[j]))
                best[(a, b)] = max(best.get((a, b), 0.0), float(row[j]))
    return [{"source": a, "target": b, "type": "similar", "similarity": round(s, 3)} for (a, b), s in best.items()]


@router.get("/similarity")
def similarity_graph(request: Request, k: int = Query(3, ge=1, le=8), conn=Depends(get_conn)):
    """Courses linked by how similar their catalog descriptions are, for the second graph.
    Computed once per k and kept in memory (about a second for the whole catalog)."""
    cache = request.app.state.__dict__.setdefault("similarity_cache", {})
    if k not in cache:
        cache[k] = similarity_edges(conn, k)
    nodes = conn.execute("""
        SELECT course_id, title, json_extract(metadata, '$.department') AS department
        FROM documents WHERE source_type = 'catalog'
    """).fetchall()
    return {
        "nodes": [{"id": r["course_id"], "course_id": r["course_id"], "number": r["course_id"], "title": r["title"],
                   "department": r["department"]} for r in nodes],
        "edges": cache[k],
    }
