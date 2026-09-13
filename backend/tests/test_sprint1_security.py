"""
Sprint 1 regression tests: public verify portal + settings API hardening.

- P1-3: the public verify response's audit trail is redacted (no emails, no IPs)
  and the envelope UUID is no longer a lookup key.
- P1-4: channel credentials (Twilio/Telegram/WhatsApp) are returned redacted,
  saved write-only, and gated to workspace admins; account SMTP writes too.
- P1-14: verify-by-upload rejects oversized payloads without reading them all
  into memory, and shared digests no longer 500.
"""
import io

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.models import Account, AccountSetting, Envelope, User, AuditEvent


async def _make_user(db_session: AsyncSession, email: str, role: str = "admin"):
    account = Account(name=f"Acct {email}")
    db_session.add(account)
    await db_session.flush()
    user = User(
        email=email,
        hashed_password="not-a-real-hash",
        first_name="Test",
        role=role,
        account_id=account.id,
    )
    db_session.add(user)
    await db_session.commit()
    return user, account


def _auth(user: User) -> dict:
    token = create_access_token(
        subject=user.id,
        claims={"purpose": "session", "role": user.role, "email": user.email,
                "account_id": user.account_id, "ver": user.token_version or 0},
    )
    return {"Authorization": f"Bearer {token}"}


async def _make_envelope(db_session: AsyncSession, account: Account, code: str, title: str) -> Envelope:
    env = Envelope(
        account_id=account.id,
        title=title,
        status="completed",
        verification_code=code,
        original_pdf_path="/nonexistent/original.pdf",
    )
    db_session.add(env)
    await db_session.flush()
    db_session.add(AuditEvent(
        envelope_id=env.id,
        event_type="signed",
        actor_name="Signer One",
        actor_email="signer.one@example.com",
        ip_address="203.0.113.7",
        user_agent="Mozilla/5.0 secret",
        description="Document signed by Signer One",
    ))
    await db_session.commit()
    return env


# ---------------------------------------------------------------------------
# P1-3 - verify portal redaction
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_verify_audit_trail_is_redacted(client, db_session):
    user, account = await _make_user(db_session, "verify-redact@example.com")
    await _make_envelope(db_session, account, "VRDFY01", "Redaction check")

    resp = await client.get("/api/verify", params={"code": "VRDFY01"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["audit_trail"], "the redacted trail must still show events"
    event = body["audit_trail"][0]
    assert event["actor_name"] == "Signer One"
    assert event["description"] == "Document signed by Signer One"
    serialized = str(body)
    assert "signer.one@example.com" not in serialized
    assert "203.0.113.7" not in serialized
    assert "Mozilla/5.0 secret" not in serialized


@pytest.mark.asyncio
async def test_verify_uuid_is_not_a_lookup_key(client, db_session):
    user, account = await _make_user(db_session, "verify-uuid@example.com")
    env = await _make_envelope(db_session, account, "VRDFY02", "UUID lookup check")

    resp = await client.get("/api/verify", params={"code": env.id})
    assert resp.status_code == 200
    assert resp.json()["is_valid"] is False
    assert "No document record found" in resp.json()["message"]


# ---------------------------------------------------------------------------
# P1-4 - settings redaction and role gates
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sms_secrets_are_never_returned(client, db_session):
    user, _account = await _make_user(db_session, "sms-admin@example.com")
    db_session.add(AccountSetting(
        account_id=user.account_id, section="sms",
        data={"enabled": True, "provider": "twilio", "auth_token": "tw-super-secret",
              "bot_token": "tg-super-secret", "access_token": "wa-super-secret"},
    ))
    await db_session.commit()

    resp = await client.get("/api/settings/sms", headers=_auth(user))
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    serialized = str(data)
    assert "tw-super-secret" not in serialized
    assert "tg-super-secret" not in serialized
    assert "wa-super-secret" not in serialized
    assert data["auth_token_set"] is True and data["bot_token_set"] is True


@pytest.mark.asyncio
async def test_sms_save_with_blank_secret_keeps_stored_one(client, db_session):
    user, _account = await _make_user(db_session, "sms-keep@example.com")
    db_session.add(AccountSetting(
        account_id=user.account_id, section="sms",
        data={"enabled": True, "provider": "twilio", "auth_token": "stored-token"},
    ))
    await db_session.commit()

    resp = await client.put(
        "/api/settings/sms", headers=_auth(user),
        json={"data": {"enabled": False, "auth_token": ""}},
    )
    assert resp.status_code == 200, resp.text

    row = (await db_session.execute(
        __import__("sqlalchemy").select(AccountSetting).where(
            AccountSetting.account_id == user.account_id,
            AccountSetting.section == "sms",
        )
    )).scalar_one()
    assert row.data["auth_token"] == "stored-token", "a blank submit must not wipe the token"
    assert row.data["enabled"] is False


@pytest.mark.asyncio
async def test_member_cannot_write_sms_or_account_smtp(client, db_session):
    member, _account = await _make_user(db_session, "sms-member@example.com", role="member")

    resp = await client.put(
        "/api/settings/sms", headers=_auth(member), json={"data": {"enabled": True}}
    )
    assert resp.status_code == 403, "a member must not repoint OTP delivery"

    resp = await client.put(
        "/api/settings/smtp/account", headers=_auth(member),
        json={"host": "evil.example.com", "port": 25, "username": "x", "from_email": "x@evil.example.com"},
    )
    assert resp.status_code == 403, "a member must not redirect signing-link mail"


@pytest.mark.asyncio
async def test_admin_can_write_sms(client, db_session):
    admin, _account = await _make_user(db_session, "sms-ok@example.com", role="admin")
    resp = await client.put(
        "/api/settings/sms", headers=_auth(admin),
        json={"data": {"enabled": True, "provider": "twilio", "auth_token": "brand-new"}},
    )
    assert resp.status_code == 200, resp.text
