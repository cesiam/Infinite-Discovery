def test_held_post_hidden_until_admin_publishes(client, login):
    student, _ = login("ana@mit.edu")
    admin, _ = login("dean@mit.edu", "admin")
    resp = client.post("/courses/6.100A/posts", json={"type": "Question", "body": "Text me at 617-555-0134 about psets"},
                       headers=student).json()
    assert resp["moderation"]["action"] == "hold" and resp["post"]["status"] == "held"

    assert client.get("/courses/6.100A/posts").json()["posts"] == []                 # public
    mine = client.get("/courses/6.100A/posts", headers=student).json()["posts"]        # author sees it waiting
    assert mine[0]["status"] == "held"

    queue = client.get("/admin/moderation", headers=admin).json()["items"]
    assert queue[0]["content"]["id"] == resp["post"]["id"] and "contains a phone number" in queue[0]["reasons"]
    client.post(f"/admin/moderation/{queue[0]['id']}/resolve", json={"action": "publish"}, headers=admin)
    assert len(client.get("/courses/6.100A/posts").json()["posts"]) == 1
    assert client.get("/admin/moderation", headers=admin).json()["items"] == []


def test_flagged_post_stays_visible_and_hidden_post_is_kept(client, login, db_path):
    student, _ = login("ana@mit.edu")
    admin, _ = login("dean@mit.edu", "admin")
    resp = client.post("/courses/6.100A/posts", json={"type": "Taught me", "body": "See https://example.com for notes"},
                       headers=student).json()
    assert resp["moderation"]["action"] == "flag"
    assert len(client.get("/courses/6.100A/posts").json()["posts"]) == 1

    item = client.get("/admin/moderation", headers=admin).json()["items"][0]
    client.post(f"/admin/moderation/{item['id']}/resolve", json={"action": "hide"}, headers=admin)
    assert client.get("/courses/6.100A/posts").json()["posts"] == []

    from app.rag import connect
    conn = connect(db_path)
    try:
        assert conn.execute("SELECT status FROM posts WHERE id = ?", (resp["post"]["id"],)).fetchone()[0] == "hidden"
    finally:
        conn.close()


def test_votes_and_threading(client, login):
    ana, _ = login("ana@mit.edu")
    ben, _ = login("ben@mit.edu")
    low = client.post("/courses/6.100A/posts", json={"type": "Question", "body": "Is lecture attendance required?"},
                      headers=ana).json()["post"]
    high = client.post("/courses/6.100A/posts", json={"type": "Wish I knew", "body": "Start psets the day they come out."},
                       headers=ana).json()["post"]
    client.post("/courses/6.100A/posts", json={"body": "No, but it helps.", "parent_id": low["id"]}, headers=ben)

    assert client.post(f"/posts/{high['id']}/vote", json={"value": 1}, headers=ben).json()["score"] == 1
    assert client.post(f"/posts/{low['id']}/vote", json={"value": -1}, headers=ben).json()["score"] == -1
    assert client.post(f"/posts/{low['id']}/vote", json={"value": 1}, headers=ana).status_code == 403   # own post

    posts = client.get("/courses/6.100A/posts", headers=ben).json()["posts"]
    assert [p["id"] for p in posts] == [high["id"], low["id"]]                       # sorted by score
    assert posts[0]["my_vote"] == 1 and posts[1]["replies"][0]["body"] == "No, but it helps."
    assert client.get("/courses/6.100A/posts", params={"type": "Question"}).json()["posts"][0]["id"] == low["id"]

    assert client.post(f"/posts/{high['id']}/vote", json={"value": 0}, headers=ben).json()["score"] == 0


def test_post_validation(client, login):
    ana, _ = login("ana@mit.edu")
    assert client.post("/courses/6.100A/posts", json={"body": "no type"}, headers=ana).status_code == 422
    assert client.post("/courses/6.100A/posts", json={"type": "Question", "body": "hi"}).status_code == 401
    assert client.post("/courses/NOPE.1/posts", json={"type": "Question", "body": "hi"}, headers=ana).status_code == 404
