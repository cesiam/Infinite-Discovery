import argparse
import hashlib
import json
import sqlite3
import struct
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import sqlite_vec

from config import DATABASE_PATH, EMBEDDING_DIM, EMBEDDING_MODEL


def connect(db_path=DATABASE_PATH, check_same_thread=True):
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=check_same_thread)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# --- schema migrations ---
# Append-only. Each entry runs once, in order, inside a transaction, and bumps
# schema_version. Never edit or drop a shipped migration; add a new one
# (ALTER TABLE ADD COLUMN, new table, new index) instead.

def _migration_1(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS index_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_key TEXT NOT NULL UNIQUE,
            course_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',
            content_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_documents_course ON documents(course_id);
        CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_type);

        -- full text search, kept in sync with documents by the triggers below
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            course_id,
            title,
            content,
            content='documents',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
            INSERT INTO documents_fts(rowid, course_id, title, content)
            VALUES (new.id, new.course_id, new.title, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, course_id, title, content)
            VALUES ('delete', old.id, old.course_id, old.title, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, course_id, title, content)
            VALUES ('delete', old.id, old.course_id, old.title, old.content);
            INSERT INTO documents_fts(rowid, course_id, title, content)
            VALUES (new.id, new.course_id, new.title, new.content);
        END;
    """)
    # vector embeddings, rowid shared with documents.id
    conn.execute(f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
            embedding float[{EMBEDDING_DIM}] distance_metric=cosine
        )
    """)
    conn.executemany(
        "INSERT OR IGNORE INTO index_meta(key, value) VALUES (?, ?)",
        [("embedding_model", EMBEDDING_MODEL), ("embedding_dim", str(EMBEDDING_DIM))],
    )


def _migration_2(conn):
    """Tables for the Infinite Discovery API (backend/app): accounts, prereq
    edges, wiki-style fingerprints, anonymous discussion, moderation.

    Revisions and posts are append-only: triggers refuse DELETE, and refuse
    UPDATE of a revision's text. Moderation changes a post's status; it never
    removes the row."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            auth_provider TEXT NOT NULL,              -- 'dev' now, 'mit' once MIT login is wired
            external_id TEXT NOT NULL,                -- the provider's stable subject id
            email TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL CHECK (role IN ('student', 'professor', 'admin')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (auth_provider, external_id)
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,              -- sha256 of the bearer token; the token itself is never stored
            user_id INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL
        );

        -- one stable handle per (user, course): "Anonymous a3f9"
        CREATE TABLE IF NOT EXISTS pseudonyms (
            user_id INTEGER NOT NULL REFERENCES users(id),
            course_id TEXT NOT NULL,
            handle TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, course_id),
            UNIQUE (course_id, handle)
        );

        -- prereq_course_id must be taken before course_id
        CREATE TABLE IF NOT EXISTS prereqs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            prereq_course_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('hard', 'soft')),
            source TEXT NOT NULL CHECK (source IN ('catalog', 'student', 'professor')),
            created_by INTEGER REFERENCES users(id), -- NULL for catalog rows
            note TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prereqs_unique
            ON prereqs(course_id, prereq_course_id, kind, COALESCE(created_by, 0));
        CREATE INDEX IF NOT EXISTS idx_prereqs_prereq ON prereqs(prereq_course_id);

        CREATE TABLE IF NOT EXISTS fingerprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            latest_revision_id INTEGER REFERENCES fingerprint_revisions(id),
            displayed_revision_id INTEGER REFERENCES fingerprint_revisions(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_fingerprints_course ON fingerprints(course_id);

        CREATE TABLE IF NOT EXISTS fingerprint_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fingerprint_id INTEGER NOT NULL REFERENCES fingerprints(id),
            parent_revision_id INTEGER REFERENCES fingerprint_revisions(id),
            question TEXT NOT NULL,
            editor_kind TEXT NOT NULL CHECK (editor_kind IN ('ai', 'human')),
            editor_user_id INTEGER REFERENCES users(id),
            edit_summary TEXT NOT NULL DEFAULT '',
            reverted_from_revision_id INTEGER REFERENCES fingerprint_revisions(id),
            review_status TEXT NOT NULL CHECK (review_status IN ('approved', 'pending', 'rejected')),
            reviewed_by INTEGER REFERENCES users(id),
            reviewed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CHECK ((editor_kind = 'ai') = (editor_user_id IS NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_revisions_fingerprint ON fingerprint_revisions(fingerprint_id);

        CREATE TRIGGER IF NOT EXISTS fingerprint_revisions_no_delete
        BEFORE DELETE ON fingerprint_revisions BEGIN
            SELECT RAISE(ABORT, 'fingerprint revisions are append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS fingerprint_revisions_frozen
        BEFORE UPDATE OF fingerprint_id, parent_revision_id, question, editor_kind, editor_user_id,
                         edit_summary, reverted_from_revision_id, created_at
        ON fingerprint_revisions BEGIN
            SELECT RAISE(ABORT, 'fingerprint revisions are append-only');
        END;

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_id TEXT NOT NULL,
            parent_id INTEGER REFERENCES posts(id),   -- NULL for a top-level post
            author_user_id INTEGER NOT NULL REFERENCES users(id),
            post_type TEXT CHECK (post_type IN ('Taught me', 'Wish I knew', 'Question')),
            body TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('published', 'flagged', 'held', 'hidden')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CHECK ((parent_id IS NULL) = (post_type IS NOT NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_posts_course ON posts(course_id, parent_id);

        CREATE TRIGGER IF NOT EXISTS posts_no_delete
        BEFORE DELETE ON posts BEGIN
            SELECT RAISE(ABORT, 'posts are never deleted; set status instead');
        END;

        CREATE TABLE IF NOT EXISTS votes (
            post_id INTEGER NOT NULL REFERENCES posts(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            value INTEGER NOT NULL CHECK (value IN (-1, 1)),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (post_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS moderation_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_kind TEXT NOT NULL CHECK (content_kind IN ('post', 'fingerprint_revision')),
            content_id INTEGER NOT NULL,
            decision TEXT NOT NULL CHECK (decision IN ('flag', 'hold')),
            reasons TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
            resolution TEXT,
            resolved_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_moderation_open ON moderation_queue(status, created_at);
    """)


