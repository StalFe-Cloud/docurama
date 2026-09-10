"""
API-key authorisation is enforced, and key use never mutates the owner.

Scopes are fail closed: a mutating method needs the "write" scope, a safe
method needs "read", and a key with no scopes can do nothing. And because a
key is bound to the account it was issued for, resolving it used to rewrite
the owner's active company on every request; these tests pin both behaviours.
"""
from sqlalchemy.future import select

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, ApiKey, User
from app.services import api_keys as api_key_service


async def _make_key(db_session, account, owner, scopes):
    plaintext, prefix, hashed = api_key_service.generate_api_key()
    db_session.add(ApiKey(
        account_id=account.id,
        created_by_user_id=owner.id,
        name="test",
        key_prefix=prefix,
        hashed_key=hashed,
        scopes=scopes,
        is_active=True,
    ))
    await db_session.commit()
    return plaintext


async def test_readonly_key_cannot_mutate(client, db_session):
    account = Account(name="Acme")
    db_session.add(account)
    await db_session.flush()
    owner = User(
        account_id=account.id,
        email="owner@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=owner.id, account_id=account.id, role="owner"))
    await db_session.commit()

    key = await _make_key(db_session, account, owner, ["read"])
    resp = await client.post(
        "/api/templates/auto-detect",
        headers={"X-Api-Key": key},
    )
    assert resp.status_code == 403
    assert "read-only" in resp.json()["detail"]


async def test_api_key_use_does_not_rewrite_active_account(client, db_session):
    account_a = Account(name="A")
    account_b = Account(name="B")
    db_session.add_all([account_a, account_b])
    await db_session.flush()
    owner = User(
        account_id=account_b.id,  # UI active company is B; key is issued for A
        email="owner2@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()
    await db_session.commit()

    key = await _make_key(db_session, account_a, owner, ["read", "write"])
    resp = await client.get("/api/envelopes", headers={"X-Api-Key": key})
    assert resp.status_code == 200

    # The request detaches the owner by design, so refresh the row by re-reading
    # it rather than the instance the request handed back.
    fresh = (await db_session.execute(
        select(User).where(User.id == owner.id)
    )).scalar_one()
    assert fresh.account_id == account_b.id  # unchanged in the database


async def test_change_password_refuses_api_key_auth(client, db_session):
    account = Account(name="C")
    db_session.add(account)
    await db_session.flush()
    owner = User(
        account_id=account.id,
        email="owner3@example.com",
        hashed_password=get_password_hash("a-long-password-1234"),
        role="admin",
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()
    await db_session.commit()

    # A write-scoped key passes the scope gate, yet must still be refused:
    # the owner object handed to the endpoint is detached, so the password
    # mutation would silently no-op behind a success message.
    key = await _make_key(db_session, account, owner, ["read", "write"])
    resp = await client.post(
        "/api/auth/change-password",
        headers={"X-Api-Key": key},
        json={
            "current_password": "a-long-password-1234",
            "new_password": "another-long-password-123",
        },
    )
    assert resp.status_code == 403
    assert "interactive session" in resp.json()["detail"]
