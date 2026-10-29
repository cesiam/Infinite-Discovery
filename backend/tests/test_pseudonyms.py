import re


def _post(client, headers, course, body, type="Question"):
    resp = client.post(f"/courses/{course}/posts", json={"type": type, "body": body}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["post"]


def test_same_user_same_course_same_pseudonym(client, login):
    headers, _ = login("ana@mit.edu")
    first = _post(client, headers, "6.100A", "Is it worth starting the problem sets early?")
    second = _post(client, headers, "6.100A", "Taught me to break problems into functions.", "Taught me")
    reply = client.post("/courses/6.100A/posts", json={"body": "Following up on this.", "parent_id": first["id"]},
                        headers=headers).json()["post"]
    assert re.fullmatch(r"Anonymous [0-9a-f]{4}", first["author"])
    assert first["author"] == second["author"] == reply["author"]


def test_pseudonym_survives_a_new_session(client, login):
    headers, _ = login("ana@mit.edu")
    first = _post(client, headers, "6.100A", "How long do the psets take?")
    headers_again, _ = login("ana@mit.edu")
    second = _post(client, headers_again, "6.100A", "How hard is the final exam?")
    assert first["author"] == second["author"]


def test_same_user_different_courses_different_pseudonyms(client, login):
    headers, _ = login("ana@mit.edu")
    courses = ["6.100A", "6.1200", "6.1210", "6.3900", "18.06", "18.03", "14.01"]
    handles = [_post(client, headers, c, f"A question about {c} workload?")["author"] for c in courses]
    assert len(set(handles)) == len(courses)


def test_different_users_same_course_different_pseudonyms(client, login):
    ana, _ = login("ana@mit.edu")
    ben, _ = login("ben@mit.edu")
    assert _post(client, ana, "6.100A", "Question from Ana here?")["author"] != \
        _post(client, ben, "6.100A", "Question from Ben here?")["author"]
