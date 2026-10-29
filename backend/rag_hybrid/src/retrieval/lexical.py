import re
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from config import BM25_WEIGHTS

# FTS5 MATCH parses its argument as a query expression, so raw punctuation,
# quotes, parentheses, `-`, `*`, `:` and bare AND/OR/NOT/NEAR are syntax errors
# or operators. We pull out word tokens and emit each one as a quoted string,
# which FTS5 always treats as a literal phrase.
#
# Dotted tokens are kept whole so course numbers survive: "6.3900" becomes the
# phrase "6.3900", which the unicode61 tokenizer splits into the ADJACENT
# tokens 6 3900 — matching course 6.3900 but not, say, "6 units ... 3900".
_TOKEN = re.compile(r"[^\W_]+(?:\.[^\W_]+)*")

_STOP = {"a", "an", "the", "that", "is", "as", "of", "to", "in", "if", "and", "or",
         "it", "its", "for", "by", "on", "when", "does", "not", "with", "about",
         "what", "how", "i", "me", "my", "class", "classes", "course", "courses"}

_METADATA_KEY = re.compile(r"^\w+$")


def sanitize_query(text):
    terms = []
    for token in _TOKEN.findall(text or ""):
        lowered = token.lower()
        if "." not in token and not token.isdigit() and (lowered in _STOP or len(token) < 2):
            continue
        if lowered not in terms:
            terms.append(lowered)
    return " OR ".join(f'"{t}"' for t in terms)


def filter_sql(source_types=None, filters=None, alias="m"):
    """WHERE fragments + params for source_type and metadata filters.

    filters maps a metadata key to a value or list of values (any-of). A
    metadata field may itself be a scalar or a JSON list (e.g. terms), so a
    filter on terms="Fall" matches metadata {"terms": ["Fall", "Spring"]}.
    """
    clauses, params = [], []
    if source_types:
        clauses.append(f"{alias}.source_type IN ({','.join('?' * len(source_types))})")
        params.extend(source_types)
    for key, wanted in (filters or {}).items():
        if not _METADATA_KEY.match(key):
            raise ValueError(f"invalid metadata filter key: {key!r}")
        wanted = [wanted] if isinstance(wanted, (str, int, float)) else list(wanted)
        clauses.append(
            f"EXISTS (SELECT 1 FROM json_each({alias}.metadata, ?) "
            f"WHERE CAST(value AS TEXT) IN ({','.join('?' * len(wanted))}))"
        )
        params.append(f'$."{key}"')
        params.extend(str(w) for w in wanted)
    return clauses, params


def bm25_search(conn, query, candidate_k, source_types=None, filters=None):
    """Return up to candidate_k rows (id, bm25), best first. Lower bm25 = better."""
    match = sanitize_query(query)
    if not match:
        return []

    clauses, params = filter_sql(source_types, filters)
    sql = f"""
        SELECT m.id, bm25(documents_fts, {', '.join(str(w) for w in BM25_WEIGHTS)}) AS bm25
        FROM documents_fts
        JOIN documents m ON m.id = documents_fts.rowid
        WHERE documents_fts MATCH ?
        {''.join(' AND ' + c for c in clauses)}
        ORDER BY bm25
        LIMIT ?
    """
    return [dict(row) for row in conn.execute(sql, [match, *params, candidate_k])]
