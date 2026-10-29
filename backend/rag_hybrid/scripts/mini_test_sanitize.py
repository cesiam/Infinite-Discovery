import pytest

from conftest import doc
from lexical import bm25_search, sanitize_query


def test_course_numbers_kept_whole():
    assert sanitize_query("6.3900") == '"6.3900"'
    assert sanitize_query("18.06") == '"18.06"'
    assert sanitize_query("6.S191 and 21M.030") == '"6.s191" OR "21m.030"'


def test_punctuation_stripped_and_tokens_quoted():
    assert sanitize_query("what's (machine) learning?") == '"machine" OR "learning"'


def test_fts_operators_are_neutralized():
    # Bare AND/OR/NOT/NEAR and -, *, :, ^ are FTS5 syntax; after sanitizing they
    # are either dropped or quoted literals.
    assert sanitize_query('NEAR(x y) -foo* title:bar ^baz "') == '"near" OR "foo" OR "title" OR "bar" OR "baz"'


def test_nothing_searchable():
    assert sanitize_query("") == ""
    assert sanitize_query("?!... --- ()") == ""
    assert sanitize_query("the of and") == ""


@pytest.fixture
def conn(make_db):
    return make_db([
        doc("6.3900", "Introduction to Machine Learning", "Principles of supervised learning.", department="6"),
        doc("18.06", "Linear Algebra", "Matrix theory and linear algebra.", department="18"),
        doc("6.1200", "Mathematics for Computer Science", "Proofs. 6 problem sets, room 3900.", department="6"),
    ])


@pytest.mark.parametrize("raw", [
    "what's 6.3900?",
    'machine "learning',
    "AND OR NOT",
    "(18.06)",
    "linear-algebra: matrices*",
    "NEAR(",
    "C++ / C# !!!",
])
def test_raw_input_never_raises(conn, raw):
    bm25_search(conn, raw, candidate_k=10)


@pytest.mark.parametrize("query, expected_first", [
    ("6.3900", "6.3900"),
    ("18.06", "18.06"),
    ("is 18.06 hard?", "18.06"),
])
def test_course_number_queries_find_the_course(conn, query, expected_first):
    hits = bm25_search(conn, query, candidate_k=10)
    ids = [conn.execute("SELECT course_id FROM documents WHERE id=?", (h["id"],)).fetchone()[0] for h in hits]
    assert ids and ids[0] == expected_first


def test_course_number_is_a_phrase_not_two_loose_tokens(conn):
    # 6.1200's text has "6" and "3900" but not adjacent, so "6.3900" must not match it.
    hits = bm25_search(conn, "6.3900", candidate_k=10)
    ids = {conn.execute("SELECT course_id FROM documents WHERE id=?", (h["id"],)).fetchone()[0] for h in hits}
    assert ids == {"6.3900"}
