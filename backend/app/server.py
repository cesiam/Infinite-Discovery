"""The served app, against the real catalog DB:

    cd backend && .venv/bin/uvicorn app.server:app --reload --port 8000
"""
from app.main import create_app

app = create_app()
