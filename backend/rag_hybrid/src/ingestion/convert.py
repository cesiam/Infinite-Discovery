from __future__ import annotations

import base64
import hashlib
import json
import random
import re
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator
from urllib.parse import urljoin

import requests

sys.path.append(str(Path(__file__).resolve().parents[1]))

from config import (
    CACHE_DIR,
    CATALOG_ACADEMIC_YEAR,
    CATALOG_BACKOFF_BASE_S,
    CATALOG_BASE_URL,
    CATALOG_CLIENT_ID,
    CATALOG_CLIENT_SECRET,
    CATALOG_MAX_RETRIES,
    CATALOG_MIN_INTERVAL_S,
    CATALOG_SEED_DEPARTMENTS,
    CATALOG_TERM_SUFFIXES,
    CATALOG_TIMEOUT_S,
)


@dataclass
class Document:
    """One indexable unit of text about one course. Every source normalizes to this.

    doc_key must be stable across runs (e.g. "catalog:6.3900"), so re-ingesting
    updates rows in place instead of duplicating them.
    """
    doc_key: str
    course_id: str
    source_type: str
    text: str
    title: str = ""
    metadata: dict = field(default_factory=dict)


class Source(ABC):
    """Fetch records from somewhere and normalize them to Documents.

    Adding a source = subclass this and register it in SOURCES below. Nothing in
    retrieval/ needs to change: filtering works on source_type and on any key
    the source puts in Document.metadata.
    """
    source_type: str

    @abstractmethod
    def fetch(self, refresh: bool = False) -> Iterable[Document]:
        ...


class CachedHttpClient:
    """GET JSON with a disk cache, a client-side throttle, and retries on
    429/5xx/connection errors (honoring Retry-After). Auth is supplied by the
    caller as a function returning headers, so no secret ever reaches the cache
    key, the cache files, or a log line."""

    RETRY_STATUSES = {429, 500, 502, 503, 504}

    def __init__(self, base_url, auth_headers, cache_dir, timeout=CATALOG_TIMEOUT_S,
                 max_retries=CATALOG_MAX_RETRIES, min_interval=CATALOG_MIN_INTERVAL_S,
                 on_unauthorized=None):
        self.base_url = base_url
        self.auth_headers = auth_headers
        self.on_unauthorized = on_unauthorized
        self.cache_dir = Path(cache_dir)
        self.timeout = timeout
        self.max_retries = max_retries
        self.min_interval = min_interval
        self.session = requests.Session()
        self._last_request = 0.0

    def _cache_path(self, path, params):
        key = json.dumps([path, sorted((params or {}).items())], default=str)
        return self.cache_dir / f"{hashlib.sha256(key.encode()).hexdigest()[:24]}.json"

    def get_json(self, path, params=None, refresh=False):
        cache_path = self._cache_path(path, params)
        if not refresh and cache_path.exists():
            return json.loads(cache_path.read_text())["body"]

        body = self._request(path, params)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"path": path, "params": params, "body": body}))
        return body

    def _request(self, path, params):
        url = urljoin(self.base_url, path)
        reauthed = False
        for attempt in range(self.max_retries + 1):
            wait = self.min_interval - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()

            try:
                resp = self.session.get(url, params=params, headers=self.auth_headers(), timeout=self.timeout)
            except (requests.ConnectionError, requests.Timeout) as e:
                if attempt == self.max_retries:
                    raise
                self._backoff(attempt, None, f"{type(e).__name__}")
                continue

            if resp.status_code == 401 and self.on_unauthorized and not reauthed:
                self.on_unauthorized()     # e.g. expired OAuth token: fetch a new one, retry once
                reauthed = True
                continue
            if resp.status_code in self.RETRY_STATUSES and attempt < self.max_retries:
                self._backoff(attempt, resp.headers.get("Retry-After"), f"HTTP {resp.status_code}")
                continue
            resp.raise_for_status()
            return resp.json()
        raise RuntimeError(f"unreachable: retries exhausted for {path}")

    @staticmethod
    def _backoff(attempt, retry_after, reason):
        try:
            delay = float(retry_after)
        except (TypeError, ValueError):
            delay = CATALOG_BACKOFF_BASE_S * (2 ** attempt) + random.uniform(0, 0.5)
        print(f"  {reason}; retrying in {delay:.1f}s", file=sys.stderr)
        time.sleep(delay)


