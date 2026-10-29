"""Seed demo data into the real catalog DB, through the API itself:

    cd backend && .venv/bin/python -m app.seed

Five courses get AI-drafted fingerprints (Claude if credentials are set up,
templates otherwise) and a few posts, replies and votes from fake dev users.
Safe to re-run: it stops if the demo users already exist.
"""
from dataclasses import replace

from fastapi.testclient import TestClient

from app.main import create_app
from app.rag import connect
from app.settings import Settings

COURSES = ["6.100A", "6.1200", "6.3900", "18.06", "14.01"]

USERS = {
    "ana": ("ana.demo@mit.edu", "student", "Ana"),
    "ben": ("ben.demo@mit.edu", "student", "Ben"),
    "chloe": ("chloe.demo@mit.edu", "student", "Chloe"),
    "prof": ("prof.demo@mit.edu", "professor", "Rivera"),
    "admin": ("admin.demo@mit.edu", "admin", "Dean of Students"),
}

# (author, type, body, [(replier, reply)], [(voter, value)])
POSTS = {
    "6.100A": [
        ("ana", "Wish I knew", "I wish I'd known that the problem sets get much longer after the midterm. "
         "Start them the day they're released.", [("ben", "Same. Pset 4 took me twice as long as pset 3.")],
         [("ben", 1), ("chloe", 1)]),
        ("ben", "Taught me", "This class taught me to break a problem into small functions and test each one "
         "before moving on. That habit carried into every other course.", [], [("ana", 1)]),
        ("chloe", "Question", "Is it realistic to take 6.100A with no programming background at all?",
         [("ana", "Yes, I had none. Go to office hours early, before you're stuck.")], [("ben", 1)]),
    ],
    "6.1200": [
        ("ben", "Wish I knew", "I wish I knew how much practice writing proofs matters. Reading the solutions "
         "isn't the same as writing one yourself.", [], [("ana", 1), ("chloe", 1)]),
        ("chloe", "Question", "How much does 6.1200 overlap with 18.600 on probability?", [], []),
    ],
    "6.3900": [
        ("ana", "Taught me", "6.3900 taught me that most of machine learning is choosing a loss function and "
         "understanding what it's optimizing for.", [("chloe", "The gradient descent labs made that click for me.")],
         [("ben", 1)]),
        ("ben", "Question", "Do I need 18.06 before 6.3900, or is 18.03 enough for the linear algebra?",
         [("ana", "18.06 helped me a lot with the matrix notation, but people do fine with 18.03.")], [("chloe", 1)]),
    ],
    "18.06": [
        ("chloe", "Taught me", "Linear algebra taught me to think of a matrix as a transformation, not a grid "
         "of numbers. Eigenvectors finally made sense.", [], [("ana", 1), ("ben", 1)]),
        ("ana", "Wish I knew", "I wish I'd watched the lecture videos before class. The pace in person is fast.",
         [], [("ben", -1)]),
    ],
    "14.01": [
        ("ben", "Taught me", "14.01 taught me how to reason about markets with supply and demand curves, and why "
         "a price ceiling leads to shortages.", [], [("chloe", 1)]),
        ("chloe", "Question", "Is 14.01 manageable as a HASS alongside a heavy technical semester?",
         [("ben", "Yes, the problem sets are steady but not huge.")], []),
    ],
}

SOFT_PREREQS = [("ana", "6.3900", "6.1200", "Helps with the probability and proofs in the notes.")]
PROFESSOR_EDIT = ("6.3900", "When would you choose logistic regression over a neural network, and why?")


def main():
    settings = replace(Settings(), auth_mode="dev")
    conn = connect(settings.db_path)
    try:
        if conn.execute("SELECT 1 FROM users WHERE email = ?", (USERS["ana"][0],)).fetchone():
            print("Demo data is already seeded; nothing to do.")
            return
    except Exception:
        pass                         # tables don't exist yet; create_app migrates them
    finally:
        conn.close()

    client = TestClient(create_app(settings))
    headers = {}
    for key, (email, role, name) in USERS.items():
        resp = client.post("/auth/dev/login", json={"email": email, "role": role, "display_name": name})
        resp.raise_for_status()
        headers[key] = {"Authorization": f"Bearer {resp.json()['token']}"}

    for course in COURSES:
        fps = client.get(f"/courses/{course}/fingerprints").json()["fingerprints"]
        print(f"{course}: {len(fps)} fingerprints (ai_draft={all(f['ai_draft'] for f in fps)})")

        for author, post_type, body, replies, votes in POSTS[course]:
            resp = client.post(f"/courses/{course}/posts", json={"type": post_type, "body": body},
                               headers=headers[author])
            resp.raise_for_status()
            post_id = resp.json()["post"]["id"]
            for replier, text in replies:
                client.post(f"/courses/{course}/posts", json={"body": text, "parent_id": post_id},
                            headers=headers[replier]).raise_for_status()
            for voter, value in votes:
                client.post(f"/posts/{post_id}/vote", json={"value": value}, headers=headers[voter]).raise_for_status()
        print(f"{course}: {len(POSTS[course])} posts")

    for user, course, prereq, note in SOFT_PREREQS:
        client.post(f"/courses/{course}/prereqs/soft", json={"prereq_course_id": prereq, "note": note},
                    headers=headers[user]).raise_for_status()

    course, question = PROFESSOR_EDIT
    fp = client.get(f"/courses/{course}/fingerprints").json()["fingerprints"][0]
    client.put(f"/fingerprints/{fp['id']}", json={"question": question, "summary": "Make it about a decision"},
               headers=headers["prof"]).raise_for_status()
    print("Done. Dev users:", ", ".join(email for email, _, _ in USERS.values()))


if __name__ == "__main__":
    main()
