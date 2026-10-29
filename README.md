# Infinite Discovery

Explore MIT courses by what they teach. The frontend is in `src/` (TanStack Start + Vite). The API and the
hybrid search are in `backend/` (FastAPI + SQLite).

## Run it

Two terminals:

```bash
# 1. API on :8000 (first time: see backend/README.md for setup)
cd backend && .venv/bin/uvicorn app.server:app --reload --port 8000

# 2. Frontend on :3000
npm install
npm run dev
```

Open http://localhost:3000. MIT login isn't
connected yet. Pick any email and a role (student, professor or admin) to post, vote and edit.

To point the frontend at a different API, copy `.env.example` to `.env.local` and change `VITE_API_URL`.

## Tests

```bash
npm test                                     # frontend
cd backend && .venv/bin/python -m pytest     # API
```
