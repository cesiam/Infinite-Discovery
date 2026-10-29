from app.rag import connect


def _first_fingerprint(client, course="6.3900"):
    fps = client.get(f"/courses/{course}/fingerprints").json()["fingerprints"]
    assert fps, "AI drafts should be seeded on first view"
    return fps[0]


def test_ai_drafts_seeded_once_and_marked(client):
    first = client.get("/courses/6.3900/fingerprints").json()["fingerprints"]
    second = client.get("/courses/6.3900/fingerprints").json()["fingerprints"]
    assert len(first) == 3 and [f["id"] for f in first] == [f["id"] for f in second]
    # the test drafter is the offline template, which is labelled as such, not as AI
    assert all(f["ai_draft"] and f["last_editor"]["label"] == "Catalog draft" for f in first)


def test_every_edit_is_a_new_revision(client, login):
    headers, _ = login("ana@mit.edu")
    fp = _first_fingerprint(client)
    texts = ["When would logistic regression beat a neural network here?",
             "When would you choose logistic regression over a neural network, and why?"]
    for text in texts:
        assert client.put(f"/fingerprints/{fp['id']}", json={"question": text}, headers=headers).status_code == 200

    history = client.get(f"/fingerprints/{fp['id']}/history").json()
    revisions = history["revisions"]
    assert len(revisions) == 3                                    # AI draft + two edits
    assert [r["question"] for r in revisions] == [texts[1], texts[0], fp["question"]]
    assert revisions[-1]["editor"]["kind"] == "ai"
    assert revisions[0]["parent_revision_id"] == revisions[1]["id"]
    assert history["fingerprint"]["question"] == texts[1]
    assert history["fingerprint"]["ai_draft"] is False            # a human edited it


def test_revisions_cannot_be_overwritten_or_deleted(client, login, db_path):
    fp = _first_fingerprint(client)
    conn = connect(db_path)
    try:
        for sql in ("UPDATE fingerprint_revisions SET question = 'x' WHERE fingerprint_id = ?",
                    "DELETE FROM fingerprint_revisions WHERE fingerprint_id = ?"):
            try:
                conn.execute(sql, (fp["id"],))
                raise AssertionError(f"should have been refused: {sql}")
            except Exception as error:
                assert "append-only" in str(error)
    finally:
        conn.close()


def test_student_edit_held_after_professor_approval(client, login):
    prof, _ = login("prof@mit.edu", "professor", "Rivera")
    student, _ = login("sam@mit.edu")
    fp = _first_fingerprint(client)

    approved = "Explain why gradient descent can get stuck, and what you would try next."
    client.put(f"/fingerprints/{fp['id']}", json={"question": approved}, headers=prof)

    proposed = "Explain why gradient descent can stall on a plateau, and two fixes you'd try."
    resp = client.put(f"/fingerprints/{fp['id']}", json={"question": proposed}, headers=student).json()
    assert resp["review_status"] == "pending"
    # the professor's version stays visible while the edit waits
    assert resp["fingerprint"]["question"] == approved
    assert resp["fingerprint"]["latest_revision_id"] != resp["fingerprint"]["displayed_revision_id"]
    assert resp["fingerprint"]["has_pending_edit"] is True

    # the public can see that an edit is pending, but not its text
    public = client.get(f"/fingerprints/{fp['id']}/history").json()["revisions"][0]
    assert public["review_status"] == "pending" and public["question"] is None

    assert client.post(f"/fingerprints/{fp['id']}/revisions/{resp['revision_id']}/review",
                       json={"action": "approve"}, headers=student).status_code == 403
    done = client.post(f"/fingerprints/{fp['id']}/revisions/{resp['revision_id']}/review",
                       json={"action": "approve"}, headers=prof).json()
    assert done["fingerprint"]["question"] == proposed
    assert done["fingerprint"]["displayed_revision_id"] == resp["revision_id"]


def test_student_edits_go_live_on_unreviewed_fingerprints(client, login):
    student, _ = login("sam@mit.edu")
    fp = _first_fingerprint(client)
    resp = client.put(f"/fingerprints/{fp['id']}", json={"question": "What does overfitting look like in a learning curve?"},
                      headers=student).json()
    assert resp["review_status"] == "approved"
    assert resp["fingerprint"]["displayed_revision_id"] == resp["revision_id"]


def test_revert_creates_a_new_revision(client, login):
    headers, _ = login("ana@mit.edu")
    fp = _first_fingerprint(client)
    original_rev = fp["displayed_revision_id"]
    client.put(f"/fingerprints/{fp['id']}", json={"question": "A worse version of this question, honestly."},
               headers=headers)

    resp = client.post(f"/fingerprints/{fp['id']}/revert", json={"revision_id": original_rev}, headers=headers).json()
    assert resp["fingerprint"]["question"] == fp["question"]
    revisions = client.get(f"/fingerprints/{fp['id']}/history").json()["revisions"]
    assert len(revisions) == 3
    assert revisions[0]["reverted_from_revision_id"] == original_rev
    assert revisions[0]["id"] not in (original_rev,)          # restored by copying, not by moving the pointer back


def test_fingerprints_are_searchable(client, login):
    headers, _ = login("ana@mit.edu")
    fp = _first_fingerprint(client, "14.01")
    client.put(f"/fingerprints/{fp['id']}", json={"question": "Why does a price ceiling create a shortage?"},
               headers=headers)
    results = client.get("/courses/search", params={"q": "price ceiling shortage"}).json()["results"]
    assert results[0]["course_id"] == "14.01"
    assert any(m["source_type"] == "fingerprint" for m in results[0]["matched"])


def test_bulk_drafts_replace_only_untouched_machine_drafts(client, login, db_path):
    from app.draft_fingerprints import apply_drafts
    from app.rag import connect
    from tests.conftest import bow_embeddings

    prof, _ = login("prof@mit.edu", "professor", "Rivera")
    fps = client.get("/courses/6.3900/fingerprints").json()["fingerprints"]
    client.put(f"/fingerprints/{fps[0]['id']}", json={"question": "A professor's own question about models?"}, headers=prof)

    conn = connect(db_path)
    apply_drafts(conn, "6.3900", ["How does gradient descent find parameters?", "Why does overfitting happen?",
                                  "What can a network represent that a linear model can't?", "How is RL framed?"],
                 embed_fn=bow_embeddings)
    conn.close()
    after = client.get("/courses/6.3900/fingerprints").json()["fingerprints"]
    assert after[0]["question"] == "A professor's own question about models?"          # human edit kept
    assert [f["question"] for f in after[1:3]] == ["How does gradient descent find parameters?", "Why does overfitting happen?"]
    assert len(after) == 4 and all(f["last_editor"]["label"] == "AI draft" for f in after[1:])
    history = client.get(f"/fingerprints/{after[1]['id']}/history").json()["revisions"]
    assert history[-1]["editor"]["label"] == "Catalog draft"                            # old draft kept in history