def _migration_3(conn):
    """Degree programs imported from MIT's official pages (backend/app/requirements_import.py):
    majors (degree charts), minors, HASS concentrations and the GIRs. Each requirement's
    rule is JSON; see app/requirements.py for the shapes."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS programs (
            id TEXT PRIMARY KEY,                       -- e.g. 'major:6-3', 'minor:economics', 'gir'
            kind TEXT NOT NULL CHECK (kind IN ('gir', 'major', 'minor', 'concentration')),
            name TEXT NOT NULL,
            code TEXT NOT NULL DEFAULT '',             -- '6-3', '18', ''
            source_url TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS program_requirements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            section TEXT NOT NULL DEFAULT '',
            label TEXT NOT NULL,
            rule TEXT NOT NULL                         -- JSON
        );
        CREATE INDEX IF NOT EXISTS idx_program_requirements ON program_requirements(program_id, position);
    """)


def _migration_4(conn):
    """Saved plans, several per user (CourseRoad-style). The plan itself is JSON: years,
    slots, chosen programs and cart, exactly as the frontend keeps it."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id, updated_at);
    """)


MIGRATIONS = [
    (1, _migration_1),
    (2, _migration_2),
    (3, _migration_3),
    (4, _migration_4),
]


def migrate(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    current = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]
    for version, apply in MIGRATIONS:
        if version <= current:
            continue
        with conn:
            apply(conn)
            conn.execute("INSERT INTO schema_version(version) VALUES (?)", (version,))
    _check_embedding_model(conn)
    return conn


def _check_embedding_model(conn):
    stored = dict(conn.execute("SELECT key, value FROM index_meta").fetchall())
    if stored.get("embedding_model") != EMBEDDING_MODEL or stored.get("embedding_dim") != str(EMBEDDING_DIM):
        raise RuntimeError(
            f"DB was built with {stored.get('embedding_model')} ({stored.get('embedding_dim')}d) but config says "
            f"{EMBEDDING_MODEL} ({EMBEDDING_DIM}d). Use a different DATABASE_PATH or rebuild."
        )


