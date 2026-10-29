"""Degree-chart parsing and progress against a plan."""
import json

from app.rag import connect
from app.requirements_import import parse_courselist, parse_tables

ROW = '<tr class="{cls}"><td class="codecol">{indent}<a href="/search/?P={code}" title="{code}">{code}</a>{close}</td><td>{title}</td><td class="hourscol">{units}</td></tr>'


def course(code, title="T", units="12", cls="odd", indented=False):
    return ROW.format(cls=cls, indent='<div style="margin-left: 20px;">' if indented else "",
                      close="</div>" if indented else "", code=code, title=title, units="" if indented else units)


def comment(text, cls="even"):
    return f'<tr class="{cls}"><td colspan="2"><span class="courselistcomment">{text}</span></td><td class="hourscol"></td></tr>'


def header(text):
    return f'<tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">{text}</span></td><td class="hourscol">12</td></tr>'


def table(*rows):
    return '<table class="sc_courselist">' + "".join(rows) + "</table>"


def test_parses_required_alternatives_groups_and_pairs():
    reqs = parse_courselist(table(
        header("Departmental Requirements"),
        comment("<i>Select 12 units of the following:</i>"),
        course("6.1000", indented=True),
        '<tr class="even"><td class="codecol"><div style="margin-left: 20px;"><a href="/search/?P=6.100A">6.100A</a>'
        ' &amp; <a href="/search/?P=6.100B">6.100B</a></div></td><td>Pair</td><td class="hourscol"></td></tr>',
        course("6.1010", "Fundamentals of Programming"),
        '<tr class="orclass even"><td class="codecol orclass">or <a href="/search/?P=6.1220">6.1220</a></td><td colspan="2">Algs</td></tr>',
        comment("Select two subjects from a Computer Science track"),
    ))
    assert [r["rule"]["type"] for r in reqs] == ["courses", "courses", "manual"]
    assert reqs[0]["rule"] == {"type": "courses", "options": [["6.1000"], ["6.100A", "6.100B"]], "units": 12}
    assert reqs[1]["rule"]["options"] == [["6.1010"], ["6.1220"]] and reqs[1]["rule"]["count"] == 1
    assert reqs[1]["label"].startswith("6.1010 Fundamentals of Programming or 6.1220")


def test_indented_options_under_a_section_heading_are_one_of():
    reqs = parse_courselist(table(header("Linear Algebra"), course("18.06", indented=True), course("18.700", indented=True)))
    assert reqs == [{"section": "Linear Algebra", "label": "One of: Linear Algebra",
                     "rule": {"type": "courses", "options": [["18.06"], ["18.700"]], "count": 1}}]


def test_unparseable_heading_keeps_its_options_out_of_the_required_list():
    reqs = parse_courselist(table(header("Breadth"), comment("Select 36 units, with 12 units from each branch"),
                                  comment("History/Culture"), course("21M.120", indented=True)))
    assert all(r["rule"]["type"] == "manual" for r in reqs)
    assert reqs[-1]["rule"]["options"] == [["21M.120"]]


def test_a_list_only_table_fills_in_the_requirement_before_it():
    page = table(header("Restricted Electives"), comment("Select four elective subjects in economics")) + table(
        course("14.03"), course("14.06"), course("14.11"), course("14.12"))
    reqs = parse_tables(page)
    assert reqs[-1]["rule"] == {"type": "courses", "options": [["14.03"], ["14.06"], ["14.11"], ["14.12"]], "count": 4}


def _add_program(db_path, pid, kind, reqs):
    conn = connect(db_path)
    with conn:
        conn.execute("INSERT INTO programs (id, kind, name, source_url) VALUES (?, ?, ?, 'https://catalog.mit.edu/')",
                     (pid, kind, pid))
        conn.executemany("INSERT INTO program_requirements (program_id, position, section, label, rule) VALUES (?, ?, '', ?, ?)",
                         [(pid, i, label, json.dumps(rule)) for i, (label, rule) in enumerate(reqs)])
    conn.close()


