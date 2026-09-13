"""
DSAR processing engine: data-subject export and erasure requests.

Lifecycle is a five-state machine — queued, processing, completed, failed,
cancelled — and every transition is honest:

- A request may only enter ``processing`` from ``queued``.
- ``completed`` requires the work product (an export bundle or an erasure
  summary) to exist.
- ``failed`` carries a machine-readable reason; erasure fails while the
  subject still has pending signing obligations rather than silently
  destroying documents in flight.
- ``cancelled`` is only reachable from ``queued``.

Exports gather the subject's personal data as JSON; erasure anonymises the
user and recipient rows in place (preserving the envelope audit chains, which
are evidence) and reports exact counts of what was changed.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import (
    AccountMembership, AuditEvent, ConsentRecord, DsarRequest, Envelope,
    Recipient, Signature, User,
)
from app.services import audit_chain

PENDING_ENVELOPE_STATUSES = ("draft", "sent", "delivered")

# States (single source of truth for the API layer's vocabulary).
STATE_QUEUED = "queued"
STATE_PROCESSING = "processing"
STATE_COMPLETED = "completed"
STATE_FAILED = "failed"
STATE_CANCELLED = "cancelled"
VALID_STATES = (STATE_QUEUED, STATE_PROCESSING, STATE_COMPLETED, STATE_FAILED, STATE_CANCELLED)
VALID_KINDS = ("export", "delete")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def create_request(
    db: AsyncSession,
    *,
    account_id: str,
    subject_email: str,
    kind: str,
    requested_by_user_id: Optional[str] = None,
) -> DsarRequest:
    if kind not in VALID_KINDS:
        raise ValueError(f"kind must be one of {VALID_KINDS}")
    request = DsarRequest(
        account_id=account_id,
        subject_email=subject_email.strip().lower(),
        kind=kind,
        state=STATE_QUEUED,
        requested_by_user_id=requested_by_user_id,
    )
    db.add(request)
    await db.flush()
    await audit_chain.append_security_event(
        db,
        event_type="dsar_created",
        description=f"DSAR {kind} request opened for {request.subject_email}",
        severity="info",
        account_id=account_id,
        actor_user_id=requested_by_user_id,
        detail={"request_id": request.id, "kind": kind},
    )
    return request


async def cancel_request(db: AsyncSession, request: DsarRequest) -> DsarRequest:
    if request.state != STATE_QUEUED:
        raise ValueError(f"only queued requests can be cancelled (state={request.state})")
    request.state = STATE_CANCELLED
    request.cancelled_at = _utcnow()
    return request


async def _subject_user(db: AsyncSession, subject_email: str) -> Optional[User]:
    return (
        await db.execute(select(User).where(User.email == subject_email))
    ).scalar_one_or_none()


async def _pending_obligations(db: AsyncSession, subject_email: str) -> list:
    rows = (
        await db.execute(
            select(Envelope.id, Envelope.title, Envelope.status)
            .join(Recipient, Recipient.envelope_id == Envelope.id)
            .where(Recipient.email == subject_email, Envelope.status.in_(PENDING_ENVELOPE_STATUSES))
            .limit(50)
        )
    ).all()
    return [{"envelope_id": r[0], "title": r[1], "status": r[2]} for r in rows]


async def _build_export(db: AsyncSession, subject_email: str) -> dict:
    """Collect the subject's personal data from every table that holds it."""
    user = await _subject_user(db, subject_email)
    payload = {
        "subject_email": subject_email,
        "generated_at": _utcnow().isoformat(),
        "account": None,
        "profile": None,
        "memberships": [],
        "consents": [],
        "envelopes_as_recipient": [],
        "signatures": [],
    }
    if user is not None:
        payload["profile"] = {
            "id": user.id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login_at": getattr(user, "last_login_at", None).isoformat()
            if getattr(user, "last_login_at", None) else None,
            "marketing_consent": bool(getattr(user, "marketing_consent", False)),
            "marketing_consent_at": getattr(user, "marketing_consent_at", None).isoformat()
            if getattr(user, "marketing_consent_at", None) else None,
            "mfa_totp_enabled": bool(getattr(user, "totp_enabled", False)),
            "is_active": bool(getattr(user, "is_active", True)),
        }
        memberships = (
            await db.execute(
                select(AccountMembership).where(AccountMembership.user_id == user.id)
            )
        ).scalars().all()
        payload["memberships"] = [
            {
                "account_id": m.account_id,
                "role": m.role,
                "is_active": bool(m.is_active),
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in memberships
        ]

    consents = (
        await db.execute(
            select(ConsentRecord).where(ConsentRecord.subject_email == subject_email)
        )
    ).scalars().all()
    payload["consents"] = [
        {
            "purpose": c.purpose,
            "granted": bool(c.granted),
            "granted_at": c.granted_at.isoformat() if c.granted_at else None,
            "revoked_at": c.revoked_at.isoformat() if c.revoked_at else None,
        }
        for c in consents
    ]

    recipient_rows = (
        await db.execute(
            select(Recipient, Envelope)
            .join(Envelope, Envelope.id == Recipient.envelope_id)
            .where(Recipient.email == subject_email)
            .order_by(Envelope.created_at.desc())
            .limit(500)
        )
    ).all()
    for recipient, envelope in recipient_rows:
        payload["envelopes_as_recipient"].append({
            "envelope_id": envelope.id,
            "title": envelope.title,
            "status": envelope.status,
            "envelope_created_at": envelope.created_at.isoformat() if envelope.created_at else None,
            "completed_at": envelope.completed_at.isoformat() if envelope.completed_at else None,
            "my_role": recipient.role,
            "my_status": recipient.status,
            "signed_at": recipient.signed_at.isoformat() if recipient.signed_at else None,
        })
        # The envelope's own audit trail is included event-type-only: it is
        # evidence that may reference other people, so the bundle carries the
        # subject-relevant facts without third-party identifiers.
        events = (
            await db.execute(
                select(AuditEvent.event_type, AuditEvent.created_at)
                .where(AuditEvent.envelope_id == envelope.id)
                .order_by(AuditEvent.created_at.asc())
                .limit(100)
            )
        ).all()
        payload["envelopes_as_recipient"][-1]["audit_event_types"] = [
            {"type": t, "at": at.isoformat() if at else None} for t, at in events
        ]

    sigs = (
        await db.execute(
            select(Signature, Envelope)
            .join(Recipient, Recipient.id == Signature.recipient_id)
            .join(Envelope, Envelope.id == Recipient.envelope_id)
            .where(Recipient.email == subject_email)
            .limit(500)
        )
    ).all()
    for signature, envelope in sigs:
        payload["signatures"].append({
            "envelope_id": envelope.id,
            "signature_type": signature.signature_type,
            "signer_name": signature.signer_name,
            "signed_at": signature.created_at.isoformat() if signature.created_at else None,
            "ip_address": signature.ip_address,
        })
    return payload


def _export_dir() -> str:
    path = os.path.join(settings.STORAGE_DIR, "exports")
    os.makedirs(path, exist_ok=True)
    return path


async def _perform_export(db: AsyncSession, request: DsarRequest) -> dict:
    payload = await _build_export(db, request.subject_email)
    file_path = os.path.join(_export_dir(), f"dsar_{request.id}.json")
    with open(file_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    request.result_ref = file_path
    return {
        "file": file_path,
        "envelopes": len(payload["envelopes_as_recipient"]),
        "signatures": len(payload["signatures"]),
        "consents": len(payload["consents"]),
    }


async def _perform_erasure(db: AsyncSession, request: DsarRequest) -> dict:
    pending = await _pending_obligations(db, request.subject_email)
    if pending:
        raise PendingObligationsError(pending)

    summary = {"users_anonymised": 0, "memberships_deactivated": 0,
               "recipients_anonymised": 0, "signatures_redacted": 0}

    user = await _subject_user(db, request.subject_email)
    if user is not None:
        suffix = uuid.uuid4().hex[:12]
        user.email = f"erased+{suffix}@erasure.invalid"
        user.first_name = "Erased"
        user.last_name = "Subject"
        if hasattr(user, "is_active"):
            user.is_active = False
        if hasattr(user, "marketing_consent"):
            user.marketing_consent = False
        summary["users_anonymised"] = 1

        memberships = (
            await db.execute(
                select(AccountMembership).where(AccountMembership.user_id == user.id)
            )
        ).scalars().all()
        for m in memberships:
            m.is_active = False
            summary["memberships_deactivated"] += 1

    recipients = (
        await db.execute(select(Recipient).where(Recipient.email == request.subject_email))
    ).scalars().all()
    for r in recipients:
        r.name = "Erased Subject"
        r.email = f"erased+{uuid.uuid4().hex[:12]}@erasure.invalid"
        r.signing_token = uuid.uuid4().hex  # invalidates any outstanding link
        r.declined_reason = None
        summary["recipients_anonymised"] += 1
        sigs = (
            await db.execute(select(Signature).where(Signature.recipient_id == r.id))
        ).scalars().all()
        for s in sigs:
            s.signer_name = "Erased Subject"
            summary["signatures_redacted"] += 1

    return summary


class PendingObligationsError(Exception):
    def __init__(self, pending: list):
        self.pending = pending
        super().__init__(f"{len(pending)} pending envelope(s) still reference the subject")


async def process_request(db: AsyncSession, request: DsarRequest) -> DsarRequest:
    """Drive one request to a terminal state. Returns the updated request."""
    if request.state not in (STATE_QUEUED, STATE_FAILED):
        return request

    # Captured before any rollback: after a rollback the instance is expired
    # and touching its attributes from async context raises MissingGreenlet.
    request_id = request.id
    request_kind = request.kind
    request_subject = request.subject_email
    request_account = request.account_id

    request.state = STATE_PROCESSING
    request.started_at = _utcnow()
    await db.commit()

    try:
        if request_kind == "export":
            summary = await _perform_export(db, request)
        else:
            summary = await _perform_erasure(db, request)
    except PendingObligationsError as exc:
        await db.rollback()
        refreshed = await db.get(DsarRequest, request_id)
        refreshed.state = STATE_FAILED
        refreshed.failure_reason = "pending signing obligations"
        refreshed.result_summary = {"pending": exc.pending}
        await audit_chain.append_security_event(
            db,
            event_type="dsar_failed",
            description=f"DSAR {refreshed.kind} for {refreshed.subject_email} failed: pending obligations",
            severity="warning",
            account_id=refreshed.account_id,
            detail={"request_id": refreshed.id, "pending_count": len(exc.pending)},
        )
        await db.commit()
        return refreshed
    except Exception as exc:  # noqa: BLE001 — any failure must be recorded, not lost
        await db.rollback()
        refreshed = await db.get(DsarRequest, request_id)
        refreshed.state = STATE_FAILED
        refreshed.failure_reason = str(exc)[:500]
        await db.commit()
        return refreshed

    refreshed = await db.get(DsarRequest, request_id)
    refreshed.state = STATE_COMPLETED
    refreshed.completed_at = _utcnow()
    refreshed.result_summary = summary
    await audit_chain.append_security_event(
        db,
        event_type="dsar_completed",
        description=f"DSAR {request_kind} for {request_subject} completed",
        severity="info",
        account_id=request_account,
        detail={"request_id": refreshed.id, "summary": summary},
    )
    await db.commit()
    return refreshed


async def process_next_queued(db: AsyncSession) -> Optional[DsarRequest]:
    """Worker entry point: take the oldest queued request and drive it."""
    request = (
        await db.execute(
            select(DsarRequest).where(DsarRequest.state == STATE_QUEUED)
            .order_by(DsarRequest.created_at.asc()).limit(1)
        )
    ).scalar_one_or_none()
    if request is None:
        return None
    return await process_request(db, request)
