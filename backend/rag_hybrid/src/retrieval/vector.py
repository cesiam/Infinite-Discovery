import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1]
sys.path.append(str(_SRC))
sys.path.append(str(_SRC / "retrieval"))
sys.path.append(str(_SRC / "ingestion"))

from config import VECTOR_OVERFETCH_MIN, VECTOR_OVERFETCH_MULTIPLIER
from index import serialize_embedding
from lexical import filter_sql


def vector_search(conn, query_embedding, candidate_k, source_types=None, filters=None):
    """Return up to candidate_k rows (id, distance), nearest first (cosine distance)."""
    clauses, params = filter_sql(source_types, filters)
    # sqlite-vec's `k = ?` picks nearest neighbors from the WHOLE table before
    # any WHERE filter runs, so a filtered search casts a wider net first,
    # then LIMIT trims back down to candidate_k after filtering.
    fetch_k = candidate_k if not clauses else max(candidate_k * VECTOR_OVERFETCH_MULTIPLIER, VECTOR_OVERFETCH_MIN)

    sql = f"""
        SELECT m.id, v.distance
        FROM vec_documents v
        JOIN documents m ON m.id = v.rowid
        WHERE v.embedding MATCH ?
        AND k = ?
        {''.join(' AND ' + c for c in clauses)}
        ORDER BY v.distance
        LIMIT ?
    """
    rows = conn.execute(sql, [serialize_embedding(query_embedding), fetch_k, *params, candidate_k])
    return [dict(row) for row in rows]


def vector_search_exact(conn, query_embedding, candidate_k, source_types=None, filters=None):
    """Like vector_search, but filters first and computes the exact cosine
    distance to every matching row. For narrow scopes (one course's posts)
    where the KNN-then-filter over-fetch can miss every match: the k nearest
    rows of the whole table may all be catalog entries."""
    clauses, params = filter_sql(source_types, filters)
    sql = f"""
        SELECT m.id, vec_distance_cosine(v.embedding, ?) AS distance
        FROM documents m
        JOIN vec_documents v ON v.rowid = m.id
        {'WHERE ' + ' AND '.join(clauses) if clauses else ''}
        ORDER BY distance
        LIMIT ?
    """
    rows = conn.execute(sql, [serialize_embedding(query_embedding), *params, candidate_k])
    return [dict(row) for row in rows]
