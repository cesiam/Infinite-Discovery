from app.prereqs import parse_hard_prereqs

KNOWN = {"6.1000", "6.1210", "18.03", "18.06", "18.02", "6.100A", "6.1200"}


def test_parse_hard_prereqs():
    assert parse_hard_prereqs("(6.1000 or 6.1210) and (18.03 or 18.06)", "6.3900", KNOWN) == \
        ["6.1000", "6.1210", "18.03", "18.06"]
    assert parse_hard_prereqs("Calculus II (GIR)", "18.06", KNOWN) == []
    assert parse_hard_prereqs("None. <I>Coreq: 18.02</I>", "18.03", KNOWN) == []          # coreqs aren't prereqs
    assert parse_hard_prereqs("6.100A and (6.1200 or 6.120A)", "6.1210", KNOWN) == ["6.100A", "6.1200"]  # unknown dropped


def test_course_detail_with_hard_and_soft_prereqs(client, login):
    student, _ = login("ana@mit.edu")
    other, _ = login("ben@mit.edu")
    for headers in (student, other, student):          # the repeat from ana counts once
        client.post("/courses/6.3900/prereqs/soft", json={"prereq_course_id": "6.1200"}, headers=headers)

    course = client.get("/courses/6.3900").json()
    assert course["title"] == "Introduction to Machine Learning" and course["units"] == "4-0-8"
    assert course["prereq_text"].startswith("(6.1000 or 6.1210)")
    hard = {p["course_id"] for p in course["prereqs"] if p["kind"] == "hard"}
    soft = [p for p in course["prereqs"] if p["kind"] == "soft"]
    assert hard == {"6.1210", "18.03", "18.06"}          # 6.1000 isn't in this test catalog
    assert soft == [{"course_id": "6.1200", "title": "Mathematics for Computer Science", "kind": "soft",
                     "source": "student", "support": 2}]
    assert client.get("/courses/NOPE.1").status_code == 404


def test_search_groups_by_course(client):
    results = client.get("/courses/search", params={"q": "machine learning neural networks"}).json()["results"]
    assert results[0]["course_id"] == "6.3900" and results[0]["number"] == "6.3900"
    assert results[0]["title"] == "Introduction to Machine Learning"
    assert len({r["course_id"] for r in results}) == len(results)


def test_graph_and_group(client):
    graph = client.get("/graph", params={"course": "6.3900"}).json()
    assert {(e["source"], e["target"], e["type"]) for e in graph["edges"]} == \
        {("6.1210", "6.3900", "hard"), ("18.03", "6.3900", "hard"), ("18.06", "6.3900", "hard")}
    assert {n["id"] for n in graph["nodes"]} == {"6.3900", "6.1210", "18.03", "18.06"}
    assert all("department" in n for n in graph["nodes"])

    group = client.get("/graph/group", params={"q": "linear algebra matrix", "top_k": 5}).json()
    assert group["course_ids"][0] == "18.06"


def test_graph_without_filter_covers_the_catalog(client):
    graph = client.get("/graph", params={"include_soft": False}).json()
    assert len(graph["nodes"]) == 307 and all(e["type"] == "hard" for e in graph["edges"])


def test_search_filters_by_units_and_term(client):
    assert client.get("/courses/search", params={"q": "linear algebra", "units": 12}).json()["results"]
    assert client.get("/courses/search", params={"q": "linear algebra", "units": 6}).json()["results"] == []
    # the test catalog has no term data, so a term filter leaves nothing
    assert client.get("/courses/search", params={"q": "linear algebra", "term": "Fall"}).json()["results"] == []


def test_course_picker(client):
    courses = client.get("/courses", params={"q": "6.1"}).json()["courses"]
    assert [c["id"] for c in courses] == ["6.100A", "6.1200", "6.1210"]
    assert client.get("/courses", params={"q": "linear"}).json()["courses"][0]["id"] == "18.06"


def test_graph_unlocks(client):
    graph = client.get("/graph", params={"course": "6.1210", "unlocks": True}).json()
    assert ("6.1210", "6.3900", "hard") in {(e["source"], e["target"], e["type"]) for e in graph["edges"]}
    assert ("6.100A", "6.1210", "hard") in {(e["source"], e["target"], e["type"]) for e in graph["edges"]}


def test_batch_summaries(client):
    courses = client.get("/courses/batch", params=[("id", "18.06"), ("id", "14.01"), ("id", "NOPE.1")]).json()["courses"]
    assert set(courses) == {"18.06", "14.01"} and courses["18.06"]["units_total"] == 12


def test_graph_shows_hard_and_soft_edges_with_node_fields(client, login):
    student, _ = login("ana@mit.edu")
    client.post("/courses/6.3900/prereqs/soft", json={"prereq_course_id": "6.1200"}, headers=student)
    graph = client.get("/graph", params={"course": "6.3900"}).json()
    types = {(e["source"], e["type"]) for e in graph["edges"]}
    assert ("18.06", "hard") in types and ("6.1200", "soft") in types
    soft = next(e for e in graph["edges"] if e["type"] == "soft")
    assert soft["support"] == 1
    node = next(n for n in graph["nodes"] if n["id"] == "6.3900")
    assert node == {"id": "6.3900", "course_id": "6.3900", "number": "6.3900",
                    "title": "Introduction to Machine Learning", "department": "6"}


def test_similarity_graph_links_courses_by_content(client):
    body = client.get("/graph/similarity", params={"k": 2}).json()
    assert len(body["nodes"]) == 307
    pairs = {(e["source"], e["target"]) for e in body["edges"]}
    assert all(e["type"] == "similar" and -1 <= e["similarity"] <= 1 for e in body["edges"])
    # the two linear-algebra-ish courses in the test catalog share words, so they're neighbors
    assert ("18.06", "6.3900") in pairs or ("18.03", "18.06") in pairs or any("18.06" in p for p in pairs)


def test_course_number_search_also_searches_its_title():
    from app.rag import connect
    from app.routers.courses import expand_course_numbers
    import tempfile, pathlib
    from tests.conftest import CATALOG, bow_embeddings
    from app.rag import migrate, upsert_documents
    from convert import Document

    path = pathlib.Path(tempfile.mkdtemp()) / "t.db"
    conn = migrate(connect(path))
    upsert_documents(conn, [Document(doc_key=f"catalog:{c}", course_id=c, source_type="catalog", title=t, text=d,
                                     metadata={"department": c.split(".")[0]}) for c, t, d, _ in CATALOG], bow_embeddings)
    assert expand_course_numbers(conn, "6.3900") == "6.3900 Introduction to Machine Learning"
    assert expand_course_numbers(conn, "what comes after 18.06?") == "what comes after 18.06? Linear Algebra"
    assert expand_course_numbers(conn, "99.999 nothing") == "99.999 nothing"          # unknown number: unchanged
    assert expand_course_numbers(conn, "6.3900 Introduction to Machine Learning").count("Machine Learning") == 1


def test_searching_a_number_returns_the_class_first_then_related_ones(client):
    results = client.get("/courses/search", params={"q": "6.3900"}).json()["results"]
    assert results[0]["course_id"] == "6.3900"