class CatalogSource(Source):
    """MIT Course Catalog API. One Document per subject, source_type "catalog".

    What the API looks like (explored 2026-10-18, dev):
      - Auth: HTTP basic with the client id/secret.
      - GET terms/{termCode}/subjects?dept={dept} -> {"metadata": {"size": N}, "items": [...]}
        All of a department's subjects in one response; no pagination. `dept`
        is required; there is no "all departments" value and no route that
        lists departments.
      - termCode is MIT academic-year style: 2027FA = Fall 2026, 2027SP = Spring 2027.
      - Every term returns the SAME subject list (the academic year's catalog);
        only `offered`, `instructors`, `instructorDetails` vary by term.
      - Item fields: termCode, subjectId, academicYear, title, cluster,
        prerequisites, units, optional, description, offered, instructors,
        instructorDetails. No undergrad/grad level field.

    Departments are discovered by crawling: start from CATALOG_SEED_DEPARTMENTS
    and add any department prefix referenced by a subject id in prerequisites
    or cross-listing notes, until no new ones turn up.

    Normalized metadata: department, units, units_total, grading, prereqs,
    terms (list of term codes where offered), instructors ({term: names}),
    cross_listing, notes, academic_year.
    """
    source_type = "catalog"

    _SUBJECT_REF = re.compile(r"\b([0-9]{1,2}[A-Z]?|[A-Z]{2,4})\.(?=[0-9A-Z]*\d)[0-9A-Z]{2,6}\b")
    _UNITS = re.compile(r"^(\d+)-(\d+)-(\d+)")

    def __init__(self, base_url=CATALOG_BASE_URL, cache_dir=CACHE_DIR / "catalog",
                 academic_year=CATALOG_ACADEMIC_YEAR, departments=None):
        if not (CATALOG_CLIENT_ID and CATALOG_CLIENT_SECRET):
            raise RuntimeError("MIT_CATALOG_CLIENT_ID / MIT_CATALOG_CLIENT_SECRET not set; see .env.example")
        token = base64.b64encode(f"{CATALOG_CLIENT_ID}:{CATALOG_CLIENT_SECRET}".encode()).decode()
        self._auth = {"Authorization": f"Basic {token}"}
        self.client = CachedHttpClient(base_url, lambda: self._auth, cache_dir)
        self.terms = [f"{academic_year}{suffix}" for suffix in CATALOG_TERM_SUFFIXES]
        self.departments = departments          # None = crawl from the seed list

    def _subjects(self, term, dept, refresh):
        try:
            body = self.client.get_json(f"terms/{term}/subjects", {"dept": dept}, refresh=refresh)
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 400:
                return []                       # API rejects malformed dept codes with 400
            raise
        items = body.get("items") or []
        size = (body.get("metadata") or {}).get("size")
        if size is not None and size != len(items):
            print(f"  warning: {term} dept={dept}: metadata.size={size} but {len(items)} items", file=sys.stderr)
        return items

    def _discover_departments(self, refresh):
        seeds = self.departments or CATALOG_SEED_DEPARTMENTS
        queue, seen, found = list(seeds), set(seeds), []
        while queue:
            dept = queue.pop(0)
            items = self._subjects(self.terms[0], dept, refresh)
            if not items:
                continue
            found.append(dept)
            if self.departments:                # explicit list: don't crawl
                continue
            for item in items:
                for ref in self._SUBJECT_REF.findall(f"{item.get('prerequisites', '')} {item.get('cluster', '')}"):
                    if ref not in seen:
                        seen.add(ref)
                        queue.append(ref)
        return found

    def _iter_records(self, refresh) -> Iterator[dict]:
        """Yield one merged record per subjectId: base fields from the first term
        that lists it, plus the list of terms it's offered in and who teaches it."""
        departments = self._discover_departments(refresh)
        print(f"  catalog: {len(departments)} departments x {len(self.terms)} terms", file=sys.stderr)
        merged = {}
        for dept in departments:
            for term in self.terms:
                for item in self._subjects(term, dept, refresh):
                    record = merged.setdefault(item["subjectId"], {**item, "offered_terms": [], "term_instructors": {}})
                    if item.get("offered") and term not in record["offered_terms"]:
                        record["offered_terms"].append(term)
                        if item.get("instructors"):
                            record["term_instructors"][term] = item["instructors"].strip()
        yield from merged.values()

    def _record_to_document(self, record: dict) -> Document:
        subject_id = record["subjectId"].strip()
        units_raw = " ".join((record.get("units") or "").split())
        units_match = self._UNITS.match(units_raw)
        metadata = {
            "department": subject_id.split(".")[0],
            "units": units_raw,
            "units_total": sum(map(int, units_match.groups())) if units_match else None,
            "grading": "P/D/F" if "[P/D/F]" in units_raw else None,
            "prereqs": (record.get("prerequisites") or "").strip(),
            "terms": record["offered_terms"],
            "instructors": record["term_instructors"],
            "cross_listing": (record.get("cluster") or "").strip(),
            "notes": (record.get("optional") or "").strip(),
            "academic_year": record.get("academicYear"),
        }
        return Document(
            doc_key=f"catalog:{subject_id}",
            course_id=subject_id,
            source_type=self.source_type,
            title=(record.get("title") or "").strip(),
            text=(record.get("description") or "").strip(),
            metadata={k: v for k, v in metadata.items() if v not in (None, "", [], {})},
        )

    def fetch(self, refresh=False):
        for record in self._iter_records(refresh):
            doc = self._record_to_document(record)
            if doc.text:
                yield doc


