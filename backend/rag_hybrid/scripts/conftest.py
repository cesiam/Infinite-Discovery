import hashlib
import math
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]  # rag_hybrid/
sys.path.append(str(_ROOT / "src"))
sys.path.append(str(_ROOT / "src" / "ingestion"))
sys.path.append(str(_ROOT / "src" / "retrieval"))

from config import EMBEDDING_DIM
from convert import Document
from index import init_database, upsert_documents


def fake_embedding(text):
    """Deterministic unit vector from a hash: no model download in unit tests."""
    seed = hashlib.sha256(text.encode()).digest()
    values = [((seed[i % len(seed)] + i * 7) % 256) - 127.5 for i in range(EMBEDDING_DIM)]
    norm = math.sqrt(sum(v * v for v in values))
    return [v / norm for v in values]


def fake_embeddings(texts):
    return [fake_embedding(t) for t in texts]


def doc(course_id, title, text, source_type="catalog", key_suffix="", **metadata):
    return Document(
        doc_key=f"{source_type}:{course_id}{key_suffix}",
        course_id=course_id,
        source_type=source_type,
        title=title,
        text=text,
        metadata=metadata,
    )


@pytest.fixture
def make_db(tmp_path):
    """make_db(docs) -> open connection to a fresh index containing docs."""
    conns = []

    def _make(docs):
        conn = init_database(tmp_path / "test.db")
        upsert_documents(conn, docs, fake_embeddings)
        conns.append(conn)
        return conn

    yield _make
    for conn in conns:
        conn.close()
