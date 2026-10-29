"""Prerequisite edges. Hard edges are parsed from the catalog's free-text
prerequisites; soft edges come from students and professors.

The catalog text is boolean ("(6.1000 or 6.1210) and (18.03 or 18.06)"). The
graph stores one hard edge per subject mentioned, so alternatives each get an
edge; the original sentence is returned alongside as prereq_text. Not turned
into edges: GIRs ("Calculus I (GIR)"), "permission of instructor", and
corequisites (everything after "Coreq").
"""
import json
import re

from app.rag import CatalogSource

_SUBJECT = CatalogSource._SUBJECT_REF
_TAGS = re.compile(r"<[^>]+>")
_COREQ = re.compile(r"\bco-?req", re.I)


def parse_hard_prereqs(text: str, course_id: str, known_ids) -> list:
    text = _TAGS.sub(" ", text or "")
    text = _COREQ.split(text, maxsplit=1)[0]
    found = []
    for match in _SUBJECT.finditer(text):
        ref = match.group(0)
        if ref != course_id and ref in known_ids and ref not in found:
            found.append(ref)
    return found


def sync_catalog_prereqs(conn) -> int:
    """Rebuild the hard (catalog) edges from the indexed catalog. Catalog edges
    are derived data, so replacing them is safe; student/professor rows are untouched."""
    rows = conn.execute(
        "SELECT course_id, json_extract(metadata, '$.prereqs') AS prereqs FROM documents WHERE source_type = 'catalog'"
    ).fetchall()
    known = {row["course_id"] for row in rows}
    edges = [
        (row["course_id"], ref)
        for row in rows
        for ref in parse_hard_prereqs(row["prereqs"], row["course_id"], known)
    ]
    with conn:
        conn.execute("DELETE FROM prereqs WHERE source = 'catalog'")
        conn.executemany(
            "INSERT OR IGNORE INTO prereqs (course_id, prereq_course_id, kind, source) VALUES (?, ?, 'hard', 'catalog')",
            edges,
        )
        conn.execute("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('prereqs_synced', ?)",
                     (json.dumps({"edges": len(edges)}),))
    return len(edges)


def ensure_catalog_prereqs(conn):
    if conn.execute("SELECT 1 FROM index_meta WHERE key = 'prereqs_synced'").fetchone() is None:
        sync_catalog_prereqs(conn)


def course_prereqs(conn, course_id: str) -> list:
    """Hard edges first, then soft edges with how many people suggested each."""
    rows = conn.execute("""
        SELECT p.prereq_course_id, p.kind, MIN(p.source) AS source, COUNT(*) AS support, d.title
        FROM prereqs p
        LEFT JOIN documents d ON d.doc_key = 'catalog:' || p.prereq_course_id
        WHERE p.course_id = ?
        GROUP BY p.prereq_course_id, p.kind
        ORDER BY p.kind = 'soft', support DESC, p.prereq_course_id
    """, (course_id,)).fetchall()
    return [
        {"course_id": r["prereq_course_id"], "title": r["title"] or "", "kind": r["kind"],
         "source": r["source"], "support": r["support"] if r["kind"] == "soft" else None}
        for r in rows
    ]
