def _post(client, headers, course, body, type="Question"):
    resp = client.post(f"/courses/{course}/posts", json={"type": type, "body": body}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["post"]


def _similar(client, course, text):
    resp = client.post(f"/courses/{course}/posts/similar", json={"text": text})
    assert resp.status_code == 200, resp.text
    return resp.json()["similar"]


def test_finds_the_matching_post(client, login):
    headers, _ = login("ana@mit.edu")
    target = _post(client, headers, "6.100A", "How many hours per week do the problem sets take?")
    _post(client, headers, "6.100A", "Recursion finally clicked for me in lecture nine.", "Taught me")
    _post(client, headers, "6.100A", "I wish I had learned to use the debugger earlier.", "Wish I knew")

    found = _similar(client, "6.100A", "how many hours do problem sets take each week")
    assert found and found[0]["post"]["id"] == target["id"]
    assert 0 < found[0]["similarity"] <= 1


def test_at_most_three(client, login):
    headers, _ = login("ana@mit.edu")
    for i in range(6):
        _post(client, headers, "6.100A", f"Problem sets take many hours each week, version {i}")
    assert len(_similar(client, "6.100A", "problem sets take many hours")) == 3


def test_unrelated_text_returns_nothing(client, login):
    headers, _ = login("ana@mit.edu")
    _post(client, headers, "6.100A", "How many hours per week do the problem sets take?")
    assert _similar(client, "6.100A", "supply and demand curves for coffee markets") == []


def test_scoped_to_the_course(client, login):
    headers, _ = login("ana@mit.edu")
    _post(client, headers, "6.1200", "How many hours per week do the problem sets take?")
    assert _similar(client, "6.100A", "how many hours do problem sets take each week") == []


def test_ignores_replies_held_posts_and_short_drafts(client, login):
    headers, _ = login("ana@mit.edu")
    parent = _post(client, headers, "6.100A", "Is the final exam cumulative?")
    client.post("/courses/6.100A/posts", json={"body": "Problem sets take about ten hours a week.",
                                                "parent_id": parent["id"]}, headers=headers)
    # held by moderation (contains an email address), so not visible
    _post(client, headers, "6.100A", "Problem sets take ten hours, email me at ana@mit.edu")
    assert _similar(client, "6.100A", "problem sets take ten hours a week") == []
    assert _similar(client, "6.100A", "psets?") == []


def test_survives_many_catalog_neighbours(client, login):
    """The fixture holds 300 filler catalog docs. A KNN-then-filter search
    would return only those; the exact, filtered-first search still finds the post."""
    headers, _ = login("ana@mit.edu")
    target = _post(client, headers, "6.100A", "Do office hours help with the recursion problem set?")
    found = _similar(client, "6.100A", "office hours recursion problem set exam lecture")
    assert found and found[0]["post"]["id"] == target["id"]
