"""Import degree requirements from MIT's official pages into the programs tables.

    cd backend && .venv/bin/python -m app.requirements_import            # use the page cache
    cd backend && .venv/bin/python -m app.requirements_import --refresh  # re-download

Sources:
  majors          catalog.mit.edu/degree-charts/<program>/  (undergraduate degree charts)
  minors          catalog.mit.edu minors index -> interdisciplinary minor pages and the
                  "Minor in X" sections of department pages
  concentrations  registrar.mit.edu HASS Concentrations list (fields only: the subjects
                  are chosen with a concentration advisor, so these are approximate)
  GIRs            catalog.mit.edu General Institute Requirements, checked against the GIR
                  tags the catalog puts on each subject (CALC I, REST, HASS-H, CI-H, ...)

Degree charts are tables (sc_courselist). Rows become requirements:
  "Select N of the following:" + indented rows -> choose N options (or N units)
  a plain subject row (with "or ..." rows)     -> one of these subjects
  "A & B" in one row                           -> an option needing both subjects
  any other text row                           -> a manual requirement, shown but not checked
Raw pages are cached in rag_hybrid/data/cache/requirements/.
"""
import argparse
import hashlib
import html
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests

from app.rag import DATABASE_PATH, connect, migrate

CATALOG = "https://catalog.mit.edu"
CONCENTRATIONS_URL = "https://registrar.mit.edu/registration-academics/academic-requirements/hass-requirement/hass-concentrations"
GIR_URL = f"{CATALOG}/mit/undergraduate-education/general-institute-requirements/"
CACHE_DIR = Path(DATABASE_PATH).parent / "cache" / "requirements"
USER_AGENT = "InfiniteDiscovery/0.1 (MIT UROP course explorer; degree-requirements import)"
MIN_INTERVAL_S = 0.5

_last_fetch = 0.0


def fetch(url: str, refresh: bool = False) -> str:
    """GET a page with a disk cache and a polite delay between requests."""
    global _last_fetch
    path = CACHE_DIR / f"{hashlib.sha256(url.encode()).hexdigest()[:20]}.html"
    if path.exists() and not refresh:
        return path.read_text()
    wait = MIN_INTERVAL_S - (time.monotonic() - _last_fetch)
    if wait > 0:
        time.sleep(wait)
    _last_fetch = time.monotonic()
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(resp.text)
    return resp.text


