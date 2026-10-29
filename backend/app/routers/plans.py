"""Saved plans: several per signed-in user, like CourseRoad's roads.

The plan body is the frontend's own JSON (years, slots, programs, cart). The backend
only checks it's an object of reasonable size and that you own the plan."""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import current_user
from app.db import get_conn

router = APIRouter(prefix="/plans", tags=["plans"])

MAX_PLANS = 20
MAX_PLAN_BYTES = 64_000


class PlanBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    data: dict


def _json(row):
    return {"id": row["id"], "name": row["name"], "data": json.loads(row["data"]), "updated_at": row["updated_at"]}


def _encoded(data: dict) -> str:
    encoded = json.dumps(data)
    if len(encoded) > MAX_PLAN_BYTES:
        raise HTTPException(413, "That plan is too large to save.")
    return encoded


def _own(conn, plan_id, user):
    row = conn.execute("SELECT * FROM plans WHERE id = ? AND user_id = ?", (plan_id, user["id"])).fetchone()
    if row is None:
        raise HTTPException(404, "No such plan.")
    return row


@router.get("")
def list_plans(conn=Depends(get_conn), user=Depends(current_user)):
    rows = conn.execute("SELECT * FROM plans WHERE user_id = ? ORDER BY id", (user["id"],)).fetchall()
    return {"plans": [_json(r) for r in rows]}


@router.post("", status_code=201)
def create_plan(body: PlanBody, conn=Depends(get_conn), user=Depends(current_user)):
    count = conn.execute("SELECT COUNT(*) FROM plans WHERE user_id = ?", (user["id"],)).fetchone()[0]
    if count >= MAX_PLANS:
        raise HTTPException(409, f"You can keep up to {MAX_PLANS} plans.")
    with conn:
        plan_id = conn.execute("INSERT INTO plans (user_id, name, data) VALUES (?, ?, ?)",
                               (user["id"], body.name.strip(), _encoded(body.data))).lastrowid
    return _json(_own(conn, plan_id, user))


@router.put("/{plan_id}")
def save_plan(plan_id: int, body: PlanBody, conn=Depends(get_conn), user=Depends(current_user)):
    _own(conn, plan_id, user)
    with conn:
        conn.execute("UPDATE plans SET name = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                     (body.name.strip(), _encoded(body.data), plan_id))
    return _json(_own(conn, plan_id, user))


@router.delete("/{plan_id}")
def delete_plan(plan_id: int, conn=Depends(get_conn), user=Depends(current_user)):
    """Plans are the student's own working data, so unlike posts they can be deleted."""
    _own(conn, plan_id, user)
    with conn:
        conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
    return {"ok": True}
