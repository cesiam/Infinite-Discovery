"""Per-course pseudonyms: anonymous to the public, verified to the system.

A user gets one random handle per course, stored in `pseudonyms`, so it stays
the same across their posts in that course. Handles are random rather than
derived from the user id, so knowing the scheme doesn't let anyone reverse
one, and a new handle never repeats one the same user holds in another
course, so their posts can't be linked across courses.
"""
import secrets
import sqlite3

HANDLE_BYTES = 2          # 4 hex chars: "a3f9"


def display(handle: str) -> str:
    return f"Anonymous {handle}"


def handle_for(conn, user_id: int, course_id: str) -> str:
    row = conn.execute("SELECT handle FROM pseudonyms WHERE user_id = ? AND course_id = ?",
                       (user_id, course_id)).fetchone()
    if row:
        return row["handle"]

    elsewhere = {r["handle"] for r in conn.execute("SELECT handle FROM pseudonyms WHERE user_id = ?", (user_id,))}
    for attempt in range(64):
        # 65,536 handles per course; widen if a course is ever that crowded
        handle = secrets.token_hex(HANDLE_BYTES if attempt < 48 else HANDLE_BYTES + 1)
        if handle in elsewhere:
            continue
        try:
            with conn:
                conn.execute("INSERT INTO pseudonyms (user_id, course_id, handle) VALUES (?, ?, ?)",
                             (user_id, course_id, handle))
            return handle
        except sqlite3.IntegrityError:
            # either the handle is taken in this course, or a concurrent request
            # just created this user's row; re-read before trying again
            row = conn.execute("SELECT handle FROM pseudonyms WHERE user_id = ? AND course_id = ?",
                               (user_id, course_id)).fetchone()
            if row:
                return row["handle"]
    raise RuntimeError("could not allocate a pseudonym")
