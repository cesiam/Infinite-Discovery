# Infinite Discovery: hybrid course search

Hybrid search over the MIT course catalog. BM25 (SQLite FTS5) and cosine vector
search (sqlite-vec) run over one SQLite DB in WAL mode and are fused with
weighted Reciprocal Rank Fusion. Ported from `rag_hybrid` in
[mit-step/discussion-prep](https://github.com/mit-step/discussion-prep).

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # search + API
cp .env.example .env        # then fill in MIT_CATALOG_CLIENT_ID / MIT_CATALOG_CLIENT_SECRET
```

`.env` is gitignored. Credentials are only read through `rag_hybrid/src/config.py`
and are never printed or written to the API cache.

## Ingest

```bash
cd rag_hybrid
../.venv/bin/python src/ingestion/index.py              # fetch the catalog and build data/catalog.db
../.venv/bin/python src/ingestion/index.py --refresh    # ignore the on-disk API cache
```

Raw API responses are cached in `rag_hybrid/data/cache/`, so re-indexing doesn't
re-hit the API. Re-running ingest is incremental: unchanged docs are skipped,
changed ones are updated in place and re-embedded, and docs the source no longer
returns are pruned (`--no-prune` to keep them).

## Search

```bash
../.venv/bin/python src/retrieval/search.py "machine learning with probability" --top-k 10 --dept 6
```

Flags:
- `--candidate-k`: hits per retriever before fusion (default 100)
- `--term`: term filter
- `--source-type`: source filter
- `--no-group`: keep every matching doc instead of one row per course

`--dept`, `--term` and `--source-type` can each be repeated.

Output is course_id, fused score, BM25 rank, vector rank and title. `-` means
that retriever didn't return the doc.

From code, call `hybrid_search(conn, query, top_k=..., candidate_k=...,
source_types=[...], filters={"department": "6"})`, which returns a list of
`SearchHit` dataclasses.

## Tests

```bash
cd rag_hybrid && ../.venv/bin/python -m pytest scripts/mini_test_*.py
```

The tests use deterministic fake embeddings, so they run offline.

## Adding a new Source

1. In `src/ingestion/convert.py`, subclass `Source`, set `source_type`
   (e.g. `"fingerprint"`), and implement `fetch(refresh)` to yield `Document`s.
   Each `Document` has these fields:
   - `doc_key`: stable across runs, e.g. `"fingerprint:6.3900:q3"`
   - `course_id`
   - `source_type`
   - `title`
   - `text`
   - `metadata`: a dict
2. Register it in `SOURCES` in `convert.py`.
3. Run `index.py --source fingerprint`.

Nothing in `src/retrieval/` changes. Filters work on `source_type` and on any
metadata key. Grouping by `course_id` collapses a course's catalog entry,
fingerprints and reflections into one hit. Long texts are split by
`chunking.py`.

## Schema changes

`index.py` keeps an append-only `MIGRATIONS` list and a `schema_version` table.
To change the schema, add a new migration (e.g. `ALTER TABLE ... ADD COLUMN`).
Never edit or drop a shipped one. The DB also records which embedding model
built it, and refuses to mix models.

## API (`app/`)

FastAPI over the same `catalog.db`. The new tables are migration 2 in
`index.py`: `users`, `sessions`, `pseudonyms`, `prereqs`, `fingerprints`,
`fingerprint_revisions`, `posts`, `votes` and `moderation_queue`.

```bash
.venv/bin/python -m app.seed                          # demo data: 5 courses, fingerprints, posts
.venv/bin/uvicorn app.server:app --reload --port 8000 # docs at http://localhost:8000/docs
.venv/bin/python -m pytest                            # API tests (offline, fake embeddings)
```

The frontend reads from the API when `NEXT_PUBLIC_API_URL` is set (see `../.env.local`).

| Tab | Routes |
|---|---|
| Course description | `GET /courses/search?q=&dept=&units=&term=`, `GET /courses/{id}`, `GET /courses?q=` (picker), `GET /courses/batch?id=`, `POST /courses/{id}/prereqs/soft` |
| Fingerprints | `GET /courses/{id}/fingerprints`, `POST /courses/{id}/fingerprints`, `PUT /fingerprints/{id}`, `GET /fingerprints/{id}/history`, `POST /fingerprints/{id}/revert`, `POST /fingerprints/{id}/revisions/{rev}/review` |
| Discussion | `GET /courses/{id}/posts`, `POST /courses/{id}/posts`, `POST /posts/{id}/vote`, `POST /courses/{id}/posts/similar`, `GET /community` |
| Graph | `GET /graph?dept=&course=&include_soft=&unlocks=`, `GET /graph/group?q=` |
| Requirements | `GET /programs?kind=&q=`, `GET /programs/{id}`, `POST /requirements/progress` (`{programs, courses}`) |
| Plans | `GET /plans`, `POST /plans`, `PUT /plans/{id}`, `DELETE /plans/{id}` (signed in; your own plans only) |
| Graph (content) | `GET /graph/similarity?k=3` (each course to its k nearest by catalog-text embedding) |
| Auth | `POST /auth/dev/login`, `GET /auth/me`, `POST /auth/logout`, `GET /auth/mit/login` (501 for now) |
| Admin | `GET /admin/moderation`, `POST /admin/moderation/{id}/resolve`, `GET /admin/posts/{id}/author`, `POST /admin/users/{id}/role` |

Writes need `Authorization: Bearer <token>` from a sign-in. The design choices
(review policy, anonymity, moderation) are documented at the top of each
module in `app/routers/`.

Fingerprints and posts are new sources in `convert.py` (`FingerprintSource`
and `PostSource`). The API indexes each change as it's made. To rebuild from
the tables: `cd rag_hybrid && ../.venv/bin/python src/ingestion/index.py --source post`
(or `--source fingerprint`).

## Degree requirements

```bash
.venv/bin/python -m app.requirements_import            # majors, minors, concentrations, GIRs
.venv/bin/python -m app.requirements_import --refresh  # re-download the official pages
```

Requirements come from MIT's official pages. Undergraduate majors come from the
degree charts on catalog.mit.edu, and minors from the catalog's minors index and
department pages. HASS concentration fields come from the Registrar's list. The
GIRs are checked with the GIR tags the catalog puts on each subject (CALC I,
REST, HASS-H, CI-H, ...). Pages are cached in `rag_hybrid/data/cache/requirements/`.

Rows the parser can't turn into a rule ("two subjects from a track") are kept as
*manual* requirements. They are shown, but never checked, and they're left out of
the percentage. Concentrations are estimates: the subjects are chosen with an
advisor, so they're counted by subject number (e.g. `14.` for Economics). How
rules are written and evaluated is described at the top of `app/requirements.py`.

## Fingerprint drafts

Fingerprints are class objectives: questions you can answer once you've mastered a class
(e.g. 6.4110: "How can a POMDP be used to make decisions when the agent cannot observe
the full state?"). Drafts are machine-written and never overwrite a fingerprint a person
has edited.

```bash
.venv/bin/python -m app.draft_fingerprints --from-file app/data/fingerprint_drafts.json  # 15 demo courses
.venv/bin/python -m app.draft_fingerprints --batch          # whole catalog with Claude (Batches API)
```

`--batch` needs Anthropic credentials (`ANTHROPIC_API_KEY` in `backend/.env`). Without them,
courses get "Catalog draft" questions built from their description when first opened. These are
labelled as such, never as AI.
