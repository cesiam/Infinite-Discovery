"""Moderation routes content; it never rejects or deletes it.

  publish -> visible
  flag    -> visible, and queued for an admin to look at
  hold    -> hidden until an admin publishes it

RuleModerator is a placeholder with deliberately simple rules. Anything with a
`review(text) -> Decision` method can replace it (a classifier, a Claude
call) via create_app(moderator=...).
"""
import json
import re
from dataclasses import dataclass, field
from typing import Literal

Action = Literal["publish", "flag", "hold"]


@dataclass
class Decision:
    action: Action
    reasons: list = field(default_factory=list)


class RuleModerator:
    # Personal info could de-anonymize someone (the author or a classmate): hold.
    _EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
    _PHONE = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")
    _HOLD_TERMS = re.compile(r"\b(kill yourself|kys|doxx?)\b", re.I)
    # Worth a look but not worth hiding.
    _URL = re.compile(r"https?://|www\.", re.I)
    _FLAG_TERMS = re.compile(r"\b(fuck\w*|shit\w*|idiot|stupid|useless prof\w*)\b", re.I)

    def review(self, text: str) -> Decision:
        hold, flag = [], []
        if self._EMAIL.search(text):
            hold.append("contains an email address")
        if self._PHONE.search(text):
            hold.append("contains a phone number")
        if self._HOLD_TERMS.search(text):
            hold.append("possible harassment")
        if hold:
            return Decision("hold", hold)

        if self._URL.search(text):
            flag.append("contains a link")
        if self._FLAG_TERMS.search(text):
            flag.append("strong language")
        letters = [c for c in text if c.isalpha()]
        if len(letters) >= 20 and sum(c.isupper() for c in letters) / len(letters) > 0.7:
            flag.append("mostly capitals")
        return Decision("flag", flag) if flag else Decision("publish")


POST_STATUS = {"publish": "published", "flag": "flagged", "hold": "held"}


def enqueue(conn, content_kind: str, content_id: int, decision: Decision):
    if decision.action == "publish":
        return None
    return conn.execute(
        "INSERT INTO moderation_queue (content_kind, content_id, decision, reasons) VALUES (?, ?, ?, ?)",
        (content_kind, content_id, decision.action, json.dumps(decision.reasons)),
    ).lastrowid


def resolve_open(conn, content_kind: str, content_id: int, resolution: str, admin_id: int):
    conn.execute("""
        UPDATE moderation_queue SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
        WHERE content_kind = ? AND content_id = ? AND status = 'open'
    """, (resolution, admin_id, content_kind, content_id))