def test_progress_counts_each_course_once_and_skips_manual(client, db_path):
    _add_program(db_path, "major:test", "major", [
        ("Intro", {"type": "courses", "options": [["6.100A"], ["6.1200"]], "count": 1}),
        ("Algorithms", {"type": "courses", "options": [["6.1210"], ["6.100A"]], "count": 1}),
        ("Two of", {"type": "courses", "options": [["18.06"], ["18.03"], ["14.01"]], "count": 2}),
        ("Track", {"type": "manual", "text": "Two subjects from a track"}),
    ])
    body = client.post("/requirements/progress", json={"programs": ["major:test"], "courses": ["6.100A", "18.06"]}).json()
    program = body["programs"][0]
    statuses = [r["status"] for r in program["requirements"]]
    # 6.100A is used by "Intro" and can't also satisfy "Algorithms"
    assert statuses == ["done", "todo", "partial", "manual"]
    assert program["requirements"][0]["credited"] == ["6.100A"]
    # each checked requirement counts the same: done (1) + todo (0) + half of "two of" (0.5)
    assert program["percent"] == round(100 * (1 + 0 + 0.5) / 3)
    assert program["requirements_manual"] == 1


def test_progress_units_rules(client, db_path):
    # the test catalog gives every course 12 units
    _add_program(db_path, "minor:test", "minor", [
        ("24 units of", {"type": "courses", "options": [["6.1200"], ["18.03"], ["14.01"]], "units": 24}),
    ])
    half = client.post("/requirements/progress", json={"programs": ["minor:test"], "courses": ["18.03"]}).json()
    assert half["programs"][0]["requirements"][0]["fraction"] == 0.5
    full = client.post("/requirements/progress", json={"programs": ["minor:test"], "courses": ["18.03", "14.01"]}).json()
    assert full["programs"][0]["percent"] == 100


def test_unknown_program_is_404(client):
    assert client.post("/requirements/progress", json={"programs": ["major:nope"], "courses": []}).status_code == 404


def test_program_listing(client, db_path):
    _add_program(db_path, "minor:economics", "minor", [("x", {"type": "manual", "text": "x"})])
    programs = client.get("/programs", params={"kind": "minor"}).json()["programs"]
    assert programs[0]["id"] == "minor:economics" and programs[0]["requirements"] == 1 and programs[0]["checked"] == 0


def test_major_minor_overlap_is_flagged_and_two_minor_limit(client, db_path):
    _add_program(db_path, "major:m", "major", [("A", {"type": "courses", "options": [["14.01"]], "count": 1})])
    for pid in ("minor:a", "minor:b", "minor:c"):
        _add_program(db_path, pid, "minor", [("A", {"type": "courses", "options": [["14.01"], ["18.06"]], "count": 2})])
    body = client.post("/requirements/progress", json={"programs": ["major:m", "minor:a"], "courses": ["14.01", "18.06"]}).json()
    minor = body["programs"][1]
    assert minor["percent"] == 100 and minor["overlap"] == ["14.01"] and "Committee on Curricula" in minor["overlap_note"]
    assert body["warnings"] == []
    three = client.post("/requirements/progress", json={"programs": ["minor:a", "minor:b", "minor:c"], "courses": []}).json()
    assert three["warnings"] == ["MIT allows at most two minors."]


def test_program_detail_lists_its_courses(client, db_path):
    _add_program(db_path, "major:x", "major", [
        ("A", {"type": "courses", "options": [["6.1200[J]"], ["6.100A", "6.100B"]], "count": 1}),
        ("B", {"type": "manual", "text": "x", "options": [["18.06"]]}),
    ])
    body = client.get("/programs/major:x").json()
    assert body["courses"] == ["6.1200", "6.100A", "6.100B", "18.06"]
    assert client.get("/programs/major:nope").status_code == 404
