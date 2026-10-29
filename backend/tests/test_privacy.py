"""Professors must never be able to see who wrote what."""
import json


def _walk_keys(value):
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from _walk_keys(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _walk_keys(inner)


def _seed(client, login):
    student, ana = login("ana@mit.edu", name="Ana Student")
    prof, _ = login("prof@mit.edu", "professor", "Rivera")
    post = client.post("/courses/6.100A/posts", json={"type": "Wish I knew", "body": "I wish I had started psets early."},
                       headers=student).json()["post"]
    client.post("/courses/6.100A/posts", json={"body": "Same here, honestly.", "parent_id": post["id"]}, headers=student)
    return student, prof, ana, post


def test_professor_responses_never_contain_author_identity(client, login):
    _, prof, ana, post = _seed(client, login)
    responses = [
        client.get("/courses/6.100A/posts", headers=prof),
        client.get("/courses/6.100A/posts?sort=new", headers=prof),
        client.post("/courses/6.100A/posts/similar", json={"text": "wish I had started psets early"}, headers=prof),
        client.get("/courses/search", params={"q": "started psets early"}, headers=prof),
    ]
    for resp in responses:
        assert resp.status_code == 200, resp.text
        raw = resp.text
        assert ana["email"] not in raw and "Ana Student" not in raw
        keys = set(_walk_keys(resp.json()))
        assert not keys & {"author_user_id", "user_id", "email", "author_id", "display_name"}

    posts = responses[0].json()["posts"]
    assert posts[0]["author"].startswith("Anonymous ")
    assert posts[0]["mine"] is False and "status" not in posts[0]


def test_professor_cannot_resolve_identity_or_open_the_queue(client, login):
    _, prof, _, post = _seed(client, login)
    assert client.get(f"/admin/posts/{post['id']}/author", headers=prof).status_code == 403
    assert client.get("/admin/moderation", headers=prof).status_code == 403
    me = client.get("/auth/me", headers=prof).json()
    assert client.post(f"/admin/users/{me['id']}/role", json={"role": "admin"}, headers=prof).status_code == 403


def test_only_admin_resolves_identity(client, login):
    student, _, ana, post = _seed(client, login)
    admin, _ = login("dean@mit.edu", "admin")
    assert client.get(f"/admin/posts/{post['id']}/author", headers=student).status_code == 403
    assert client.get(f"/admin/posts/{post['id']}/author").status_code == 401
    resp = client.get(f"/admin/posts/{post['id']}/author", headers=admin)
    assert resp.status_code == 200 and resp.json()["author"]["email"] == ana["email"]


def test_indexed_post_metadata_has_no_author(client, login, db_path):
    _seed(client, login)
    from app.rag import connect
    conn = connect(db_path)
    try:
        metas = [json.loads(r["metadata"]) for r in conn.execute("SELECT metadata FROM documents WHERE source_type='post'")]
    finally:
        conn.close()
    assert metas and all(set(m) <= {"course_id", "post_id", "post_kind", "post_type", "pseudonym", "chunk_index"}
                         for m in metas)


def test_relogin_without_a_name_keeps_it(client, login):
    login("prof@mit.edu", "professor", "Rivera")
    _, user = login("prof@mit.edu", "professor")
    assert user["display_name"] == "Rivera"


def test_concurrent_requests_share_no_connection_state(client, login):
    """Regression: sync dependencies and endpoints can run on different threads."""
    from concurrent.futures import ThreadPoolExecutor
    headers, _ = login("ana@mit.edu")
    paths = ["/courses/6.100A/fingerprints", "/courses/6.100A/posts", "/courses/batch?id=6.100A&id=18.06"] * 6
    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = list(pool.map(lambda p: client.get(p, headers=headers).status_code, paths))
    assert codes == [200] * len(paths)


def test_community_lists_questions_and_courses_without_authors(client, login):
    ana, user = login("ana@mit.edu", name="Ana Student")
    ben, _ = login("ben@mit.edu")
    prof, _ = login("prof@mit.edu", "professor")
    q = client.post("/courses/6.3900/posts", json={"type": "Question", "body": "Is 18.06 enough math for this?"},
                    headers=ana).json()["post"]
    client.post("/courses/6.3900/posts", json={"body": "Yes, mostly.", "parent_id": q["id"]}, headers=ben)
    client.post("/courses/14.01/posts", json={"type": "Taught me", "body": "Supply and demand everywhere."}, headers=ben)

    resp = client.get("/community", headers=prof)
    assert resp.status_code == 200 and user["email"] not in resp.text and "Ana Student" not in resp.text
    body = resp.json()
    assert [x["id"] for x in body["questions"]] == [q["id"]]                # Taught me posts aren't questions
    assert body["questions"][0]["replies_count"] == 1
    assert body["questions"][0]["course_title"] == "Introduction to Machine Learning"
    assert {c["id"]: c["post_counts"] for c in body["courses"]} == {"6.3900": {"Question": 1}, "14.01": {"Taught me": 1}}


def test_cors_origins_forgive_pasting_slips():
    from app.settings import cors_origins
    assert cors_origins('"https://infinite-discovery.up.railway.app/" , localhost:3000') == [
        "https://infinite-discovery.up.railway.app",
        "http://localhost:3000",
    ]
    assert cors_origins("infinite-discovery.up.railway.app") == ["https://infinite-discovery.up.railway.app"]
    assert cors_origins("") == []


def test_cors_allows_the_configured_site(db_path):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.settings import Settings
    from tests.conftest import bow_embeddings
    from app.drafts import TemplateDrafter

    settings = Settings(db_path=db_path, cors_origins=["https://infinite-discovery.up.railway.app"])
    client = TestClient(create_app(settings, embed_fn=bow_embeddings, drafter=TemplateDrafter()))
    ok = client.options("/requirements/progress", headers={
        "Origin": "https://infinite-discovery.up.railway.app", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "https://infinite-discovery.up.railway.app"
    blocked = client.options("/requirements/progress", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in blocked.headers
