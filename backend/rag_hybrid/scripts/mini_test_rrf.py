import pytest

from search import weighted_rrf

W = {"lexical": 1.0, "vector": 0.7}


def ids(fused):
    return [doc_id for doc_id, *_ in fused]


def test_three_docs_known_order():
    # lexical: A B C, vector: C B A, k=60, lexical weight 1.0, vector 0.7
    #   A = 1/61 + 0.7/63 = 0.027504
    #   B = 1/62 + 0.7/62 = 0.027419
    #   C = 1/63 + 0.7/61 = 0.027348
    fused = weighted_rrf(["A", "B", "C"], ["C", "B", "A"], smoothing_param=60, weights=W)
    assert ids(fused) == ["A", "B", "C"]
    scores = dict((doc_id, score) for doc_id, score, *_ in fused)
    assert scores["A"] == pytest.approx(1 / 61 + 0.7 / 63)
    assert scores["B"] == pytest.approx(1 / 62 + 0.7 / 62)
    assert scores["C"] == pytest.approx(1 / 63 + 0.7 / 61)


def test_flipping_weights_flips_order():
    fused = weighted_rrf(["A", "B", "C"], ["C", "B", "A"], smoothing_param=60, weights={"lexical": 0.7, "vector": 1.0})
    assert ids(fused) == ["C", "B", "A"]


def test_doc_in_both_lists_beats_single_list_leaders():
    # equal weights: B = 1/62 + 1/61 beats A = 1/61 and C = 1/62
    fused = weighted_rrf(["A", "B"], ["B", "C"], smoothing_param=60, weights={"lexical": 1.0, "vector": 1.0})
    assert ids(fused) == ["B", "A", "C"]


def test_ranks_reported_per_retriever():
    fused = weighted_rrf(["A", "B"], ["B", "C"], smoothing_param=60, weights=W)
    ranks = {doc_id: (l, v) for doc_id, _, l, v in fused}
    assert ranks == {"A": (1, None), "B": (2, 1), "C": (None, 2)}


def test_empty_inputs():
    assert weighted_rrf([], []) == []
    assert ids(weighted_rrf([], ["X"])) == ["X"]
