"""Draft class-objective fingerprints in bulk, replacing machine drafts nobody has edited.

    cd backend
    .venv/bin/python -m app.draft_fingerprints --from-file app/data/fingerprint_drafts.json
    .venv/bin/python -m app.draft_fingerprints --batch                 # whole catalog via Claude
    .venv/bin/python -m app.draft_fingerprints --batch --courses 6.4110 18.06

--batch sends one request per course through the Message Batches API (half price, usually
done within an hour) and needs Anthropic credentials (ANTHROPIC_API_KEY in backend/.env, or
an `ant auth login` profile). Fingerprints a person has edited are never touched;
new text is appended as a revision, so the history keeps the old draft.
"""
import argparse
import json
import sys
import time

from app.catalog import get_course
from app.drafts import AI_SUMMARY, QUESTIONS_PER_COURSE, SYSTEM_PROMPT
from app.indexing import reindex_fingerprint
from app.rag import DATABASE_PATH, connect, default_embed, migrate
from app.routers.fingerprints import _insert_revision, create_fingerprint
from app.settings import Settings

SCHEMA = {
    "type": "object",
    "properties": {"questions": {"type": "array", "items": {"type": "string"}}},
    "required": ["questions"],
    "additionalProperties": False,
}


def human_edited(conn, fingerprint_id) -> bool:
    return conn.execute("SELECT 1 FROM fingerprint_revisions WHERE fingerprint_id = ? AND editor_kind = 'human' LIMIT 1",
                        (fingerprint_id,)).fetchone() is not None


def apply_drafts(conn, course_id, questions, summary=AI_SUMMARY, embed_fn=default_embed) -> bool:
    """Put these drafts on the course. Fingerprints a person has edited are left alone;
    machine-only ones get a new revision (the old text stays in their history), and new
    fingerprints are added until the course has as many as there are drafts."""
    existing = conn.execute("SELECT * FROM fingerprints WHERE course_id = ? ORDER BY id", (course_id,)).fetchall()
    machine = [fp for fp in existing if not human_edited(conn, fp["id"])]
    total = len(existing)
    touched = []
    for i, question in enumerate(questions):
        if i < len(machine):
            fp = machine[i]
            shown = conn.execute("SELECT question FROM fingerprint_revisions WHERE id = ?",
                                 (fp["displayed_revision_id"],)).fetchone()
            if shown and shown["question"] == question:   # already says this; re-runs add nothing
                continue
            with conn:
                rev = _insert_revision(conn, fp["id"], question, None, parent=fp["latest_revision_id"], summary=summary)
                conn.execute("UPDATE fingerprints SET latest_revision_id = ?, displayed_revision_id = ?, "
                             "updated_at = CURRENT_TIMESTAMP WHERE id = ?", (rev, rev, fp["id"]))
            touched.append(fp["id"])
        elif total < len(questions):
            touched.append(create_fingerprint(conn, course_id, question, summary=summary))
            total += 1
    for fp_id in touched:
        reindex_fingerprint(conn, fp_id, embed_fn)
    return bool(touched)


def from_file(conn, path):
    drafts = {k: v for k, v in json.load(open(path)).items() if not k.startswith("_")}
    done = sum(apply_drafts(conn, course_id, questions) for course_id, questions in drafts.items()
               if get_course(conn, course_id))
    print(f"Applied drafts to {done} of {len(drafts)} courses (fingerprints people edited are left alone).")


def batch(conn, course_ids, model):
    import anthropic
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    client = anthropic.Anthropic()
    requests, wanted = [], []
    for course_id in course_ids:
        course = get_course(conn, course_id)
        if not course or not course["description"]:
            continue
        wanted.append(course_id)
        prompt = (f"Course {course_id}: {course['title']}\nPrerequisites: {course['prereq_text'] or 'none listed'}\n\n"
                  f"Catalog description:\n{course['description']}\n\n"
                  f"Write {QUESTIONS_PER_COURSE} fingerprints for this course.")
        requests.append(Request(
            custom_id=course_id.replace(".", "_"),
            params=MessageCreateParamsNonStreaming(
                model=model, max_tokens=4000,
                # the shared system prompt is cached across the whole batch
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            ),
        ))
    if not requests:
        print("Nothing to draft.")
        return
    created = client.messages.batches.create(requests=requests)
    print(f"Batch {created.id}: {len(requests)} courses. Waiting (usually under an hour)...", file=sys.stderr)
    while True:
        status = client.messages.batches.retrieve(created.id)
        if status.processing_status == "ended":
            break
        print(f"  {status.request_counts.processing} still processing", file=sys.stderr)
        time.sleep(60)

    by_custom = {c.replace(".", "_"): c for c in wanted}
    applied = failed = 0
    for result in client.messages.batches.results(created.id):
        course_id = by_custom.get(result.custom_id)
        message = result.result.message if result.result.type == "succeeded" else None
        if message is None or message.stop_reason in ("refusal", "max_tokens"):
            failed += 1
            continue
        text = next((b.text for b in message.content if b.type == "text"), "")
        questions = [q.strip() for q in json.loads(text).get("questions", []) if q.strip()][:QUESTIONS_PER_COURSE]
        applied += bool(questions) and apply_drafts(conn, course_id, questions)
    print(f"Applied AI drafts to {applied} courses; {failed} failed (rerun to retry those).")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--from-file")
    parser.add_argument("--batch", action="store_true")
    parser.add_argument("--courses", nargs="*")
    parser.add_argument("--db", default=str(DATABASE_PATH))
    args = parser.parse_args()
    conn = migrate(connect(args.db))
    if args.from_file:
        from_file(conn, args.from_file)
    if args.batch:
        ids = args.courses or [r[0] for r in conn.execute(
            "SELECT course_id FROM documents WHERE source_type = 'catalog' ORDER BY course_id")]
        batch(conn, ids, Settings().fingerprint_draft_model)
    conn.close()


if __name__ == "__main__":
    main()