def init_database(db_path=DATABASE_PATH):
    return migrate(connect(db_path))


def serialize_embedding(embedding):
    return struct.pack(f"{len(embedding)}f", *embedding)


def content_hash(doc):
    payload = json.dumps([doc.title, doc.text, doc.metadata], sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def upsert_documents(conn, docs, embed_fn, batch_size=256):
    """Insert new docs, update changed ones (re-embedding only those), skip
    unchanged ones. Returns counts."""
    counts = {"inserted": 0, "updated": 0, "unchanged": 0}
    for start in range(0, len(docs), batch_size):
        batch = docs[start:start + batch_size]
        hashes = [content_hash(d) for d in batch]
        existing = {
            row["doc_key"]: (row["id"], row["content_hash"])
            for row in conn.execute(
                f"SELECT id, doc_key, content_hash FROM documents WHERE doc_key IN ({','.join('?' * len(batch))})",
                [d.doc_key for d in batch],
            )
        }
        todo = [(d, h) for d, h in zip(batch, hashes) if existing.get(d.doc_key, (None, None))[1] != h]
        counts["unchanged"] += len(batch) - len(todo)
        if not todo:
            continue

        embeddings = embed_fn([f"{d.title}\n{d.text}".strip() for d, _ in todo])
        with conn:
            for (doc, h), embedding in zip(todo, embeddings):
                row = (doc.course_id, doc.source_type, doc.title, doc.text, json.dumps(doc.metadata), h)
                if doc.doc_key in existing:
                    row_id = existing[doc.doc_key][0]
                    conn.execute(
                        """UPDATE documents SET course_id=?, source_type=?, title=?, content=?, metadata=?,
                           content_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                        (*row, row_id),
                    )
                    conn.execute("DELETE FROM vec_documents WHERE rowid = ?", (row_id,))
                    counts["updated"] += 1
                else:
                    row_id = conn.execute(
                        """INSERT INTO documents (course_id, source_type, title, content, metadata, content_hash, doc_key)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (*row, doc.doc_key),
                    ).lastrowid
                    counts["inserted"] += 1
                conn.execute(
                    "INSERT INTO vec_documents(rowid, embedding) VALUES (?, ?)",
                    (row_id, serialize_embedding(embedding)),
                )
    return counts


def prune_source(conn, source_type, keep_doc_keys):
    """Delete docs of this source that the latest full fetch no longer returned."""
    stale = [
        row["id"] for row in conn.execute("SELECT id, doc_key FROM documents WHERE source_type = ?", (source_type,))
        if row["doc_key"] not in keep_doc_keys
    ]
    with conn:
        for row_id in stale:
            conn.execute("DELETE FROM vec_documents WHERE rowid = ?", (row_id,))
            conn.execute("DELETE FROM documents WHERE id = ?", (row_id,))
    return len(stale)


def ingest(source, db_path=DATABASE_PATH, refresh=False, prune=True, embed_fn=None):
    from chunking import chunk_documents
    if embed_fn is None:
        from embed import generate_embeddings as embed_fn

    conn = init_database(db_path)
    docs = chunk_documents(list(source.fetch(refresh=refresh)))
    counts = upsert_documents(conn, docs, embed_fn)
    if prune:
        counts["pruned"] = prune_source(conn, source.source_type, {d.doc_key for d in docs})
    counts["total_in_db"] = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    conn.close()
    return counts


def main():
    from convert import SOURCES

    parser = argparse.ArgumentParser(description="Fetch a source and (re)build the hybrid index.")
    parser.add_argument("--source", choices=sorted(SOURCES), default="catalog")
    parser.add_argument("--refresh", action="store_true", help="ignore the on-disk API cache and re-fetch")
    parser.add_argument("--no-prune", action="store_true", help="keep docs the source no longer returns")
    parser.add_argument("--db", default=str(DATABASE_PATH))
    args = parser.parse_args()

    counts = ingest(SOURCES[args.source](), db_path=args.db, refresh=args.refresh, prune=not args.no_prune)
    print(f"[{args.source}] " + ", ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
