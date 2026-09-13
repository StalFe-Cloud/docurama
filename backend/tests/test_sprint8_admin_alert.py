"""
Sprint 8: workspace-admin email alerts on domain joins.

Pins the enterprise onboarding loop the product now runs: when someone
activates through a verified domain, the workspace's admins learn about it
by email — an approval-mode join alerts them to review the queue, an
auto-join alerts them that a member landed. Every attempt is accountable
in email_send_logs (kind='domain_join_admin_alert'), failures recorded per
recipient, and an SMTP-less deployment degrades to 'failed' log rows
instead of breaking activation.
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy.future import select

from app.core import config
from app.core.security import get_password_hash
from app.models import Account, DomainVerification, EmailSendLog, User


def _registration_env(monkeypatch):
    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")
    monkeypatch.setenv("DOCURAMA_PUBLIC_REGISTRATION", "true")


async def _seed_workspace(db_session, domain: str, join_mode: str) -> Account:
    """Verified domain + one active admin so the alert has a recipient."""
    account = Account(name=f"{domain} workspace")
    db_session.add(account)
    await db_session.flush()
    db_session.add(User(
        account_id=account.id,
        email="boss@acme-work.example.com",
        hashed_password=get_password_hash("a-long-enough-password-123"),
        first_name="Work", last_name="Space",
        role="admin",
        is_active=True,
    ))
    db_session.add(DomainVerification(
        account_id=account.id,
        domain=domain,
        status="verified",
        verification_token="tok-123",
        verification_method="dns_txt",
        txt_record_host="_docurama." + domain,
        txt_record_value="docurama-verification=tok-123",
        cname_record_host="sign." + domain,
        join_mode=join_mode,
        verified_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()
    return account


async def _signup_and_activate(client, domain: str) -> dict:
    resp = await client.post("/api/auth/register", json={
        "email": f"newhire@{domain}",
        "password": "a-long-enough-password-123",
        "first_name": "New", "last_name": "Hire",
        "age_gate_confirmed": True,
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "pending_activation"
    activated = await client.post(
        "/api/auth/domain-join/activate", json={"token": body["activation_token"]}
    )
    assert activated.status_code == 200, activated.text
    return activated.json()


async def _alert_logs(db_session, recipient: str):
    rows = (await db_session.execute(
        select(EmailSendLog).where(
            EmailSendLog.kind == "domain_join_admin_alert",
            EmailSendLog.recipient == recipient,
        )
    )).scalars().all()
    return rows


async def test_approval_join_alerts_workspace_admin(client, db_session, monkeypatch):
    _registration_env(monkeypatch)
    await _seed_workspace(db_session, "approve-alert.example.com", "approval")

    body = await _signup_and_activate(client, "approve-alert.example.com")
    assert body["membership"] == "pending_approval"

    rows = await _alert_logs(db_session, "boss@acme-work.example.com")
    assert len(rows) == 1
    assert rows[0].status in ("sent", "failed")  # SMTP-less: honest failure
    assert "waiting" in rows[0].subject.lower()


async def test_auto_join_alerts_workspace_admin(client, db_session, monkeypatch):
    _registration_env(monkeypatch)
    await _seed_workspace(db_session, "auto-alert.example.com", "auto_join")

    body = await _signup_and_activate(client, "auto-alert.example.com")
    assert body["membership"] == "active"

    rows = await _alert_logs(db_session, "boss@acme-work.example.com")
    assert len(rows) == 1
    assert "joined" in rows[0].subject.lower()


async def test_alert_failure_never_blocks_activation(client, db_session, monkeypatch):
    """
    The accountability contract: a broken mail path records a failed log row
    but the activation response stays 200 — membership state must not depend
    on notification delivery.
    """
    _registration_env(monkeypatch)
    await _seed_workspace(db_session, "broken-mail.example.com", "auto_join")

    from app.services import mailer

    class _Boom:
        sent = False
        error = "smtp unreachable (test)"

    async def _fail_resolve(*args, **kwargs):
        raise RuntimeError("smtp unreachable (test)")

    monkeypatch.setattr(config.settings, "DEPLOYMENT_MODE", "selfhost")

    import app.api.auth as auth_mod

    async def _fail_resolve_db(db, account_id):
        raise RuntimeError("smtp unreachable (test)")

    monkeypatch.setattr(auth_mod.smtp_config, "resolve", _fail_resolve_db)

    body = await _signup_and_activate(client, "broken-mail.example.com")
    assert body["membership"] == "active"

    rows = await _alert_logs(db_session, "boss@acme-work.example.com")
    assert len(rows) == 1
    assert rows[0].status == "failed"
    assert "smtp unreachable" in (rows[0].error or "")
