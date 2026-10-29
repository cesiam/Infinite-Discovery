"""Machine-drafted fingerprints.

A fingerprint is a class objective: an open-ended question you can answer once you've
mastered the course's content, e.g. for 6.4110 "How can a POMDP be used to make
decisions when the agent cannot observe the full state?". Drafts are stored as
revisions with editor_kind='ai' until a person edits them.

ClaudeDrafter asks Claude ("AI draft"). TemplateDrafter builds questions from the
topics in the catalog description so seeding and tests work offline ("Catalog draft",
never labelled AI). AutoDrafter tries Claude and falls back to the template on any
failure. For the whole catalog at once, see app/draft_fingerprints.py (Batches API).
"""
import json
import logging
import re

log = logging.getLogger(__name__)

QUESTIONS_PER_COURSE = 3

AI_SUMMARY = "AI draft"
CATALOG_SUMMARY = "Catalog draft"

SYSTEM_PROMPT = """You write "fingerprints" for MIT courses. A fingerprint is a class \
objective written as a question: something a student can answer only after mastering the \
content of the class. For example, for 6.4110 (Representation, Inference, and Reasoning in \
AI): "How can a POMDP be used to make decisions when the agent cannot observe the full state?"

Good fingerprints:
- name the course's actual concepts, methods, or results (POMDP, eigenvalues, price ceilings),
  never generic phrases like "the central idea of this course";
- ask the student to explain how something works, when to use it, or why it holds;
- are one sentence, under 30 words, answerable without notes by someone who mastered the class.
Do not ask about logistics, grades, workload, or the instructor."""


_TOPIC_LIST = re.compile(r"topics (?:covered )?include(?:s)?\s*:?\s*|topics:\s*", re.I)


def catalog_topics(description: str, limit: int = QUESTIONS_PER_COURSE) -> list:
    """Topic phrases from a description's "Topics include A, B, and C." sentence, if it has one."""
    m = _TOPIC_LIST.search(description or "")
    if not m:
        return []
    sentence = re.split(r"\.(?:\s|$)", description[m.end():], maxsplit=1)[0]
    topics = []
    for part in re.split(r"[,;]", sentence):
        topic = re.sub(r"^(?:and|or|including|with a focus on)\s+", "", part.strip(" .:"), flags=re.I).strip()
        if 3 <= len(topic) <= 60 and topic not in topics:
            topics.append(topic)
    return topics[:limit]


class TemplateDrafter:
    """No AI: questions built from the topics the catalog description lists."""
    name = "template"
    last_source = CATALOG_SUMMARY

    def draft(self, course: dict) -> list:
        title, number = course["title"], course["course_id"]
        topics = catalog_topics(course.get("description", ""))
        shapes = [
            "How would you explain {t} to someone who hasn't taken {n}?",
            "When would you use {t} on a new problem, and what are the limits?",
            "What role does {t} play in {title}, and what does it build on?",
        ]
        questions = [shape.format(t=t, n=number, title=title) for shape, t in zip(shapes, topics)]
        generic = [
            f"What problem does {title} teach you to solve, and how would you approach it now?",
            f"Pick one method from {number}: when would you use it, and when would it mislead you?",
            f"What can you do after {number} that you couldn't do before? Give a concrete example.",
        ]
        return (questions + generic[len(questions):])[:QUESTIONS_PER_COURSE]


class ClaudeDrafter:
    name = "claude"
    last_source = AI_SUMMARY

    def __init__(self, model: str):
        import anthropic
        self._anthropic = anthropic
        self.client = anthropic.Anthropic()   # credentials from the environment / `ant auth login`
        self.model = model

    def draft(self, course: dict) -> list:
        prompt = (
            f"Course {course['course_id']}: {course['title']}\n"
            f"Prerequisites: {course.get('prereq_text') or 'none listed'}\n\n"
            f"Catalog description:\n{course.get('description', '')}\n\n"
            f"Write {QUESTIONS_PER_COURSE} fingerprints for this course."
        )
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            output_config={
                "effort": "medium",
                "format": {
                    "type": "json_schema",
                    "schema": {
                        "type": "object",
                        "properties": {"questions": {"type": "array", "items": {"type": "string"}}},
                        "required": ["questions"],
                        "additionalProperties": False,
                    },
                },
            },
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            raise RuntimeError("draft request declined")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("draft response truncated")
        text = next(block.text for block in response.content if block.type == "text")
        questions = [q.strip() for q in json.loads(text)["questions"] if q.strip()]
        if not questions:
            raise RuntimeError("draft response had no questions")
        return questions[:QUESTIONS_PER_COURSE]


class AutoDrafter:
    def __init__(self, model: str):
        self.model = model
        self.fallback = TemplateDrafter()
        self._claude = None
        self._unavailable = False   # client couldn't be built (e.g. no credentials): stop retrying
        self.name = "auto"
        self.last_source = CATALOG_SUMMARY

    def draft(self, course: dict) -> list:
        if self._unavailable:
            self.last_source = CATALOG_SUMMARY
            return self.fallback.draft(course)
        try:
            if self._claude is None:
                try:
                    self._claude = ClaudeDrafter(self.model)
                except Exception:
                    self._unavailable = True
                    raise
            questions = self._claude.draft(course)
            self.last_source = AI_SUMMARY
            return questions
        except Exception as error:   # any failure: still give the course a draft
            if isinstance(error, TypeError) or type(error).__name__ in ("AuthenticationError", "PermissionDeniedError"):
                self._unavailable = True   # no usable credentials; don't retry for every course
            # log the error type only; messages from auth failures can echo request details
            log.warning("Claude draft failed for %s (%s); using template", course["course_id"], type(error).__name__)
            self.last_source = CATALOG_SUMMARY
            return self.fallback.draft(course)


def make_drafter(settings):
    if settings.fingerprint_drafter == "template":
        return TemplateDrafter()
    return AutoDrafter(settings.fingerprint_draft_model)
