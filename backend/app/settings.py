"""API settings, read from the environment (backend/.env is loaded by
rag_hybrid's config on import). Secrets are only ever read, never logged."""
import os
from dataclasses import dataclass, field
from pathlib import Path

from app.rag import DATABASE_PATH


def cors_origins(raw: str) -> list:
    """Browsers send an origin as exactly "https://host" (no path, no trailing slash), and
    CORS only matches it exactly. Forgive the usual slips when pasting the setting:
    quotes, spaces, a trailing slash, a missing https://."""
    origins = []
    for item in raw.split(","):
        origin = item.strip().strip("'\"").strip().rstrip("/")
        if not origin:
            continue
        if "://" not in origin:
            origin = ("http://" if origin.startswith(("localhost", "127.0.0.1")) else "https://") + origin
        origins.append(origin)
    return origins



@dataclass
class Settings:
    db_path: Path = field(default_factory=lambda: Path(os.getenv("APP_DB_PATH", str(DATABASE_PATH))))
    # "dev" enables the placeholder sign-in (POST /auth/dev/login). Anything
    # else turns it off; see app/auth.py for where MIT login plugs in.
    auth_mode: str = field(default_factory=lambda: os.getenv("AUTH_MODE", "dev"))
    session_ttl_hours: int = field(default_factory=lambda: int(os.getenv("SESSION_TTL_HOURS", str(24 * 14))))
    cors_origins: list = field(default_factory=lambda: cors_origins(os.getenv("CORS_ORIGINS", "http://localhost:3000")))
    # "auto" asks Claude for fingerprint drafts and falls back to templates if
    # no credentials are configured or the call fails; "template" never calls out.
    fingerprint_drafter: str = field(default_factory=lambda: os.getenv("FINGERPRINT_DRAFTER", "auto"))
    fingerprint_draft_model: str = field(default_factory=lambda: os.getenv("FINGERPRINT_DRAFT_MODEL", "claude-opus-5-5"))
    # cosine distance (0 = same direction). Above this, a post isn't "similar". Calibrated on the
    # seeded posts with all-MiniLM-L6-v2: related drafts scored 0.36-0.67, unrelated ones 0.78+.
    similar_post_max_distance: float = field(
        default_factory=lambda: float(os.getenv("SIMILAR_POST_MAX_DISTANCE", "0.70")))
