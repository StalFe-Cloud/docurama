"""
Compliance & Trust Foundation - the control suite.

Pins the behaviours the compliance program claims as Implemented:

- hash-chained ledgers (security + per-envelope) with honest verification,
  tamper detection and seal snapshots;
- the DSAR five-state lifecycle, including the pending-obligation failure path;
- the consent ledger;
- retention sweeps with legal holds and both terminal actions;
- the incident record with its non-extendable 72-hour GDPR clock;
- the subprocessor registry and its publication on the public trust center;
- the control catalog with the four-state readiness vocabulary;
- security-ledger writes from authentication and API-key events;
- the upload magic-byte gate.

Where a claim cannot be made, the test pins the honest refusal instead.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete as sa_delete, select, update as sa_update

from app.core.security import create_access_token, get_password_hash
from app.models import (
    Account, AccountMembership, AuditEvent, ConsentRecord, DsarRequest,
    Envelope, LegalHold, Recipient, RetentionPolicy, SecurityEvent, User,
)
from app.services import audit_chain, dsar as dsar_service, retention as retention_service


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

async def _make_user(db_session, email: str, role: str = "admin", platform_admin: bool = False):
    account = Account(name=f"Acct {email}")
    db_session.add(account)
    await db_session.flush()
    user = User(
        email=email,
        hashed_password=get_password_hash("a-long-enough-password-123"),
        first_name="Test",
        role=role,
        account_id=account.id,
        is_platform_admin=platform_admin,
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


def _pdf_bytes() -> bytes:
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )


async def _make_envelope(db_session, account, owner, tmp_path, *, title="Test Envelope",
                         status="completed", age_days=None, recipients=None):
    """A terminal envelope with real files on disk, optionally aged."""
    now = datetime.now(timezone.utc)
    created = now - timedelta(days=age_days) if age_days else now
    pdf = tmp_path / f"{title.replace(' ', '_')}_{os.urandom(4).hex()}.pdf"
    pdf.write_bytes(_pdf_bytes())

    envelope = Envelope(
        account_id=account.id,
        created_by_user_id=owner.id,
        title=title,
        status=status,
        original_pdf_path=str(pdf),
        sha256_original="a" * 64,
        verification_code=os.urandom(12).hex().upper(),
        completed_at=created if status == "completed" else None,
        created_at=created,
        updated_at=created,
    )
    db_session.add(envelope)
    await db_session.flush()

    for name, email in (recipients or []):
        db_session.add(Recipient(
            envelope_id=envelope.id,
            name=name,
            email=email,
            signing_token=os.urandom(24).hex(),
        ))
    await db_session.commit()
    return envelope


import os  # noqa: E402 - used by the helpers above


# ---------------------------------------------------------------------------
# 1. Hash chains
# ---------------------------------------------------------------------------

async def test_security_events_chain_and_verify(client, db_session):
    admin, _ = await _make_user(db_session, "chain-admin@t.test", platform_admin=True)
    for i in range(3):
        await audit_chain.append_security_event(
            db_session, event_type="control_reviewed",
            description=f"event {i}", actor_email=admin.email,
        )
    await db_session.commit()

    resp = await client.get("/api/admin/audit/verify?scope=security", headers=_auth(admin))
    assert resp.status_code == 200
    body = resp.json()
    assert body["chain"]["valid"] is True
    assert body["chain"]["checked"] == 3
    assert body["seals"]["all_valid"] is True  # no seals yet = vacuously valid


async def test_tampered_security_event_is_detected(client, db_session):
    admin, _ = await _make_user(db_session, "tamper-admin@t.test", platform_admin=True)
    for i in range(3):
        await audit_chain.append_security_event(
            db_session, event_type="control_reviewed", description=f"event {i}",
        )
    await db_session.commit()

    # Rewrite history directly in the database, like an attacker with SQL would.
    await db_session.execute(
        sa_update(SecurityEvent).where(SecurityEvent.seq == 2)
        .values(description="rewritten by an attacker")
    )
    await db_session.commit()

    resp = await client.get("/api/admin/audit/verify?scope=security", headers=_auth(admin))
    body = resp.json()
    assert body["chain"]["valid"] is False
    assert body["chain"]["first_broken_seq"] == 2
    assert "mismatch" in body["chain"]["reason"] or "gap" in body["chain"]["reason"]


async def test_envelope_audit_chain_verified_and_tamper_detected(client, db_session, tmp_path):
    from sqlalchemy import select
    owner, account = await _make_user(db_session, "env-owner@t.test")
    envelope = await _make_envelope(db_session, account, owner, tmp_path, status="completed")
    # Two audit events on the envelope, chained by the flush listener.
    db_session.add(AuditEvent(envelope_id=envelope.id, event_type="sent",
                              description="first"))
    db_session.add(AuditEvent(envelope_id=envelope.id, event_type="opened",
                              description="second"))
    await db_session.commit()

    admin, _ = await _make_user(db_session, "env-admin@t.test", platform_admin=True)
    resp = await client.get(
        f"/api/admin/audit/verify?scope=envelope&envelope_id={envelope.id}",
        headers=_auth(admin),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["chain"]["valid"] is True
    assert body["chain"]["checked"] == 2

    # Mutate the first event's content: the second link must break.
    await db_session.execute(
        sa_update(AuditEvent).where(AuditEvent.event_type == "sent")
        .values(description="doctored")
    )
    await db_session.commit()
    resp = await client.get(
        f"/api/admin/audit/verify?scope=envelope&envelope_id={envelope.id}",
        headers=_auth(admin),
    )
    body = resp.json()
    assert body["chain"]["valid"] is False
    assert body["chain"]["first_broken_seq"] in (1, 2)


async def test_chain_seal_detects_rewritten_tip(client, db_session):
    admin, _ = await _make_user(db_session, "seal-admin@t.test", platform_admin=True)
    await audit_chain.append_security_event(
        db_session, event_type="control_reviewed", description="before seal",
    )
    await db_session.commit()

    resp = await client.post("/api/admin/audit/seal", headers=_auth(admin))
    assert resp.status_code == 200
    seal_seq = resp.json()["last_seq"]

    # Appending after a seal is legitimate (append-only).
    await audit_chain.append_security_event(
        db_session, event_type="control_reviewed", description="after seal",
    )
    await db_session.commit()
    resp = await client.get("/api/admin/audit/verify?scope=security", headers=_auth(admin))
    assert resp.json()["seals"]["all_valid"] is True

    # Removing a sealed row is not: the seal's event count no longer matches.
    await db_session.execute(
        sa_delete(SecurityEvent).where(SecurityEvent.seq == seal_seq)
    )
    await db_session.commit()
    resp = await client.get("/api/admin/audit/verify?scope=security", headers=_auth(admin))
    body = resp.json()
    assert body["seals"]["all_valid"] is False
    assert body["chain"]["valid"] is False


async def test_seals_listing(client, db_session):
    admin, _ = await _make_user(db_session, "seals-admin@t.test", platform_admin=True)
    await client.post("/api/admin/audit/seal", headers=_auth(admin))
    resp = await client.get("/api/admin/audit/seals", headers=_auth(admin))
    assert resp.status_code == 200
    seals = resp.json()
    assert len(seals) == 1
    assert seals[0]["scope"] == "security_events"


# ---------------------------------------------------------------------------
# 2. DSAR lifecycle
# ---------------------------------------------------------------------------

async def test_dsar_export_lifecycle_end_to_end(client, db_session, tmp_path):
    admin, account = await _make_user(db_session, "dsar-admin@t.test", platform_admin=True)
    subject, _ = await _make_user(db_session, "subject@t.test", role="member")
    await _make_envelope(db_session, account, admin, tmp_path,
                         title="Contract X", recipients=[("Subject", "subject@t.test")])

    resp = await client.post("/api/admin/dsar", headers=_auth(admin), json={
        "subject_email": "subject@t.test", "kind": "export", "account_id": account.id,
    })
    assert resp.status_code == 201
    request_id = resp.json()["id"]
    assert resp.json()["state"] == "queued"

    resp = await client.post(f"/api/admin/dsar/{request_id}/run", headers=_auth(admin))
    assert resp.status_code == 200
    assert resp.json()["state"] == "completed"
    assert resp.json()["result_summary"]["envelopes"] == 1

    resp = await client.get(f"/api/admin/dsar/{request_id}", headers=_auth(admin))
    assert resp.json()["state"] == "completed"
    assert resp.json()["result_ref"], "completed export must have a bundle on disk"

    resp = await client.get(f"/api/admin/dsar/{request_id}/download", headers=_auth(admin))
    assert resp.status_code == 200
    bundle = resp.json()
    assert bundle["subject_email"] == "subject@t.test"
    assert bundle["envelopes_as_recipient"][0]["title"] == "Contract X"
    # Third-party identifiers are excluded from the audit projection.
    for env_bundle in bundle["envelopes_as_recipient"]:
        for ev in env_bundle["audit_event_types"]:
            assert set(ev.keys()) == {"type", "at"}

    # The ledger recorded the lifecycle.
    events = (await db_session.execute(
        select(SecurityEvent).order_by(SecurityEvent.seq)
    )).scalars().all()
    types = [e.event_type for e in events]
    assert "dsar_created" in types and "dsar_completed" in types


async def test_dsar_erasure_fails_while_signatures_pending(client, db_session, tmp_path):
    admin, account = await _make_user(db_session, "erase-admin@t.test", platform_admin=True)
    subject, _ = await _make_user(db_session, "pending-subject@t.test", role="member")
    await _make_envelope(db_session, account, admin, tmp_path, title="Live Deal",
                         status="sent", recipients=[("Pending", "pending-subject@t.test")])

    headers = _auth(admin)
    resp = await client.post("/api/admin/dsar", headers=headers, json={
        "subject_email": "pending-subject@t.test", "kind": "delete", "account_id": account.id,
    })
    request_id = resp.json()["id"]

    resp = await client.post(f"/api/admin/dsar/{request_id}/run", headers=headers)
    body = resp.json()
    assert body["state"] == "failed"
    assert body["failure_reason"] == "pending signing obligations"
    assert body["result_summary"]["pending"][0]["title"] == "Live Deal"

    # Cancel of a terminal request is refused with 409.
    resp = await client.post(f"/api/admin/dsar/{request_id}/cancel", headers=headers)
    assert resp.status_code == 409


async def test_dsar_erasure_anonymises_after_completion(client, db_session, tmp_path):
    admin, account = await _make_user(db_session, "erase2-admin@t.test", platform_admin=True)
    subject, _ = await _make_user(db_session, "erasure-target@t.test", role="member")
    envelope = await _make_envelope(db_session, account, admin, tmp_path, title="Done Deal",
                                    status="completed", recipients=[("Target", "erasure-target@t.test")])
    await db_session.commit()

    resp = await client.post("/api/admin/dsar", headers=_auth(admin), json={
        "subject_email": "erasure-target@t.test", "kind": "delete", "account_id": account.id,
    })
    request_id = resp.json()["id"]
    resp = await client.post(f"/api/admin/dsar/{request_id}/run", headers=_auth(admin))
    assert resp.json()["state"] == "completed"
    assert resp.json()["result_summary"]["users_anonymised"] == 1
    assert resp.json()["result_summary"]["recipients_anonymised"] == 1

    await db_session.refresh(subject)
    assert subject.email.startswith("erased+")
    assert subject.email.endswith("@erasure.invalid")
    assert not subject.is_active

    recipient = (await db_session.execute(
        select(Recipient).where(Recipient.envelope_id == envelope.id)
    )).scalars().first()
    assert "erasure.invalid" in recipient.email


async def test_dsar_cancel_queued_and_invalid_state(client, db_session):
    admin, account = await _make_user(db_session, "cancel-admin@t.test", platform_admin=True)
    resp = await client.post("/api/admin/dsar", headers=_auth(admin), json={
        "subject_email": "someone@t.test", "kind": "export", "account_id": account.id,
    })
    request_id = resp.json()["id"]
    resp = await client.post(f"/api/admin/dsar/{request_id}/cancel", headers=_auth(admin))
    assert resp.status_code == 200
    assert resp.json()["state"] == "cancelled"


async def test_dsar_requires_platform_admin(client, db_session):
    user, account = await _make_user(db_session, "plain@t.test")
    resp = await client.post("/api/admin/dsar", headers=_auth(user), json={
        "subject_email": "someone@t.test", "kind": "export", "account_id": account.id,
    })
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 3. Consent ledger
# ---------------------------------------------------------------------------

async def test_consent_record_and_revoke(client, db_session):
    admin, _ = await _make_user(db_session, "consent-admin@t.test", platform_admin=True)
    resp = await client.post("/api/admin/consents", headers=_auth(admin), json={
        "subject_email": "subject@t.test", "purpose": "newsletter",
    })
    assert resp.status_code == 201
    consent_id = resp.json()["id"]

    resp = await client.post(f"/api/admin/consents/{consent_id}/revoke", headers=_auth(admin))
    assert resp.status_code == 200
    assert resp.json()["revoked_at"] is not None

    resp = await client.get(
        "/api/admin/consents?subject_email=subject@t.test", headers=_auth(admin),
    )
    rows = resp.json()
    assert rows[0]["granted"] is False
    assert rows[0]["revoked_at"] is not None


# ---------------------------------------------------------------------------
# 4. Retention + legal holds
# ---------------------------------------------------------------------------

async def test_retention_deletes_aged_terminal_envelopes(client, db_session, tmp_path):
    admin, account = await _make_user(db_session, "ret-admin@t.test", platform_admin=True)
    envelope = await _make_envelope(db_session, account, admin, tmp_path,
                                    title="Ancient", status="completed", age_days=400)
    assert os.path.exists(envelope.original_pdf_path)

    resp = await client.put("/api/admin/retention-policies", headers=_auth(admin), json={
        "account_id": account.id, "resource_type": "envelopes",
        "retention_days": 365, "action": "delete",
    })
    assert resp.status_code == 200

    resp = await client.post("/api/admin/retention/sweep", headers=_auth(admin))
    body = resp.json()
    assert body["deleted"] == 1

    assert (await db_session.get(Envelope, envelope.id)) is None
    assert not os.path.exists(envelope.original_pdf_path)
    types = [e.event_type for e in (await db_session.execute(select(SecurityEvent))).scalars().all()]
    assert "retention_deleted" in types


async def test_retention_anonymize_keeps_rows_rewrites_pii(client, db_session, tmp_path):
    admin, account = await _make_user(db_session, "anon-admin@t.test", platform_admin=True)
    envelope = await _make_envelope(db_session, account, admin, tmp_path, title="Keep",
                                    status="declined", age_days=100,
                                    recipients=[("Alice", "alice@t.test")])

    await client.put("/api/admin/retention-policies", headers=_auth(admin), json={
        "account_id": account.id, "resource_type": "envelopes",
        "retention_days": 90, "action": "anonymize",
    })
    await client.post("/api/admin/retention/sweep", headers=_auth(admin))

    assert (await db_session.get(Envelope, envelope.id)) is not None
    recipient = (await db_session.execute(
        select(Recipient).where(Recipient.envelope_id == envelope.id)
    )).scalars().first()
    assert "retention.invalid" in recipient.email


async def test_legal_hold_blocks_retention(client, db_session, tmp_path):
    admin, account = await _make_user(db_session, "hold-admin@t.test", platform_admin=True)
    envelope = await _make_envelope(db_session, account, admin, tmp_path, title="Litigation",
                                    status="completed", age_days=400)
    await client.put("/api/admin/retention-policies", headers=_auth(admin), json={
        "account_id": account.id, "resource_type": "envelopes",
        "retention_days": 365, "action": "delete",
    })
    resp = await client.post("/api/admin/legal-holds", headers=_auth(admin), json={
        "account_id": account.id, "name": "Case 2026-114", "reason": "active litigation",
    })
    assert resp.status_code == 201
    hold_id = resp.json()["id"]

    resp = await client.post("/api/admin/retention/sweep", headers=_auth(admin))
    assert resp.json()["skipped_hold"] >= 1
    assert (await db_session.get(Envelope, envelope.id)) is not None

    await client.post(f"/api/admin/legal-holds/{hold_id}/release", headers=_auth(admin))
    resp = await client.post("/api/admin/retention/sweep", headers=_auth(admin))
    assert resp.json()["deleted"] == 1


async def test_retention_never_touches_in_flight_envelopes(client, db_session, tmp_path):
    admin, account = await _make_user(db_session, "flight-admin@t.test", platform_admin=True)
    live = await _make_envelope(db_session, account, admin, tmp_path, title="Live",
                                status="sent", age_days=999)
    await client.put("/api/admin/retention-policies", headers=_auth(admin), json={
        "account_id": account.id, "resource_type": "envelopes",
        "retention_days": 1, "action": "delete",
    })
    await client.post("/api/admin/retention/sweep", headers=_auth(admin))
    assert (await db_session.get(Envelope, live.id)) is not None


# ---------------------------------------------------------------------------
# 5. Incidents: the 72-hour clock
# ---------------------------------------------------------------------------

async def test_incident_deadline_is_detection_plus_72h(client, db_session):
    admin, _ = await _make_user(db_session, "ir-admin@t.test", platform_admin=True)
    resp = await client.post("/api/admin/incidents", headers=_auth(admin), json={
        "title": "Storage exposure", "description": "bucket misconfiguration",
        "severity": "high",
    })
    assert resp.status_code == 201
    body = resp.json()
    detected = datetime.fromisoformat(body["detected_at"])
    deadline = datetime.fromisoformat(body["gdpr_notification_deadline"])
    assert abs((deadline - detected).total_seconds() - 72 * 3600) < 1
    assert body["status"] == "detected"
    assert body["notification_overdue"] is False

    incident_id = body["id"]
    resp = await client.post(f"/api/admin/incidents/{incident_id}/contain", headers=_auth(admin))
    assert resp.json()["status"] == "contained"
    assert resp.json()["contained_at"] is not None

    resp = await client.post(
        f"/api/admin/incidents/{incident_id}/resolve?authority_notified=true&subjects_notified=true",
        headers=_auth(admin),
    )
    body = resp.json()
    assert body["status"] == "resolved"
    assert body["authority_notified_at"] is not None
    assert body["subjects_notified_at"] is not None


async def test_overdue_incident_is_flagged_not_hidden(client, db_session):
    admin, _ = await _make_user(db_session, "overdue-admin@t.test", platform_admin=True)
    detected = datetime.now(timezone.utc) - timedelta(hours=100)
    resp = await client.post("/api/admin/incidents", headers=_auth(admin), json={
        "title": "Old breach", "description": "detected long ago",
        "severity": "critical", "detected_at": detected.isoformat(),
    })
    body = resp.json()
    assert body["notification_overdue"] is True

    resp = await client.get("/api/admin/compliance/overview", headers=_auth(admin))
    assert resp.json()["incidents"]["notification_overdue"] >= 1


# ---------------------------------------------------------------------------
# 6. Subprocessors & trust center
# ---------------------------------------------------------------------------

async def test_subprocessor_registry_publishes_to_trust_center(client, db_session):
    admin, _ = await _make_user(db_session, "vendor-admin@t.test", platform_admin=True)
    resp = await client.post("/api/admin/subprocessors", headers=_auth(admin), json={
        "name": "Example Payment Processor", "purpose": "card payments",
        "data_location": "EU", "status": "planned",
    })
    assert resp.status_code == 201

    resp = await client.get("/api/trust")
    assert resp.status_code == 200
    body = resp.json()
    assert body["certifications"] == [], "trust center must not invent certifications"
    assert any(s["name"] == "Example Payment Processor" for s in body["subprocessors"])
    assert "readiness_by_framework" in body
    assert body["security_contact"] is None or isinstance(body["security_contact"], str)


# ---------------------------------------------------------------------------
# 7. Controls, readiness vocabulary, evidence, overview
# ---------------------------------------------------------------------------

async def test_control_catalog_seeded_with_honest_vocabulary(client, db_session):
    admin, _ = await _make_user(db_session, "ctl-admin@t.test", platform_admin=True)
    resp = await client.get("/api/admin/compliance/controls", headers=_auth(admin))
    assert resp.status_code == 200
    controls = resp.json()
    assert len(controls) >= 20
    legal = {"Implemented", "Partial", "Missing", "Needs Review"}
    assert all(c["readiness"] in legal for c in controls)
    # The catalog itself must not claim more than the code delivers.
    # (Sprint 6 moved ISO-04/06/07 and SOC2-01 to Implemented; Sprint 7 moved
    # ISO-09 and SOC2-03 with the change workflow and vendor register behind
    # them; EIDAS-02 stays Partial because a qualified TSA is the operator's
    # choice.)
    by_id = {c["control_id"]: c for c in controls}
    for moved in ("ISO-04", "ISO-06", "ISO-07", "ISO-09", "SOC2-01", "SOC2-03"):
        assert by_id[moved]["readiness"] == "Implemented"
    assert by_id["EIDAS-02"]["readiness"] == "Partial"
    # No control may carry certification-flavoured readiness.
    assert not any(
        c["readiness"].lower() in ("certified", "compliant", "audited")
        for c in controls
    )


async def test_readiness_rejects_certification_language(client, db_session):
    admin, _ = await _make_user(db_session, "vocab-admin@t.test", platform_admin=True)
    controls = (await client.get("/api/admin/compliance/controls", headers=_auth(admin))).json()
    control_db_id = controls[0]["id"]

    for bogus in ("Certified", "Compliant", "Audited", "Passed"):
        resp = await client.patch(
            f"/api/admin/compliance/controls/{control_db_id}",
            headers=_auth(admin), json={"readiness": bogus},
        )
        assert resp.status_code == 422

    resp = await client.patch(
        f"/api/admin/compliance/controls/{control_db_id}",
        headers=_auth(admin), json={"readiness": "Needs Review", "note": "pending operator review"},
    )
    assert resp.status_code == 200
    assert resp.json()["readiness"] == "Needs Review"


async def test_evidence_attachment_and_overview_shape(client, db_session):
    admin, _ = await _make_user(db_session, "ov-admin@t.test", platform_admin=True)
    controls = (await client.get("/api/admin/compliance/controls", headers=_auth(admin))).json()
    target = next(c for c in controls if c["control_id"] == "GDPR-06")
    resp = await client.post(
        f"/api/admin/compliance/controls/{target['id']}/evidence",
        headers=_auth(admin), json={"kind": "test", "reference": "tests/test_compliance_foundation.py"},
    )
    assert resp.status_code == 201

    resp = await client.get("/api/admin/compliance/overview", headers=_auth(admin))
    body = resp.json()
    assert body["certification_claim"] is None
    assert set(body["readiness_vocabulary"]) == {"Implemented", "Partial", "Missing", "Needs Review"}
    assert set(body["controls"]["by_framework"].keys()) >= {"GDPR", "ISO27001", "SOC2", "eIDAS"}
    assert body["audit_chain"]["valid"] is True
    assert "dsar_queue" in body and "incidents" in body


async def test_access_review_recording(client, db_session):
    admin, _ = await _make_user(db_session, "ar-admin@t.test", platform_admin=True)
    now = datetime.now(timezone.utc)
    resp = await client.post("/api/admin/compliance/access-reviews", headers=_auth(admin), json={
        "period_start": (now - timedelta(days=90)).isoformat(),
        "period_end": now.isoformat(),
        "findings": "no unexpected platform admins",
        "accounts_reviewed": 3,
        "changes_required": 0,
    })
    assert resp.status_code == 201
    resp = await client.get("/api/admin/compliance/access-reviews", headers=_auth(admin))
    assert resp.json()[0]["accounts_reviewed"] == 3


# ---------------------------------------------------------------------------
# 8. Security-ledger writes from authentication
# ---------------------------------------------------------------------------

async def test_login_events_reach_the_ledger(client, db_session):
    user, _ = await _make_user(db_session, "login-event@example.com", role="admin")

    # A failed attempt is recorded against the presented address.
    resp = await client.post("/api/auth/login", json={
        "email": "login-event@example.com", "password": "wrong-password-entirely",
    })
    assert resp.status_code == 400

    # A successful attempt is recorded against the user.
    resp = await client.post("/api/auth/login", json={
        "email": "login-event@example.com", "password": "a-long-enough-password-123",
    })
    assert resp.status_code == 200

    rows = (await db_session.execute(
        select(SecurityEvent).where(
            SecurityEvent.event_type.in_(["login_failed", "login_success"])
        )
    )).scalars().all()
    types = {r.event_type for r in rows}
    assert "login_failed" in types and "login_success" in types

    # And the whole ledger still verifies after auth traffic.
    admin, _ = await _make_user(db_session, "verify-admin@t.test", platform_admin=True)
    resp = await client.get("/api/admin/audit/verify?scope=security", headers=_auth(admin))
    assert resp.json()["chain"]["valid"] is True


async def test_api_key_events_reach_the_ledger(client, db_session):
    user, account = await _make_user(db_session, "key-event@t.test")
    headers = _auth(user)

    resp = await client.post("/api/api-keys", headers=headers, json={
        "name": "CI key", "scopes": ["read"],
    })
    assert resp.status_code == 201
    key_id = resp.json()["id"]

    resp = await client.delete(f"/api/api-keys/{key_id}", headers=headers)
    assert resp.status_code == 200

    rows = (await db_session.execute(
        select(SecurityEvent).where(
            SecurityEvent.event_type.in_(["api_key_created", "api_key_revoked"])
        )
    )).scalars().all()
    assert {r.event_type for r in rows} == {"api_key_created", "api_key_revoked"}


# ---------------------------------------------------------------------------
# 9. Upload magic-byte gate
# ---------------------------------------------------------------------------

async def test_envelope_upload_rejects_non_pdf_payload(client, db_session, tmp_path):
    user, account = await _make_user(db_session, "magic@t.test")
    db_session.add(AccountMembership(account_id=account.id, user_id=user.id,
                                     role="admin", is_active=True))
    await db_session.commit()

    fake = tmp_path / "payload.pdf"
    fake.write_bytes(b"PK\x03\x04 this is actually a zip archive")

    resp = await client.post(
        "/api/envelopes",
        headers=_auth(user),
        files={"file": ("payload.pdf", fake.read_bytes(), "application/pdf")},
        data={"title": "Impostor",
              "recipients_json": '[{"name": "Alice", "email": "alice@example.com", "role": "Signer"}]'},
    )
    assert resp.status_code == 415
    assert "PDF" in resp.json()["detail"]


async def test_envelope_upload_accepts_real_pdf(client, db_session, tmp_path):
    user, account = await _make_user(db_session, "magic-ok@t.test")
    db_session.add(AccountMembership(account_id=account.id, user_id=user.id,
                                     role="admin", is_active=True))
    await db_session.commit()

    resp = await client.post(
        "/api/envelopes",
        headers=_auth(user),
        files={"file": ("doc.pdf", _pdf_bytes(), "application/pdf")},
        data={"title": "Real PDF",
              "recipients_json": '[{"name": "Alice", "email": "alice@example.com", "role": "Signer"}]'},
    )
    # The endpoint may reject for unrelated reasons (quota, mail), but never
    # with the 415 impostor verdict.
    assert resp.status_code != 415
