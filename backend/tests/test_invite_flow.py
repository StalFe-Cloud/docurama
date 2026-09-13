"""
Invites: a new member sets their own password from an emailed single-use link.
No temporary password is ever generated, returned, or displayed.
"""
import pytest

from app.core.security import get_password_hash
from app.models import Account, AccountMembership, User

PASSWORD = "a-long-password-1234"


@pytest.fixture
async def admin_world(db_session):
    account = Account(name="Acme", subdomain="acme")
    db_session.add(account)
    await db_session.flush()
    admin = User(account_id=account.id, email="admin@example.com",
                 hashed_password=get_password_hash(PASSWORD), role="admin",
                 is_active=True)
    db_session.add(admin)
    await db_session.flush()
    db_session.add(AccountMembership(user_id=admin.id, account_id=account.id,
                                     role="owner"))
    await db_session.commit()
    return account, admin


async def _login(client, email):
    resp = await client.post("/api/auth/login",
                             json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text


async def test_invite_new_user_sends_mail_and_no_password(client, db_session,
                                                          admin_world, monkeypatch):
    from app.services import mailer

    sent = {}

    async def fake_resolve(db, account_id):
        return None  # no SMTP configured in tests

    def fake_send(config, to, name, subject, html, text):
        sent["to"] = to
        sent["subject"] = subject
        sent["html"] = html

    monkeypatch.setattr("app.api.companies.smtp_config.resolve", fake_resolve)
    # The endpoint awaits asyncio.to_thread, so the stand-in must be awaitable.
    async def fake_to_thread(fn, *a):
        return _sync(fn, *a)
    monkeypatch.setattr("app.api.companies.asyncio.to_thread", fake_to_thread)
    monkeypatch.setattr(mailer, "send_email", fake_send)

    def _sync(fn, *a):
        return fn(*a)

    account, admin = admin_world
    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "newhire@example.com", "role": "member", "first_name": "New",
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["is_new_user"] is True
    assert body["temporary_password"] is None
    assert sent["to"] == "newhire@example.com"
    assert "Acme" in sent["subject"]
    assert "/reset-password?token=" in sent["html"]


async def test_invited_user_password_is_not_the_old_temp_style(client, db_session,
                                                               admin_world):
    account, admin = admin_world
    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "joiner@example.com", "role": "member",
    })
    assert resp.status_code == 201

    # Whatever password hash was seeded, a guessed short password must not work.
    login = await client.post("/api/auth/login", json={
        "email": "joiner@example.com", "password": "password123"})
    assert login.status_code == 400


async def test_invite_mail_failure_returns_fallback_link(client, db_session,
                                                         admin_world, monkeypatch):
    from app.services import mailer

    async def fake_resolve(db, account_id):
        return None

    def failing_send(config, to, name, subject, html, text):
        class R:
            sent = False
            error = "connection refused"
        return R()

    monkeypatch.setattr("app.api.companies.smtp_config.resolve", fake_resolve)
    # The endpoint awaits asyncio.to_thread, so the stand-in must be awaitable.
    async def fake_to_thread(fn, *a):
        return fn(*a)
    monkeypatch.setattr("app.api.companies.asyncio.to_thread", fake_to_thread)
    monkeypatch.setattr(mailer, "send_email", failing_send)

    account, admin = admin_world
    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "offline@example.com", "role": "member",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["invite_link_delivered"] is False
    assert body["fallback_invite_link"] and "/reset-password?token=" in body["fallback_invite_link"]


async def test_existing_user_invite_sends_no_password_material(client, db_session,
                                                               admin_world,
                                                               monkeypatch):
    from app.core.security import get_password_hash as _h
    from app.models import User as _U
    from app.services import mailer

    calls = []

    async def fake_resolve(db, account_id):
        return None

    def recording_send(config, to, name, subject, html, text):
        calls.append((to, subject))
        class R:
            sent = True
            error = None
        return R()

    monkeypatch.setattr("app.api.companies.smtp_config.resolve", fake_resolve)
    # The endpoint awaits asyncio.to_thread, so the stand-in must be awaitable.
    async def fake_to_thread(fn, *a):
        return fn(*a)
    monkeypatch.setattr("app.api.companies.asyncio.to_thread", fake_to_thread)
    monkeypatch.setattr(mailer, "send_email", recording_send)

    account, admin = admin_world
    existing = _U(account_id=account.id, email="veteran@example.com",
                  hashed_password=_h(PASSWORD), role="member", is_active=True)
    db_session.add(existing)
    await db_session.commit()

    await _login(client, "admin@example.com")
    resp = await client.post(f"/api/companies/{account.id}/members", json={
        "email": "veteran@example.com", "role": "manager",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_new_user"] is False
    assert body["temporary_password"] is None
    assert body["fallback_invite_link"] is None
    assert calls and calls[0][0] == "veteran@example.com"
