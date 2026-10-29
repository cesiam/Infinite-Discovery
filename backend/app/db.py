from fastapi import Request

from app.rag import connect


def get_conn(request: Request):
    """One connection per request, never shared between requests. FastAPI may
    run this dependency, the endpoint and the cleanup on different worker
    threads, one after another, so sqlite3's same-thread check is turned off.
    WAL lets reads run alongside a write."""
    conn = connect(request.app.state.settings.db_path, check_same_thread=False)
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
    finally:
        conn.close()


def row_dict(row):
    return dict(row) if row is not None else None
