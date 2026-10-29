"""Keep the hybrid index in step with app writes, one record at a time, using
the same Source.document_for -> chunk -> upsert path as a full ingest."""
from app.rag import FingerprintSource, PostSource, chunk_documents, upsert_documents


def _replace(conn, base_key, doc, embed_fn):
    """Upsert doc's chunks under base_key and drop any chunk the new text no
    longer produces. doc=None removes every chunk."""
    chunks = chunk_documents([doc]) if doc is not None else []
    keep = {chunk.doc_key for chunk in chunks}
    stale = [
        row["id"] for row in conn.execute(
            "SELECT id, doc_key FROM documents WHERE doc_key = ? OR doc_key LIKE ?", (base_key, f"{base_key}#%"))
        if row["doc_key"] not in keep
    ]
    with conn:
        for row_id in stale:
            conn.execute("DELETE FROM vec_documents WHERE rowid = ?", (row_id,))
            conn.execute("DELETE FROM documents WHERE id = ?", (row_id,))
    if chunks:
        upsert_documents(conn, chunks, embed_fn)


def reindex_fingerprint(conn, fingerprint_id, embed_fn):
    row = conn.execute("""
        SELECT f.id, f.course_id, r.question, r.editor_kind
        FROM fingerprints f JOIN fingerprint_revisions r ON r.id = f.displayed_revision_id
        WHERE f.id = ?
    """, (fingerprint_id,)).fetchone()
    if row is not None:
        _replace(conn, f"fingerprint:{row['course_id']}:{row['id']}", FingerprintSource.document_for(row), embed_fn)


def reindex_post(conn, post_id, embed_fn):
    row = conn.execute("""
        SELECT p.id, p.course_id, p.parent_id, p.post_type, p.body, p.status, ps.handle
        FROM posts p JOIN pseudonyms ps ON ps.user_id = p.author_user_id AND ps.course_id = p.course_id
        WHERE p.id = ?
    """, (post_id,)).fetchone()
    if row is None:
        return
    visible = row["status"] in PostSource.VISIBLE_STATUSES
    _replace(conn, f"post:{row['course_id']}:{row['id']}", PostSource.document_for(row) if visible else None, embed_fn)
