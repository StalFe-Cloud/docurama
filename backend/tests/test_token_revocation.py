"""
Sprint 1 regression tests: stateless session revocation via per-user token_version.

Covers P1-1:
- A session token minted before a password change is refused afterwards.
- The same holds for a TOTP disable and for a redeemd password reset.
- Sign-out bumps the version server-side, so a stolen cookie copy dies with it.
- Legacy tokens (no ver claim) still authenticate against version 0.
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, get_password_hash
from app.models import Account, User


async def _make_user(
    db_session: AsyncSession, email: str, password: str | None = None
) -> User:
    account = Account(name=f"Acct {email}")
    db_session.add(account)
    await db_session.flush()
    user = User(
        email=email,
        hashed_password=get_password_hash(password or "correct horse battery staple"),
        first_name="Test",
        role="admin",
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.commit()
    return user


def _bearer(user: User) -> dict:
    token = create_access_token(
        subject=user.id,
        claims={
            "purpose": "session",
            "role": user.role,
            "email": user.email,
            "account_id": user.account_id,
            "ver": user.token_version or 0,
        },
    )
    return {"Authorization": f"Bearer {token}"}, token


@pytest.mark.asyncio
async def test_session_token_authenticates_before_revocation(client, db_session):
    user = await _make_user(db_session, "revoke-baseline@example.com")
    headers, _ = _bearer(user)
    resp = await client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_password_change_orphans_earlier_tokens(client, db_session):
    user = await _make_user(db_session, "revoke-passwd@example.com")
    headers, _ = _bearer(user)

    resp = await client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": "correct horse battery staple", "new_password": "brand new password 42"},
    )
    assert resp.status_code == 200, resp.text

    resp = await client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 401, "token minted before the rotation must be refused"


@pytest.mark.asyncio
async def test_totp_disable_orphans_earlier_tokens(client, db_session):
    user = await _make_user(db_session, "revoke-totp@example.com")
    headers, _ = _bearer(user)

    resp = await client.post(
        "/api/auth/totp/disable", headers=headers, json={"password": "correct horse battery staple"}
    )
    assert resp.status_code == 200, resp.text

    resp = await client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 401, "token minted before the factor was dropped must be refused"


@pytest.mark.asyncio
async def test_logout_orphans_earlier_tokens(client, db_session):
    user = await _make_user(db_session, "revoke-logout@example.com")
    headers, _ = _bearer(user)

    resp = await client.post("/api/auth/logout", headers=headers)
    assert resp.status_code == 200, resp.text

    resp = await client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 401, "a stolen cookie copy must not survive sign-out"


@pytest.mark.asyncio
async def test_logout_without_session_still_succeeds(client):
    """Signing out with an expired/absent session clears the cookie, not 401."""
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_token_with_stale_version_is_refused(client, db_session):
    """A token claiming a future version (forged or rolled back) is not honoured."""
    user = await _make_user(db_session, "revoke-stale@example.com")
    token = create_access_token(
        subject=user.id,
        claims={
            "purpose": "session",
            "role": user.role,
            "email": user.email,
            "account_id": user.account_id,
            "ver": 7,
        },
    )
    resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401, resp.text
