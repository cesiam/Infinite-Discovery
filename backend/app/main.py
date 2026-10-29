"""Infinite Discovery API. The app factory; app/server.py builds the real one."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app import auth
from app.drafts import make_drafter
from app.moderation import RuleModerator
from app.prereqs import ensure_catalog_prereqs
from app.rag import connect, default_embed, migrate
from app.routers import admin, courses, discussion, fingerprints, graph, plans, requirements
from app.settings import Settings


def create_app(settings: Settings | None = None, embed_fn=None, drafter=None, moderator=None) -> FastAPI:
    """embed_fn, drafter and moderator are swappable so tests run offline."""
    settings = settings or Settings()
    conn = migrate(connect(settings.db_path))
    try:
        ensure_catalog_prereqs(conn)
    finally:
        conn.close()

    app = FastAPI(title="Infinite Discovery API", version="0.1.0")
    app.state.settings = settings
    app.state.embed_fn = embed_fn or default_embed
    app.state.drafter = drafter or make_drafter(settings)
    app.state.moderator = moderator or RuleModerator()

    # the full catalog graph is ~1 MB of JSON; compressed it's a fraction of that
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])
    for router in (auth.router, courses.router, fingerprints.router, discussion.router, graph.router,
                   requirements.router, plans.router, admin.router):
        app.include_router(router)

    @app.get("/health")
    def health():
        return {"ok": True}

    return app

