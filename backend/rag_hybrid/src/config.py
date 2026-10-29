import os
from pathlib import Path

from dotenv import load_dotenv

# config.py lives at rag_hybrid/src/, so parents[1] is rag_hybrid/ and
# parents[2] is the project root (where .env lives).
RAG_HYBRID_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = RAG_HYBRID_ROOT.parent

load_dotenv(PROJECT_ROOT / ".env")

DATA_DIR = RAG_HYBRID_ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"          # raw API responses, so re-indexing doesn't re-hit the API
DATABASE_PATH = DATA_DIR / "catalog.db"

# --- embeddings (ingestion/embed.py) ---
# Overridable from the environment. If you change the model, EMBEDDING_DIM must
# match it; index.py refuses to write into a DB built with a different model.
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "384"))
EMBEDDING_BATCH_SIZE = 64

# --- RRF fusion (retrieval/search.py::weighted_rrf) ---
RRF_WEIGHT_VECTOR = float(os.getenv("RRF_WEIGHT_VECTOR", "0.7"))
RRF_WEIGHT_LEXICAL = float(os.getenv("RRF_WEIGHT_LEXICAL", "1.0"))
RRF_SMOOTHING = 60

# --- candidate pool vs final output (retrieval/search.py::hybrid_search) ---
# candidate_k: how many hits EACH retriever contributes before fusion (wide).
# top_k: how many fused results come back (narrow).
DEFAULT_CANDIDATE_K = 100
DEFAULT_TOP_K = 10

# --- BM25 column weights, in FTS column order: course_id, title, content ---
BM25_WEIGHTS = (10.0, 5.0, 1.0)

# --- vector search over-fetch when filtering (retrieval/vector.py) ---
# sqlite-vec's `k = ?` constraint picks nearest neighbors from the whole table
# BEFORE any WHERE filter, so a filtered search needs a wider net cast first.
VECTOR_OVERFETCH_MULTIPLIER = 20
VECTOR_OVERFETCH_MIN = 200

# --- MIT Course Catalog API (ingestion/convert.py::CatalogSource) ---
CATALOG_BASE_URL = os.getenv("MIT_CATALOG_BASE_URL", "https://global.api-dev.mit.edu/mit-course-catalog/v1/")
CATALOG_CLIENT_ID = os.getenv("MIT_CATALOG_CLIENT_ID", "")
CATALOG_CLIENT_SECRET = os.getenv("MIT_CATALOG_CLIENT_SECRET", "")
CATALOG_TIMEOUT_S = 30
CATALOG_MAX_RETRIES = 5
CATALOG_BACKOFF_BASE_S = 1.0
CATALOG_MIN_INTERVAL_S = 0.2            # client-side throttle between requests

# Term codes are MIT academic-year style: 2027FA = Fall 2026, 2027JA = IAP 2027,
# 2027SP = Spring 2027, 2027SU = Summer 2027. Every term returns the full
# catalog; the term only changes `offered` and instructors.
CATALOG_ACADEMIC_YEAR = os.getenv("MIT_CATALOG_ACADEMIC_YEAR", "2027")
CATALOG_TERM_SUFFIXES = ("FA", "JA", "SP", "SU")

# Starting points for department discovery. The API has no department list, so
# ingest crawls from these and follows subject ids mentioned in prerequisites
# and cross-listings. Unknown codes just return no subjects.
CATALOG_SEED_DEPARTMENTS = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "15", "16", "17", "18",
    "20", "21", "21A", "21G", "21H", "21L", "21M", "21W", "22", "24",
    "AS", "CC", "CMS", "CSB", "CSE", "EC", "EM", "ES", "HST", "IDS", "MAS", "MS", "NS",
    "SCM", "SP", "STS", "WGS",
]
