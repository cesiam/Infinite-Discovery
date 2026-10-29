import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1]
sys.path.append(str(_SRC))
sys.path.append(str(_SRC / "retrieval"))
sys.path.append(str(_SRC / "ingestion"))

from config import (
    DATABASE_PATH,
    DEFAULT_CANDIDATE_K,
    DEFAULT_TOP_K,
    RRF_SMOOTHING,
    RRF_WEIGHT_LEXICAL,
    RRF_WEIGHT_VECTOR,
)
from lexical import bm25_search
from vector import vector_search


@dataclass
class SearchHit:
    """One fused result. The single return shape of hybrid_search."""
    doc_id: int
    course_id: str
    source_type: str
    title: str
    text: str
    metadata: dict
    score: float                          # fused weighted-RRF score
    bm25_rank: int | None = None          # 1-based rank in the lexical candidate list, None if absent
    vector_rank: int | None = None        # 1-based rank in the vector candidate list, None if absent
    bm25_score: float | None = None
    vector_distance: float | None = None
    # when grouped by course: the other docs from this course that also matched
    also_matched: list["SearchHit"] = field(default_factory=list)


def weighted_rrf(lexical_ids, vector_ids, smoothing_param=RRF_SMOOTHING, weights=None):
    """Fuse two ranked id lists. Returns [(id, score, lexical_rank, vector_rank)],
    best first, over the union of both lists. Ties keep first-seen order
    (lexical list first), so results are deterministic."""
    if weights is None:
        weights = {"lexical": RRF_WEIGHT_LEXICAL, "vector": RRF_WEIGHT_VECTOR}

    lexical_ranks = {doc_id: rank for rank, doc_id in enumerate(lexical_ids, start=1)}
    vector_ranks = {doc_id: rank for rank, doc_id in enumerate(vector_ids, start=1)}

    fused = []
    for doc_id in dict.fromkeys([*lexical_ids, *vector_ids]):
        l_rank, v_rank = lexical_ranks.get(doc_id), vector_ranks.get(doc_id)
        score = 0.0
        if l_rank is not None:
            score += weights["lexical"] / (smoothing_param + l_rank)
        if v_rank is not None:
            score += weights["vector"] / (smoothing_param + v_rank)
        fused.append((doc_id, score, l_rank, v_rank))
    return sorted(fused, key=lambda t: t[1], reverse=True)


def _load_hits(conn, fused, lexical, vector):
    if not fused:
        return []
    bm25_by_id = {r["id"]: r["bm25"] for r in lexical}
    dist_by_id = {r["id"]: r["distance"] for r in vector}
    ids = [doc_id for doc_id, *_ in fused]
    rows = {
        row["id"]: row
        for row in conn.execute(
            f"SELECT id, course_id, source_type, title, content, metadata FROM documents "
            f"WHERE id IN ({','.join('?' * len(ids))})",
            ids,
        )
    }
    return [
        SearchHit(
            doc_id=doc_id,
            course_id=rows[doc_id]["course_id"],
            source_type=rows[doc_id]["source_type"],
            title=rows[doc_id]["title"],
            text=rows[doc_id]["content"],
            metadata=json.loads(rows[doc_id]["metadata"]),
            score=score,
            bm25_rank=l_rank,
            vector_rank=v_rank,
            bm25_score=bm25_by_id.get(doc_id),
            vector_distance=dist_by_id.get(doc_id),
        )
        for doc_id, score, l_rank, v_rank in fused
    ]


def group_by_course(hits):
    """Collapse hits to one per course_id. The course keeps its best doc's
    score (max, not sum, so a course with many docs isn't favored just for
    having more of them); the rest go in also_matched."""
    grouped = {}
    for hit in hits:                      # hits are already best-first
        if hit.course_id in grouped:
            grouped[hit.course_id].also_matched.append(hit)
        else:
            grouped[hit.course_id] = hit
    return list(grouped.values())


def hybrid_search(conn, query_text, query_embedding=None, top_k=DEFAULT_TOP_K, candidate_k=DEFAULT_CANDIDATE_K,
                  source_types=None, filters=None, group_courses=True, smoothing_param=RRF_SMOOTHING, weights=None):
    """BM25 + vector search, fused with weighted RRF.

    candidate_k: hits pulled from EACH retriever before fusion (wide).
    top_k: results returned after fusion and grouping (narrow).
    """
    if candidate_k < top_k:
        raise ValueError(f"candidate_k ({candidate_k}) must be >= top_k ({top_k})")
    if query_embedding is None:
        from embed import generate_embedding
        query_embedding = generate_embedding(query_text)

    lexical = bm25_search(conn, query_text, candidate_k, source_types, filters)
    vector = vector_search(conn, query_embedding, candidate_k, source_types, filters)
    fused = weighted_rrf([r["id"] for r in lexical], [r["id"] for r in vector], smoothing_param, weights)

    hits = _load_hits(conn, fused, lexical, vector)
    if group_courses:
        hits = group_by_course(hits)
    return hits[:top_k]


def main():
    from index import connect

    parser = argparse.ArgumentParser(description="Hybrid search over the indexed MIT course catalog.")
    parser.add_argument("query")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    parser.add_argument("--candidate-k", type=int, default=DEFAULT_CANDIDATE_K)
    parser.add_argument("--dept", action="append", help="department filter, e.g. 6 (repeatable)")
    parser.add_argument("--term", action="append", help="term filter (repeatable)")
    parser.add_argument("--source-type", action="append", help="e.g. catalog (repeatable)")
    parser.add_argument("--no-group", action="store_true", help="don't collapse multiple docs per course")
    parser.add_argument("--w-lexical", type=float, default=RRF_WEIGHT_LEXICAL, help="RRF weight for BM25 (keyword)")
    parser.add_argument("--w-vector", type=float, default=RRF_WEIGHT_VECTOR, help="RRF weight for vector (semantic)")
    parser.add_argument("--db", default=str(DATABASE_PATH))
    args = parser.parse_args()

    if not Path(args.db).exists():
        sys.exit(f"No index at {args.db}; run src/ingestion/index.py first.")

    filters = {}
    if args.dept:
        filters["department"] = args.dept
    if args.term:
        filters["terms"] = args.term

    conn = connect(args.db)
    hits = hybrid_search(conn, args.query, top_k=args.top_k, candidate_k=args.candidate_k,
                         source_types=args.source_type, filters=filters, group_courses=not args.no_group,
                         weights={"lexical": args.w_lexical, "vector": args.w_vector})
    conn.close()

    fmt = lambda r: "-" if r is None else str(r)
    print(f"{'#':>2}  {'course_id':<10} {'fused':>7}  {'bm25#':>5} {'vec#':>5}  title")
    for i, hit in enumerate(hits, start=1):
        print(f"{i:>2}  {hit.course_id:<10} {hit.score:>7.4f}  {fmt(hit.bm25_rank):>5} {fmt(hit.vector_rank):>5}  {hit.title}")
    if not hits:
        print("(no results)")


if __name__ == "__main__":
    main()