class FingerprintSource(Source):
    """Fingerprint questions from the app tables (backend/app). One Document per
    fingerprint, holding its displayed revision; pending edits stay out of the
    index until they're approved.

    Metadata: course_id, fingerprint_id, ai_draft.
    """
    source_type = "fingerprint"

    def __init__(self, db_path=None):
        self.db_path = db_path

    @staticmethod
    def document_for(row) -> Document:
        return Document(
            doc_key=f"fingerprint:{row['course_id']}:{row['id']}",
            course_id=row["course_id"],
            source_type=FingerprintSource.source_type,
            text=row["question"],
            metadata={
                "course_id": row["course_id"],
                "fingerprint_id": row["id"],
                "ai_draft": row["editor_kind"] == "ai",
            },
        )

    def fetch(self, refresh=False):
        from index import DATABASE_PATH, connect
        conn = connect(self.db_path or DATABASE_PATH)
        try:
            rows = conn.execute("""
                SELECT f.id, f.course_id, r.question, r.editor_kind
                FROM fingerprints f JOIN fingerprint_revisions r ON r.id = f.displayed_revision_id
            """).fetchall()
        finally:
            conn.close()
        for row in rows:
            yield self.document_for(row)


class PostSource(Source):
    """Discussion posts and replies from the app tables (backend/app). Only
    published and flagged posts are indexed; held and hidden ones are not.

    Metadata never carries the author: course_id, post_id, post_kind ("post" or
    "reply"), post_type, pseudonym (the public per-course handle).
    """
    source_type = "post"
    VISIBLE_STATUSES = ("published", "flagged")

    def __init__(self, db_path=None):
        self.db_path = db_path

    @staticmethod
    def document_for(row) -> Document:
        metadata = {
            "course_id": row["course_id"],
            "post_id": row["id"],
            "post_kind": "reply" if row["parent_id"] else "post",
            "post_type": row["post_type"],
            "pseudonym": f"Anonymous {row['handle']}",
        }
        return Document(
            doc_key=f"post:{row['course_id']}:{row['id']}",
            course_id=row["course_id"],
            source_type=PostSource.source_type,
            text=row["body"],
            metadata={k: v for k, v in metadata.items() if v is not None},
        )

    def fetch(self, refresh=False):
        from index import DATABASE_PATH, connect
        conn = connect(self.db_path or DATABASE_PATH)
        try:
            rows = conn.execute(f"""
                SELECT p.id, p.course_id, p.parent_id, p.post_type, p.body, ps.handle
                FROM posts p
                JOIN pseudonyms ps ON ps.user_id = p.author_user_id AND ps.course_id = p.course_id
                WHERE p.status IN ({','.join('?' * len(self.VISIBLE_STATUSES))})
            """, self.VISIBLE_STATUSES).fetchall()
        finally:
            conn.close()
        for row in rows:
            yield self.document_for(row)


SOURCES = {
    "catalog": CatalogSource,
    "fingerprint": FingerprintSource,
    "post": PostSource,
}