def text(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def strip_footnotes(label: str) -> str:
    return re.sub(r"(\s+\d+)+$", "", label).strip()


# ---- degree-chart tables ----

_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve".split())}
_SELECT_UNITS = re.compile(r"\b(?:select|choose|complete)\b.*?\b(\d+)(?:\s*-\s*\d+)?\s+units\b", re.I)
_SELECT_COUNT = re.compile(r"\b(?:select|choose|complete)\b\s+(?:at least\s+|any\s+|up to\s+)?(\w+)\b(?!\s+units)", re.I)
_CODE = re.compile(r'\?P=([^"&]+)"')


def _need(label: str):
    m = _SELECT_UNITS.search(label)
    if m:
        return {"units": int(m.group(1))}
    m = _SELECT_COUNT.search(label)
    if m:
        word = m.group(1).lower()
        if word.isdigit():
            return {"count": int(word)}
        if word in _WORDS:
            return {"count": _WORDS[word]}
        if word in ("a", "an"):
            return {"count": 1}
    return None


def parse_courselist(table_html: str, skip_sections=("general institute requirements",)) -> list:
    """One sc_courselist table -> [{section, label, rule}]."""
    reqs, section, group = [], "", None

    def close():
        nonlocal group
        if group is not None:
            rule = group["rule"]
            if not rule["options"] or not ("count" in rule or "units" in rule):
                # "Select two subjects from a track" (no list), or a heading we can't turn into a
                # number ("12 units from each branch"): shown with its options, checked by hand
                group["rule"] = {"type": "manual", "text": group["label"], "options": rule["options"]}
            reqs.append(group)
            group = None

    for cls, row in re.findall(r'<tr[^>]*class="([^"]*)"[^>]*>(.*?)</tr>', table_html, re.S):
        if "listsum" in cls:
            continue
        label = strip_footnotes(text(row.split('<td class="hourscol')[0]))
        if "areaheader" in cls or "areaheader" in row:
            close()
            section = label
            continue
        if section.lower() in skip_sections or not label:
            continue
        codes = [html.unescape(c) for c in _CODE.findall(row)]
        if "orclass" in cls:
            target = group if group is not None else (reqs[-1] if reqs else None)
            if target and codes and target["rule"]["type"] == "courses":
                target["rule"]["options"].append(codes)
                if target is not group:
                    target["label"] += f" or {codes[0]}"
            continue
        if not codes:   # a comment row opens a group; the indented rows under it are its options
            close()
            group = {"section": section, "label": label.rstrip(":"),
                     "rule": {"type": "courses", "options": [], **(_need(label) or {})}}
            continue
        indented = "margin-left" in row.split("</td>")[0]
        if group is None and indented:
            # options listed straight under a section heading ("Choose one subject from each
            # of the areas:" then "Linear Algebra" with 18.06, 18.700, ...): one of them
            group = {"section": section, "label": f"One of: {section}",
                     "rule": {"type": "courses", "options": [], "count": 1}}
        if group is not None and indented:
            group["rule"]["options"].append(codes)
            continue
        close()
        reqs.append({"section": section, "label": label, "rule": {"type": "courses", "options": [codes], "count": 1}})
    close()
    for req in reqs:   # tidy labels: "6.1010 Fundamentals of Programming"
        req["label"] = re.sub(r"\s+", " ", req["label"]).strip()
    return reqs


def tables(page: str) -> list:
    return re.findall(r'<table class="sc_courselist.*?</table>', page, re.S)


def parse_tables(page: str) -> list:
    """All of a page's course-list tables. A table that is only a list of subjects (no
    headings, no "Select ..." rows) spells out the options of the requirement before it,
    as in "Select four elective subjects in economics" followed by the elective list."""
    reqs = []
    for table in tables(page):
        if "areaheader" not in table and "courselistcomment" not in table:
            options = [[html.unescape(c) for c in _CODE.findall(row)]
                       for row in re.findall(r"<tr.*?</tr>", table, re.S) if _CODE.search(row)]
            target = next((r for r in reversed(reqs) if r["rule"]["type"] == "manual" and not r["rule"].get("options")), None)
            if target is not None and options:
                need = _need(target["label"])
                target["rule"] = ({"type": "courses", "options": options, **need} if need
                                  else {"type": "manual", "text": target["label"], "options": options})
                continue
        reqs += parse_courselist(table)
    return reqs


def page_title(page: str) -> str:
    m = re.search(r'<h1[^>]*class="page-title"[^>]*>(.*?)</h1>', page, re.S) or re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    return text(m.group(1)) if m else ""


# ---- majors ----

def import_majors(refresh):
    index = fetch(f"{CATALOG}/degree-charts/", refresh)
    slugs = sorted(set(re.findall(r'href="/degree-charts/([a-z0-9-]+)/"', index)))
    graduate = ("master-", "phd-", "mba-", "interdisciplinary-doctoral")
    programs = []
    for slug in slugs:
        if slug.startswith(graduate):
            continue
        url = f"{CATALOG}/degree-charts/{slug}/"
        page = fetch(url, refresh)
        name = page_title(page)
        m = re.search(r"(?:course-)?(\d+[a-z]?(?:-[0-9a-z]+)*)$", slug)  # "...-course-6-3", "...-6-9"
        code = m.group(1).upper() if m else ""
        reqs = parse_tables(page)
        programs.append({"id": f"major:{slug}", "kind": "major", "name": name, "code": code,
                         "source_url": url, "requirements": reqs})
    return programs


# ---- minors ----

def import_minors(refresh):
    index_url = f"{CATALOG}/mit/undergraduate-education/academic-programs/minors/"
    index = fetch(index_url, refresh)
    links = re.findall(r'<a href="(/(?:interdisciplinary|schools)/[^"#]+)(#[^"]*)?"[^>]*>([^<]+)</a>', index)
    programs, seen = [], set()
    for path, anchor, raw_name in links:
        name = html.unescape(raw_name).replace("\u200b", "").strip()
        # real entries are an interdisciplinary minor's page or a department's undergraduate section;
        # everything else on the page is site navigation
        is_minor_link = re.search(r"/minors/[^/]+/$", path) or (anchor or "").startswith("#undergraduate")
        if not name or not is_minor_link or name in seen:
            continue
        seen.add(name)
        url = urljoin(CATALOG, path)
        page = fetch(url, refresh)
        notes, reqs = "", []
        if "/minors/" in path:                       # an interdisciplinary minor's own page
            reqs = parse_tables(page)
        else:                                        # a "Minor in X" section of a department page
            section = _minor_section(page, name)
            if section is None:
                notes = "The catalog describes this minor in prose; check the department page."
            else:
                reqs = parse_tables(section)
                if not reqs:
                    notes = "The catalog describes this minor in prose; check the department page."
                    prose = text(section)[:600]
                    reqs = [{"section": "", "label": prose, "rule": {"type": "manual", "text": prose}}]
        programs.append({"id": f"minor:{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}",
                         "kind": "minor", "name": f"Minor in {name}", "code": "", "source_url": url,
                         "notes": notes, "requirements": reqs})
    return programs


def _minor_section(page: str, name: str):
    """The HTML between a department page's "Minor in <name>" heading and the next heading."""
    headings = [(m, text(m.group(1)).lower()) for m in re.finditer(r"<h[2-4][^>]*>(.*?)</h[2-4]>", page, re.S)]
    wanted = f"minor in {name.lower()}"
    # exact heading first, so "Music" doesn't pick up "Minor in Music Technology"
    match = next((m for m, h in headings if h == wanted), None) or next(
        (m for m, h in headings if h.startswith(wanted)), None)
    if match is None:
        return None
    end = re.search(r"<h[2-4][^>]*>", page[match.end():])
    return page[match.end(): match.end() + end.start()] if end else page[match.end():]


# ---- HASS concentrations ----

# Subject-number prefixes for fields with an obvious home department, checked against the
# catalog (21G.1xx is Chinese, 21G.3xx French, ...). Fields not listed here are interdisciplinary:
# their subjects are approved case by case, so the app shows them without a check.
CONCENTRATION_PREFIXES = {
    "Anthropology": ["21A."], "Comparative Media Studies": ["CMS."], "Economics": ["14."],
    "History": ["21H."], "Linguistics": ["24.9"], "Literature": ["21L."], "Music": ["21M."],
    "Philosophy": ["24.0", "24.1", "24.2"], "Political Science": ["17."], "Theater Arts": ["21T."],
    "Science, Technology, and Society (STS)": ["STS."], "Women's and Gender Studies": ["WGS."],
    "Writing": ["21W."], "Urban Studies": ["11."], "Art, Culture, and Technology": ["4.3"],
    "Chinese": ["21G.1"], "French": ["21G.3"], "German": ["21G.4"], "Japanese": ["21G.5"],
    "Russian": ["21G.6"], "Spanish": ["21G.7"], "Portuguese": ["21G.8"], "Korean": ["21G.9"],
}


def import_concentrations(refresh):
    page = fetch(CONCENTRATIONS_URL, refresh)
    listing = page.split("HASS Concentrations at MIT", 1)[-1]
    listing = listing[: listing.find("<h", 10)] if "<h" in listing[10:] else listing
    programs = []
    for href, raw_name in re.findall(r'<a href="([^"]+)"[^>]*>([^<]+)</a>', listing):
        name = html.unescape(raw_name).strip()
        prefixes = CONCENTRATION_PREFIXES.get(name)
        rule = ({"type": "prefix", "prefixes": prefixes, "count": 3} if prefixes
                else {"type": "manual", "text": "Subjects are chosen with your concentration advisor."})
        programs.append({
            "id": f"concentration:{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}",
            "kind": "concentration", "name": f"HASS Concentration: {name}", "code": "",
            "source_url": urljoin("https:", href) if href.startswith("//") else href,
            "notes": "3 or 4 subjects depending on the field, approved by your concentration advisor "
                     "on the HASS Concentration Form. Progress here is an estimate.",
            "requirements": [{"section": "Concentration", "label": f"Subjects in {name}", "rule": rule}],
        })
    return programs


# ---- GIRs ----

def gir_program(refresh):
    fetch(GIR_URL, refresh)   # cached as the source of record for the rules below
    attr = lambda label, attrs, count, half=(): {
        "section": "", "label": label, "rule": {"type": "attribute", "attrs": list(attrs), "half_attrs": list(half), "count": count}}
    reqs = [
        {**attr("Calculus I", ["CALC I"], 1), "section": "Science core"},
        {**attr("Calculus II", ["CALC II"], 1), "section": "Science core"},
        {**attr("Physics I", ["PHYSICS I"], 1), "section": "Science core"},
        {**attr("Physics II", ["PHYSICS II"], 1), "section": "Science core"},
        {**attr("Chemistry", ["CHEMISTRY"], 1), "section": "Science core"},
        {**attr("Biology", ["BIOLOGY"], 1), "section": "Science core"},
        {**attr("Two REST subjects", ["REST"], 2, ["REST/2"]), "section": "REST and Lab"},
        {**attr("Institute Lab (12 units)", ["Institute LAB"], 1, ["Partial Lab"]), "section": "REST and Lab"},
        {**attr("Eight HASS subjects", ["HASS-H", "HASS-A", "HASS-S", "HASS-E"], 8), "section": "HASS"},
        {**attr("One HASS Humanities (HASS-H)", ["HASS-H"], 1), "section": "HASS"},
        {**attr("One HASS Arts (HASS-A)", ["HASS-A"], 1), "section": "HASS"},
        {**attr("One HASS Social Sciences (HASS-S)", ["HASS-S"], 1), "section": "HASS"},
        {**attr("Two Communication-intensive HASS (CI-H/CI-HW)", ["CI-H", "CI-HW"], 2), "section": "Communication"},
        {"section": "Communication", "label": "Two CI-M subjects in your major",
         "rule": {"type": "manual", "text": "Your degree chart marks which subjects are CI-M."}},
        {"section": "Physical Education", "label": "Swim test and four PE classes",
         "rule": {"type": "manual", "text": "Tracked by DAPER, not by subjects."}},
    ]
    return {"id": "gir", "kind": "gir", "name": "General Institute Requirements", "code": "GIR",
            "source_url": GIR_URL, "notes": "Checked with the GIR tags the catalog puts on each subject.",
            "requirements": reqs}


# ---- store ----

def store(conn, programs):
    """Replace every imported program: this is derived data, rebuilt from the official pages."""
    with conn:
        conn.execute("DELETE FROM program_requirements")
        conn.execute("DELETE FROM programs")
        for p in programs:
            conn.execute("INSERT INTO programs (id, kind, name, code, source_url, notes) VALUES (?, ?, ?, ?, ?, ?)",
                         (p["id"], p["kind"], p["name"], p.get("code", ""), p["source_url"], p.get("notes", "")))
            conn.executemany(
                "INSERT INTO program_requirements (program_id, position, section, label, rule) VALUES (?, ?, ?, ?, ?)",
                [(p["id"], i, r["section"], r["label"][:500], json.dumps(r["rule"])) for i, r in enumerate(p["requirements"])])


def main():
    parser = argparse.ArgumentParser(description="Import MIT degree requirements from the official catalog.")
    parser.add_argument("--refresh", action="store_true", help="re-download pages instead of using the cache")
    parser.add_argument("--db", default=str(DATABASE_PATH))
    args = parser.parse_args()

    conn = migrate(connect(args.db))
    programs = [gir_program(args.refresh)]
    for label, importer in (("majors", import_majors), ("minors", import_minors), ("concentrations", import_concentrations)):
        found = importer(args.refresh)
        print(f"  {label}: {len(found)}", file=sys.stderr)
        programs += found
    store(conn, programs)
    tracked = sum(r["rule"]["type"] != "manual" for p in programs for r in p["requirements"])
    total = sum(len(p["requirements"]) for p in programs)
    print(f"Imported {len(programs)} programs, {total} requirements ({tracked} checked automatically).")
    conn.close()


if __name__ == "__main__":
    main()
