"""
Retention engine: configurable retention periods, legal holds, and the sweep
that applies them.

Rules the implementation enforces:

- An active legal hold on a workspace blocks every retention action in that
  workspace; a hold scoped to one envelope blocks only that envelope.
- Platform-default policies (account_id NULL) apply where a workspace has no
  override of its own.
- The sweep processes a bounded batch per run and records every deletion as a
  security-ledger event, so a retention deletion can never happen silently.
- Envelopes still in flight (draft/sent/delivered) are never retention
  candidates - retention applies to terminal envelopes only.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditChainSeal, AuditEvent, ConsentRecord, DsarRequest, Envelope, Field,
    LegalHold, RetentionPolicy, Recipient, SecurityEvent, Signature,
)
from app.services import audit_chain

TERMINAL_ENVELOPE_STATUSES = ("completed", "voided", "declined")
VALID_ACTIONS = ("delete", "anonymize")
VALID_RESOURCE_TYPES = ("envelopes", "security_events")

BATCH_LIMIT = 50


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def resolve_policy(
    db: AsyncSession, account_id: Optional[str], resource_type: str
) -> Optional[RetentionPolicy]:
    """Account override wins; platform default (account_id NULL) is fallback."""
    if account_id:
        override = (
            await db.execute(
                select(RetentionPolicy).where(
                    RetentionPolicy.account_id == account_id,
                    RetentionPolicy.resource_type == resource_type,
                    RetentionPolicy.enabled == True,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if override:
            return override
    return (
        await db.execute(
            select(RetentionPolicy).where(
                RetentionPolicy.account_id.is_(None),
                RetentionPolicy.resource_type == resource_type,
                RetentionPolicy.enabled == True,  # noqa: E712
            )
        )
    ).scalar_one_or_none()


async def _hold_for(db: AsyncSession, account_id: Optional[str], envelope_id: str) -> bool:
    q = select(LegalHold).where(
        LegalHold.released_at.is_(None),
        LegalHold.account_id == account_id,
    )
    holds = (await db.execute(q)).scalars().all()
    for hold in holds:
        if hold.scope_envelope_id is None or hold.scope_envelope_id == envelope_id:
            return True
    return False


async def retention_sweep_once(db: AsyncSession, *, now: Optional[datetime] = None) -> dict:
    """One bounded sweep pass over terminal envelopes due for retention."""
    now = now or _utcnow()
    summary = {"examined": 0, "deleted": 0, "anonymized": 0, "skipped_hold": 0, "skipped_no_policy": 0}

    candidates = (
        await db.execute(
            select(Envelope)
            .where(Envelope.status.in_(TERMINAL_ENVELOPE_STATUSES))
            .order_by(Envelope.updated_at.asc())
            .limit(BATCH_LIMIT * 4)
        )
    ).scalars().all()

    for envelope in candidates:
        if summary["deleted"] + summary["anonymized"] >= BATCH_LIMIT:
            break
        policy = await resolve_policy(db, envelope.account_id, "envelopes")
        if policy is None:
            summary["skipped_no_policy"] += 1
            continue
        summary["examined"] += 1
        anchor = envelope.completed_at or envelope.updated_at or envelope.created_at
        if anchor is None:
            continue
        if anchor.tzinfo is None:
            anchor = anchor.replace(tzinfo=timezone.utc)
        if now - anchor < timedelta(days=policy.retention_days):
            continue
        if await _hold_for(db, envelope.account_id, envelope.id):
            summary["skipped_hold"] += 1
            continue

        if policy.action == "delete":
            await _purge_envelope(db, envelope)
            summary["deleted"] += 1
            action = "retention_deleted"
        else:
            await _anonymize_envelope(db, envelope)
            summary["anonymized"] += 1
            action = "retention_anonymized"

        await audit_chain.append_security_event(
            db,
            event_type=action,
            description=(
                f"Retention {policy.action} applied to envelope '{envelope.title}' "
                f"({envelope.id}) after {policy.retention_days} days"
            ),
            severity="warning",
            account_id=envelope.account_id,
            detail={"envelope_id": envelope.id, "policy_action": policy.action},
        )
    await db.commit()
    return summary


async def _purge_envelope(db: AsyncSession, envelope: Envelope) -> None:
    """Remove an envelope and every dependent row, then its stored files."""
    env_id = envelope.id
    await db.execute(delete(Field).where(Field.envelope_id == env_id))
    sig_ids = (await db.execute(
        select(Signature.id).where(Signature.envelope_id == env_id)
    )).scalars().all()
    if sig_ids:
        await db.execute(delete(Signature).where(Signature.envelope_id == env_id))
    await db.execute(delete(Recipient).where(Recipient.envelope_id == env_id))
    await db.execute(delete(AuditEvent).where(AuditEvent.envelope_id == env_id))
    await db.execute(delete(Envelope).where(Envelope.id == env_id))

    import os
    for path in (envelope.original_pdf_path, envelope.signed_pdf_path, envelope.certificate_pdf_path):
        if path:
            try:
                os.remove(path)
            except OSError:
                # A missing file is not a failed deletion; the ledger records
                # the row removal either way.
                pass


async def _anonymize_envelope(db: AsyncSession, envelope: Envelope) -> None:
    recipients = (
        await db.execute(select(Recipient).where(Recipient.envelope_id == envelope.id))
    ).scalars().all()
    import uuid as _uuid
    for r in recipients:
        r.name = "Retained per policy"
        r.email = f"retained+{_uuid.uuid4().hex[:12]}@retention.invalid"
        r.signing_token = _uuid.uuid4().hex


async def purge_expired_security_events(db: AsyncSession, *, now: Optional[datetime] = None) -> int:
    """Apply the security_events retention policy, if any.

    Deleting ledger rows breaks the chain by design - the verify endpoint will
    report the gap. That is the honest trade-off: the retention policy's
    existence is itself recorded in the ledger before any rows are removed.
    """
    now = now or _utcnow()
    policy = await resolve_policy(db, None, "security_events")
    if policy is None:
        return 0
    cutoff = now - timedelta(days=policy.retention_days)
    rows = (
        await db.execute(
            select(SecurityEvent).where(SecurityEvent.created_at < cutoff)
            .order_by(SecurityEvent.seq.asc()).limit(BATCH_LIMIT)
        )
    ).scalars().all()
    if not rows:
        return 0
    await audit_chain.append_security_event(
        db,
        event_type="retention_deleted",
        description=(
            f"Security-event retention removed {len(rows)} ledger rows older than "
            f"{policy.retention_days} days; chain now reports a gap by design"
        ),
        severity="warning",
        detail={"removed_seq_from": rows[0].seq, "removed_seq_to": rows[-1].seq},
    )
    await db.commit()
    removed = 0
    for row in rows:
        await db.delete(row)
        removed += 1
    await db.commit()
    return removed
