"""Sign-in, sessions and roles.

Sign-in is pluggable: an IdentityProvider turns a login into an Identity, and
everything after that (users row, session token, role checks) is shared.
Today only DevIdentityProvider exists, the placeholder "Sign in with MIT".
MIT login plugs in as another provider: MIT's OIDC service returns a stable
`sub` and an email. Map those to Identity and call start_session, and no route
changes.

Roles live on the users row, never in the token, so they can't be claimed by
a client. In dev mode the login request picks a role so each one can be
tried; with a real provider new users start as students and an admin assigns
other roles (POST /admin/users/{id}/role).
"""
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.db import get_conn

Role = Literal["student", "professor", "admin"]


@dataclass
class Identity:
    provider: str
    external_id: str
    email: str
    display_name: str


class IdentityProvider:
    name: str


class DevIdentityProvider(IdentityProvider):
    """Trusts whatever email it's given. Only mounted when AUTH_MODE=dev."""
    name = "dev"

    def identify(self, email: str, display_name: str) -> Identity:
        return Identity(self.name, email.lower(), email.lower(), display_name.strip())


class MitOidcProvider(IdentityProvider):
    """Not implemented yet. Expected flow: redirect to MIT OIDC with a state
    nonce, exchange the code at the token endpoint, verify the id_token, then
    return Identity("mit", claims["sub"], claims["email"], claims.get("name", "")).
    Client id/secret would come from .env (MIT_OIDC_CLIENT_ID / MIT_OIDC_CLIENT_SECRET)."""
    name = "mit"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def upsert_user(conn, identity: Identity, role: str | None = None):
    """Find or create the user for this identity. role only applies when the
    caller is allowed to set it (dev login, admin tools)."""
    row = conn.execute("SELECT * FROM users WHERE auth_provider = ? AND external_id = ?",
                       (identity.provider, identity.external_id)).fetchone()
    with conn:
        if row is None:
            user_id = conn.execute(
                "INSERT INTO users (auth_provider, external_id, email, display_name, role) VALUES (?, ?, ?, ?, ?)",
                (identity.provider, identity.external_id, identity.email,
                 identity.display_name or identity.email.split("@")[0], role or "student"),
            ).lastrowid
        else:
            user_id = row["id"]
            # an empty name from the provider keeps the one on file
            conn.execute("UPDATE users SET email = ?, display_name = COALESCE(NULLIF(?, ''), display_name) WHERE id = ?",
                         (identity.email, identity.display_name, user_id))
            if role:
                conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def start_session(conn, user_id: int, ttl_hours: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    with conn:
        conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                     (_hash(token), user_id, expires.strftime("%Y-%m-%d %H:%M:%S")))
    return token


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def optional_user(authorization: str | None = Header(default=None), conn=Depends(get_conn)):
    token = _bearer(authorization)
    if token is None:
        return None
    row = conn.execute("""
        SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
    """, (_hash(token),)).fetchone()
    if row is None:
        raise HTTPException(401, "Session expired or invalid; sign in again.")
    return row


def current_user(user=Depends(optional_user)):
    if user is None:
        raise HTTPException(401, "Sign in to do that.")
    return user


def require_role(*roles: str):
    def check(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, f"Requires role: {' or '.join(roles)}.")
        return user
    return check


def public_user(row):
    return {"id": row["id"], "email": row["email"], "display_name": row["display_name"], "role": row["role"]}


router = APIRouter(prefix="/auth", tags=["auth"])


class DevLogin(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    display_name: str = Field(default="", max_length=80)
    role: Role = "student"


@router.post("/dev/login")
def dev_login(body: DevLogin, request: Request, conn=Depends(get_conn)):
    settings = request.app.state.settings
    if settings.auth_mode != "dev":
        raise HTTPException(404, "Dev sign-in is disabled.")
    user = upsert_user(conn, DevIdentityProvider().identify(body.email, body.display_name), role=body.role)
    return {"token": start_session(conn, user["id"], settings.session_ttl_hours), "user": public_user(user)}


@router.get("/mit/login")
def mit_login():
    raise HTTPException(501, "Sign in with MIT isn't wired up yet; use /auth/dev/login in development.")


@router.get("/me")
def me(user=Depends(current_user)):
    return public_user(user)


@router.post("/logout")
def logout(authorization: str | None = Header(default=None), conn=Depends(get_conn)):
    token = _bearer(authorization)
    if token:
        with conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))
    return {"ok": True}
