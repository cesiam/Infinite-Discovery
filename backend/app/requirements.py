"""Degree progress: how far a set of planned courses gets through a program's requirements.

Rule shapes (program_requirements.rule, written by requirements_import.py):
  {"type": "courses", "options": [["6.1010"], ["6.100A", "6.100B"]], "count": 1}
        pick `count` options; an option is met when all its subjects are planned
  {"type": "courses", "options": [...], "units": 12}
        planned options adding up to `units` (catalog units per subject)
  {"type": "attribute", "attrs": ["REST"], "half_attrs": ["REST/2"], "count": 2}
        subjects carrying a catalog GIR tag; half_attrs count as half a subject
  {"type": "prefix", "prefixes": ["14."], "count": 3}
        subjects whose number starts with a prefix (HASS concentrations, an estimate)
  {"type": "manual", "text": "...", "options": [...]}
        shown, never checked, left out of the percentage

Within one program a subject counts toward one course requirement only. Attribute and
prefix rules don't use subjects up: one HASS-H subject counts toward both "eight HASS
subjects" and "one Humanities subject", as at MIT.
"""
import json
import re

_NUMBER = re.compile(r"\b([0-9]{1,2}[A-Z]?|[A-Z]{2,4})\.[0-9A-Z]+(?=J?\b)")


def canonical(code: str) -> str:
    """'6.1200[J]' and '18.062J' -> '6.1200' and '18.062'."""
    code = code.replace("[J]", "").strip()
    return code[:-1] if code.endswith("J") and "." in code and code[-2].isdigit() else code


def course_facts(conn, ids) -> dict:
    """Units, GIR tags and cross-listed numbers for each subject id."""
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {}
    facts = {}
    for row in conn.execute(
        f"SELECT course_id, json_extract(metadata, '$.units') AS units, json_extract(metadata, '$.units_total') AS total, "
        f"json_extract(metadata, '$.cross_listing') AS cross FROM documents "
        f"WHERE source_type = 'catalog' AND course_id IN ({','.join('?' * len(ids))})", ids
    ):
        tail = re.sub(r"^\d+-\d+-\d+\s*", "", row["units"] or "")
        attrs = {t.strip() for t in re.split(r"[;,]", tail) if t.strip()}
        same = set()
        if row["cross"] and "Same subject as" in row["cross"]:
            same = {canonical(m.group(0)) for m in _NUMBER.finditer(row["cross"].split("Same subject as", 1)[1])}
        facts[row["course_id"]] = {"units": row["total"] or 0, "attrs": attrs, "same": same}
    return facts


def _evaluate_rule(rule, planned, names, facts, used, option_units):
    """-> (fraction met or None for manual, weight in subjects, courses credited)."""
    kind = rule["type"]
    if kind == "manual":
        return None, 0, []

    if kind == "attribute":
        need = rule["count"]
        credited, total = [], 0.0
        for course in planned:
            attrs = facts.get(course, {}).get("attrs", set())
            if attrs & set(rule["attrs"]):
                total += 1
            elif attrs & set(rule.get("half_attrs", [])):
                total += 0.5
            else:
                continue
            credited.append(course)
        return min(total, need) / need, need, credited

    if kind == "prefix":
        need = rule["count"]
        credited = [c for c in planned if c.startswith(tuple(rule["prefixes"]))]
        return min(len(credited), need) / need, need, credited

    # courses: an option is met when every subject in it is planned and not used elsewhere
    def match(code):
        code = canonical(code)
        return next((c for c in planned if c not in used and code in names[c]), None)

    credited, met_count, met_units = [], 0, 0
    goal_units = rule.get("units")
    for option in rule["options"]:
        if goal_units is None and met_count >= rule.get("count", 1):
            break
        if goal_units is not None and met_units >= goal_units:
            break
        hits = [match(code) for code in option]
        if all(hits) and len(set(hits)) == len(hits):
            used.update(hits)
            credited += hits
            met_count += 1
            met_units += sum(option_units(h) for h in hits)
    if goal_units is not None:
        return min(met_units, goal_units) / goal_units, goal_units / 12, credited
    need = rule.get("count", 1)
    return min(met_count, need) / need, need, credited


def program_courses(conn, program_id: str) -> list:
    """Every subject a program's requirements name, for isolating it on the graph."""
    ids = []
    for (rule,) in conn.execute("SELECT rule FROM program_requirements WHERE program_id = ?", (program_id,)):
        for option in json.loads(rule).get("options", []):
            ids += [canonical(c) for c in option]
    return list(dict.fromkeys(ids))


def evaluate(conn, program_id: str, planned: list) -> dict:
    program = conn.execute("SELECT * FROM programs WHERE id = ?", (program_id,)).fetchone()
    if program is None:
        return None
    rows = conn.execute("SELECT section, label, rule FROM program_requirements WHERE program_id = ? ORDER BY position",
                        (program_id,)).fetchall()
    facts = course_facts(conn, planned)
    names = {c: {canonical(c)} | facts.get(c, {}).get("same", set()) for c in planned}
    used: set = set()
    option_units = lambda course: facts.get(course, {}).get("units", 0)

    results, weight_total, weight_met = [], 0.0, 0.0
    for row in rows:
        rule = json.loads(row["rule"])
        fraction, weight, credited = _evaluate_rule(rule, planned, names, facts, used, option_units)
        if fraction is not None:   # every checkable requirement counts the same
            weight_total += 1
            weight_met += fraction
        results.append({
            "section": row["section"],
            "label": row["label"],
            "type": rule["type"],
            "status": "manual" if fraction is None else "done" if fraction >= 1 else "partial" if fraction > 0 else "todo",
            "fraction": None if fraction is None else round(fraction, 3),
            "credited": credited,
            "options": rule.get("options", [])[:40],
        })
    checked = [r for r in results if r["status"] != "manual"]
    return {
        "id": program["id"], "kind": program["kind"], "name": program["name"], "code": program["code"],
        "source_url": program["source_url"], "notes": program["notes"],
        "percent": round(100 * weight_met / weight_total) if weight_total else 0,
        "requirements_met": sum(r["status"] == "done" for r in checked),
        "requirements_checked": len(checked),
        "requirements_manual": len(results) - len(checked),
        "requirements": results,
    }
