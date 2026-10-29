def test_plans_belong_to_their_owner(client, login):
    ana, _ = login("ana@mit.edu")
    ben, _ = login("ben@mit.edu")
    data = {"years": 4, "slots": {"1-Fall": ["6.100A"]}, "programs": ["gir"], "cart": []}
    plan = client.post("/plans", json={"name": "Main road", "data": data}, headers=ana).json()
    assert plan["name"] == "Main road" and plan["data"] == data

    second = client.post("/plans", json={"name": "Course 18 backup", "data": {**data, "programs": ["gir", "major:x"]}},
                         headers=ana).json()
    assert [p["name"] for p in client.get("/plans", headers=ana).json()["plans"]] == ["Main road", "Course 18 backup"]
    assert client.get("/plans", headers=ben).json()["plans"] == []

    # someone else's plan is invisible, not just read-only
    assert client.put(f"/plans/{plan['id']}", json={"name": "x", "data": {}}, headers=ben).status_code == 404
    assert client.delete(f"/plans/{plan['id']}", headers=ben).status_code == 404

    moved = {**data, "slots": {"2-Spring": ["6.100A"]}}
    saved = client.put(f"/plans/{plan['id']}", json={"name": "Main road", "data": moved}, headers=ana).json()
    assert saved["data"]["slots"] == {"2-Spring": ["6.100A"]}
    assert client.delete(f"/plans/{second['id']}", headers=ana).status_code == 200
    assert len(client.get("/plans", headers=ana).json()["plans"]) == 1


def test_plans_need_sign_in_and_reasonable_size(client, login):
    assert client.get("/plans").status_code == 401
    ana, _ = login("ana@mit.edu")
    huge = {"slots": {"1-Fall": ["x" * 100] * 1000}}
    assert client.post("/plans", json={"name": "Huge", "data": huge}, headers=ana).status_code == 413
