import pytest

import search
from conftest import doc, fake_embedding, fake_embeddings
from index import upsert_documents


@pytest.fixture
def conn(make_db):
    return make_db([
        doc("A", "A", "alpha"), doc("B", "B", "bravo"), doc("D", "D", "delta"),
        doc("X", "X", "xray"), doc("Y", "Y", "yankee"),
    ])


def _id(conn, course_id):
    return conn.execute("SELECT id FROM documents WHERE course_id=?", (course_id,)).fetchone()[0]


@pytest.fixture
def scripted_retrievers(conn, monkeypatch):
    """Replace both retrievers with fixed ranked lists, truncated to whatever
    candidate_k hybrid_search passes them; record the k each one received."""
    lexical_order = [_id(conn, c) for c in ["A", "X", "D"]]
    vector_order = [_id(conn, c) for c in ["B", "Y", "D"]]
    calls = {}

    def fake_bm25(conn_, query, candidate_k, source_types=None, filters=None):
        calls["bm25"] = candidate_k
        return [{"id": i, "bm25": -1.0} for i in lexical_order[:candidate_k]]

    def fake_vector(conn_, embedding, candidate_k, source_types=None, filters=None):
        calls["vector"] = candidate_k
        return [{"id": i, "distance": 0.1} for i in vector_order[:candidate_k]]

    monkeypatch.setattr(search, "bm25_search", fake_bm25)
    monkeypatch.setattr(search, "vector_search", fake_vector)
    return calls


def test_retrievers_get_candidate_k_and_output_is_top_k(conn, scripted_retrievers):
    hits = search.hybrid_search(conn, "q", query_embedding=[0.0], top_k=2, candidate_k=3)
    assert scripted_retrievers == {"bm25": 3, "vector": 3}
    assert len(hits) == 2


def test_wide_candidate_pool_changes_the_winner(conn, scripted_retrievers):
    # D is 3rd in BOTH lists, so fused it beats A (1st lexical only):
    #   D = 1/63 + 0.7/63 = 0.0270  >  A = 1/61 = 0.0164
    # But only if the pool is wide enough to contain D at all. This is the
    # bug when candidate pool == top_k.
    narrow = search.hybrid_search(conn, "q", query_embedding=[0.0], top_k=1, candidate_k=1)
    wide = search.hybrid_search(conn, "q", query_embedding=[0.0], top_k=1, candidate_k=3)
    assert [h.course_id for h in narrow] == ["A"]
    assert [h.course_id for h in wide] == ["D"]
    assert (wide[0].bm25_rank, wide[0].vector_rank) == (3, 3)


def test_candidate_k_smaller_than_top_k_rejected(conn):
    with pytest.raises(ValueError):
        search.hybrid_search(conn, "q", query_embedding=[0.0], top_k=10, candidate_k=5)


# --- end-to-end on a real tiny index: filters and course grouping ---

@pytest.fixture
def catalog(make_db):
    return make_db([
        doc("6.3900", "Introduction to Machine Learning", "Supervised learning, probability.",
            department="6", terms=["Fall", "Spring"]),
        doc("6.3900", "6.3900 reflection", "Machine learning was hard but worth it.",
            source_type="reflection", department="6", terms=["Fall", "Spring"]),
        doc("18.650", "Fundamentals of Statistics", "Probability and statistical learning.",
            department="18", terms=["Spring"]),
        doc("9.520", "Statistical Learning Theory", "Machine learning theory.", department="9", terms=["Fall"]),
    ])


def test_grouping_collapses_docs_per_course_and_top_k_counts_courses(catalog):
    q = "machine learning"
    grouped = search.hybrid_search(catalog, q, fake_embedding(q), top_k=10, candidate_k=10)
    ungrouped = search.hybrid_search(catalog, q, fake_embedding(q), top_k=10, candidate_k=10, group_courses=False)
    assert [h.course_id for h in grouped].count("6.3900") == 1
    assert [h.course_id for h in ungrouped].count("6.3900") == 2
    hit = next(h for h in grouped if h.course_id == "6.3900")
    assert len(hit.also_matched) == 1

    top2 = search.hybrid_search(catalog, q, fake_embedding(q), top_k=2, candidate_k=10)
    assert len({h.course_id for h in top2}) == 2


def test_filters_apply_to_both_retrievers(catalog):
    q = "machine learning probability"
    hits = search.hybrid_search(catalog, q, fake_embedding(q), top_k=10, candidate_k=10,
                                filters={"department": "6"})
    assert {h.course_id for h in hits} == {"6.3900"}

    hits = search.hybrid_search(catalog, q, fake_embedding(q), top_k=10, candidate_k=10,
                                source_types=["catalog"], filters={"terms": "Fall"})
    assert {(h.course_id, h.source_type) for h in hits} == {("6.3900", "catalog"), ("9.520", "catalog")}


def test_reingest_is_idempotent_and_updates_in_place(catalog):
    d = doc("18.650", "Fundamentals of Statistics", "Probability and statistical learning.",
            department="18", terms=["Spring"])
    assert upsert_documents(catalog, [d], fake_embeddings) == {"inserted": 0, "updated": 0, "unchanged": 1}

    d.text = "Bayesian inference and hypothesis testing."
    assert upsert_documents(catalog, [d], fake_embeddings) == {"inserted": 0, "updated": 1, "unchanged": 0}
    assert catalog.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 4
    hits = search.hybrid_search(catalog, "bayesian", fake_embedding("bayesian"), top_k=1, candidate_k=10)
    assert hits[0].course_id == "18.650" and hits[0].bm25_rank == 1
