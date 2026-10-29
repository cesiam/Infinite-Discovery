"""Bridge to the existing hybrid search in rag_hybrid/src.

rag_hybrid's modules import each other by bare name (`from index import ...`),
so their directories go on sys.path once, here. Everything in app/ imports
search, indexing and schema code through this module."""
import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "rag_hybrid" / "src"
for _path in (_SRC, _SRC / "ingestion", _SRC / "retrieval"):
    if str(_path) not in sys.path:
        sys.path.append(str(_path))

from chunking import chunk_documents  # noqa: E402
from config import DATABASE_PATH  # noqa: E402
from convert import CatalogSource, FingerprintSource, PostSource  # noqa: E402
from index import connect, migrate, upsert_documents  # noqa: E402
from search import hybrid_search  # noqa: E402
from vector import vector_search_exact  # noqa: E402

__all__ = [
    "CatalogSource", "DATABASE_PATH", "FingerprintSource", "PostSource", "chunk_documents", "connect",
    "hybrid_search", "migrate", "upsert_documents", "vector_search_exact",
]


def default_embed(texts):
    """The same fastembed model the catalog index was built with. Imported on
    first use so the API (and tests that inject their own) start without it."""
    from embed import generate_embeddings
    return generate_embeddings(texts)
