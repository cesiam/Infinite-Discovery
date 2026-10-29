import hashlib
import math
import re

import pytest
from fastapi.testclient import TestClient

from app.drafts import TemplateDrafter
from app.main import create_app
from app.rag import connect, migrate, upsert_documents
from app.settings import Settings

from config import EMBEDDING_DIM
from convert import Document

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"a", "an", "the", "i", "to", "of", "and", "or", "in", "is", "it", "this", "that", "for", "on",
         "my", "me", "was", "how", "do", "you", "what", "with", "be", "are", "so", "about", "if"}


def bow_embedding(text):
    """Bag-of-words hashed into EMBEDDING_DIM buckets, unit length. Offline and
    deterministic, and texts that share words land close together, which the
    similar-posts tests rely on."""
    vec = [0.0] * EMBEDDING_DIM
    for word in _WORD.findall(text.lower()):
        if word in _STOP:
            continue
        word = word[:-1] if len(word) > 4 and word.endswith("s") else word
        digest = hashlib.sha256(word.encode()).digest()
        vec[int.from_bytes(digest[:4], "big") % EMBEDDING_DIM] += 1.0
    if not any(vec):
        vec[0] = 1.0
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec]


def bow_embeddings(texts):
    return [bow_embedding(t) for t in texts]


CATALOG = [
    ("6.100A", "Introduction to Computer Science Programming in Python",
     "Introduction to computer science and programming for students with little or no programming experience.", "None"),
    ("6.1200", "Mathematics for Computer Science",
     "Elementary discrete mathematics for science and engineering: proofs, induction, graphs, counting, probability.",
     "Calculus I (GIR)"),
    ("6.1210", "Introduction to Algorithms",
     "Mathematical modeling of computational problems, common algorithms, algorithmic paradigms, and data structures.",
     "6.100A and (6.1200 or 6.120A)"),
    ("6.3900", "Introduction to Machine Learning",
     "Principles and algorithms of machine learning from an optimization perspective: linear and logistic regression, neural networks.",
     "(6.1000 or 6.1210) and (18.03 or 18.06)"),
    ("18.06", "Linear Algebra", "Matrix theory and linear algebra: systems of equations, vector spaces, eigenvalues.",
     "Calculus II (GIR)"),
    ("18.03", "Differential Equations", "Ordinary differential equations and their applications.",
     "None. <I>Coreq: 18.02</I>"),
    ("14.01", "Principles of Microeconomics", "Introduces microeconomic concepts: supply and demand, markets, firms.", "None"),
]


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "test.db"
    conn = migrate(connect(path))
    docs = [
        Document(doc_key=f"catalog:{cid}", course_id=cid, source_type="catalog", title=title, text=text,
                 metadata={"department": cid.split(".")[0], "units": "4-0-8", "units_total": 12, "prereqs": prereqs})
        for cid, title, text, prereqs in CATALOG
    ]
    # Filler courses that mention discussion-ish words, so a vector search that
    # takes the global k nearest before filtering would drown in catalog rows.
    docs += [
        Document(doc_key=f"catalog:99.{i:03d}", course_id=f"99.{i:03d}", source_type="catalog",
                 title=f"Filler {i}", text="problem set office hours exam recursion lecture",
                 metadata={"department": "99", "prereqs": "None"})
        for i in range(300)
    ]
    upsert_documents(conn, docs, bow_embeddings)
    conn.close()
    return path


@pytest.fixture
def app(db_path):
    return create_app(Settings(db_path=db_path, auth_mode="dev", fingerprint_drafter="template"),
                      embed_fn=bow_embeddings, drafter=TemplateDrafter())


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def login(client):
    def _login(email, role="student", name=""):
        resp = client.post("/auth/dev/login", json={"email": email, "role": role, "display_name": name})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        return {"Authorization": f"Bearer {body['token']}"}, body["user"]
    return _login
